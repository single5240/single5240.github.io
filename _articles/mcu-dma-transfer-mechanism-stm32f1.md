---
layout: article
title: 为什么 DMA 报“完成”还会丢尾花屏？跟着 STM32F1 走完 3 字节发送全过程
description: 以 STM32F103C8T6 通过 USART1_TX 发送 SRAM 中 3 个字节（'A'/'B'/'C'）为贯穿主线，结合 DS5319 与 RM0008 拆解 DMA1 双总线接口、7 通道仲裁、固定请求映射、内存映射、TDR 双缓冲与 TCIF4 提前置位机制，彻底理清“DMA 搬完”和“引脚发完”两层边界。
date: 2026-11-15
category: 嵌入式
tags:
  - DMA
  - STM32F1
  - USART
  - 总线架构
  - 驱动调试
---

在嵌入式固件开发里，有一个很反直觉的常见故障：同样是用 DMA 发数据，调用 HAL 库的外设发送完成回调时串口报文和 SPI 屏幕都很正常；可一旦在**裸 DMA 传输完成中断**里顺手关闭串口、切换 RS-485 方向脚 `DE`，或者拉高 SPI 屏幕的片选信号 `CS`，就会稳定复现**最后几个字节丢失**，或者在屏幕刷新区域末尾**边缘花屏**。

DMA 明明已经报了“完成”，为什么物理引脚上还没发完？

要彻底看清这个问题，不能靠背诵几个 API 名字，也不能靠“高速公路/搬运工”一类的模糊比喻，而是需要顺着一颗具体 MCU 内部的总线、寄存器、请求线与外设缓冲器，把一次 DMA 传输完整走一遍。

> **分析载体与验证边界说明**：本文以 **STM32F103C8T6**（中容量 STM32F1，`64 KB Flash` / `20 KB SRAM`）用 `USART1_TX` 发送 SRAM 中 3 个字节 `tx_buf[3] = {'A', 'B', 'C'}`（`0x41`、`0x42`、`0x43`）为唯一贯穿实例，章节、页码与框图口径严格对应 ST 官方数据手册 `DS5319 Rev 20` 与参考手册 `RM0008 Rev 20`。文中的 ASCII 结构图均为**功能示意**（原厂手册未公开门级电路或隐藏计数器的物理触发器实现），配置片段为**基于手册语义的设计示例，未在特定实板上采集实测波形**。

## 一、纯 CPU 轮询卡在哪？DMA 到底是什么硬件？

如果不启用 DMA，CPU 把 SRAM 里的 `'A'`、`'B'`、`'C'` 通过 `USART1` 发出去，只能在循环里死等串口状态位 `USART_SR.TXE == 1`，随后读取内存 `tx_buf[i]` 再写入 `USART1->DR`。数据量大时，这种“查空位 → 读内存 → 写外设”的机械循环会直接霸占主循环算力。

DMA 要接管的就是这段重复搬运，但芯片里并没有藏着另一个“小 CPU”去执行软件 `for` 循环。对照 `DS5319 Rev 20` Figure 1 整芯框图与 `RM0008 Rev 20` §13.1、Figure 48，DMA1 本质上是一块挂在 AHB 高速总线上的**时钟驱动数字硬件模块**，在总线上拥有两副完全不同的接口角色：

```text
                AHB System Bus / 寄存器配置访问
                             |
                             v
+--------------------------------------------------------+
|               DMA1 控制器（RCC_AHBENR.DMA1EN 驱动）     |
|                                                        |
|  [ AHB Slave 从接口 ] <--- CPU 读写 CPAR / CMAR /      |
|        0x4002 0000         CNDTR / CCR / ISR / IFCR    |
|                                                        |
|  +-----------+ +-----------+       +-----------+       |
|  |  Channel1 | |  ...      |  ...  |  Channel7 |       |
|  | (配置组)   | | (Ch4 本例)|       | (配置组)   |       |
|  +-----+-----+ +-----+-----+       +-----+-----+       |
|        |             |                   |             |
|        +-------------+---------+---------+             |
|                                |                       |
|                                v                       |
|                   [ 硬件仲裁器 Arbiter ]                |
|                   (先比软件 PL，再比通道号)              |
|                                |                       |
|                                v                       |
|       [ 内部当前地址/计数逻辑 + 控制状态机 + 数据通路 ]  |
|                                |                       |
|                                v                       |
|  [ AHB Master 主接口 ] ---> 主动接入多层 BusMatrix      |
+--------------------------------------------------------+
                   功能示意（对照 DS5319 / RM0008）
```

### 区分三个最容易混淆的概念：控制器、通道与一次传输

很多初学者会把“7 个通道”误解成芯片里有“7 条互不干扰的并行硬件总线”。从上面的功能框图就能看清三者的严格边界：

1. **DMA 控制器（Controller）**：真正拥有时钟、仲裁器、内部数据通路和 AHB 主从总线接口的硬件实体。在 **STM32F103C8T6** 上，片上**只有一个 `DMA1`（共 7 个通道），没有 `DMA2`**；而在高密度（High-density）、XL 密度或互联型 F1 芯片上，才会再集成第二块独立的 5 通道 `DMA2` 控制器实例，二者各自拥有独立的通道和请求映射表。
2. **通道（Channel）**：是挂在同一控制器下的一组**独立任务上下文**（`CPARx`、`CMARx`、`CNDTRx`、`CCRx` 和各自的中断状态标志）。7 个通道的出口最终都要汇入同一个硬件仲裁器与同一个 AHB 主接口，因此同一时刻只能由仲裁器选中一条通道占用总线。
3. **一次传输（Transfer）**：指某条通道当前装入并执行的计数搬运任务——在本文中就是配置在 `DMA1 Channel 4` 上的这 `3` 个字节任务（`CNDTR4 = 3`）。

## 二、分清两条路径：固定控制请求线 vs 总线数据通路

把 `USART1` 和 `DMA1 Channel 4` 接在一起，工程师最容易混为一谈的是“在哪里选通道、数据从哪条线走”。芯片内部其实存在**控制信号线**与**数据总线**两条物理属性完全不同的路径：

```text
路径一：控制请求/应答线（芯片内部硬连线，不走 GPIO，也与 CPAR 无关）
  TIM1_CH4/TRIG/COM ---\
  TIM4_CH2          ----+
  SPI2/I2S2_RX      ----+--> [ 逻辑"或"门 ] ---> (request) ---> DMA1 Channel 4
  I2C2_TX           ----+    (同一时间只能                 <--- (ack)
  USART1_TX         ---/      启用其中之一)

路径二：总线数据通路（由 AHB Master 根据地址译码发起真实读写）
  SRAM (0x2000 0000 起, 存 'A'/'B'/'C')
          |  ① AHB 读
          v
    [ DMA1 AHB Master ]
          |  ② 经 BusMatrix -> AHB -> Bridge 2 -> APB2 写
          v
  USART1_DR (0x4001 3804 = 0x4001 3800 + 0x04)
```

- **路径一（固定硬件请求映射，对应 `RM0008` Figure 50 & Table 78）**：STM32F1 采用固定映射（没有自由路由器）。查表可知 `USART1_TX` 硬件固定连到 `DMA1 Channel 4`。这条控制线只传递 `request` 与 `ack` 握手脉冲，**不承载数据字节，也不经过 GPIO 引脚**。还要注意 Channel 4 入口处有一个**逻辑“或”门（logically ORed）**，上面还并接着 `TIM1_CH4/TRIG/COM`、`TIM4_CH2`、`SPI2/I2S2_RX` 与 `I2C2_TX`，因此**同一时刻绝不能同时开启同组外设的 DMA 请求**。
- **路径二（内存映射数据地址，对应 `DS5319` Figure 11 & `RM0008` §27.6.2）**：在 STM32F103C8 的统一编址空间里，相关节点地址固定如下：

| 地址对象 | 所属总线 | 起始/物理地址 | 职责说明 |
| --- | --- | --- | --- |
| 内部 `SRAM`（`tx_buf`） | `BusMatrix` | `0x2000 0000` 起（`20 KB`） | 存放 `'A'`（`0x41`）、`'B'`（`0x42`）、`'C'`（`0x43`） |
| `DMA1` 控制寄存器基址 | `AHB` | `0x4002 0000` | CPU 通过 AHB 从接口配置 Channel 4 参数 |
| `USART1` 外设基址 | `APB2` | `0x4001 3800` | 挂载在 AHB 到 APB2 总线桥 `Bridge 2` 下 |
| `USART1->DR` 数据寄存器 | `APB2` | `0x4001 3804`（偏移 `+0x04`） | `DMA_CPAR4` 填入此地址仅指明目标写入位置，**并非用来选通道** |

## 三、按硬件生效顺序配置通道 4 与两道使能开关

明确硬件与路径后，软件的初始化顺序必须严格顺应硬件的时钟和锁存约束（依据 `RM0008 Rev 20` §7.3.6、§13.3.3 与 §27.3.13）：

```c
/* 设计示例：基于 RM0008 Rev 20 寄存器语义，未经实板编译运行验证 */
static const uint8_t tx_buf[3] = { 'A', 'B', 'C' };

void usart1_dma_tx_start_example(void)
{
    /* 1. 先开 DMA1 时钟（RCC_AHBENR 位 0 DMA1EN），否则后续寄存器写入无效 */
    RCC->AHBENR |= RCC_AHBENR_DMA1EN;

    /* 若此前通道启用过，先关闭 EN 并等待/清理对应 IFCR 标志（此处展示初始配置顺序） */
    DMA1_Channel4->CCR &= ~DMA_CCR_EN;

    /* 2. 通过 DMA1 AHB 从接口写入通道 4 任务参数 */
    DMA1_Channel4->CPAR  = (uint32_t)&USART1->DR; /* 0x4001 3804：外设目标地址 */
    DMA1_Channel4->CMAR  = (uint32_t)tx_buf;      /* SRAM 发送数组首地址（指向 'A'） */
    DMA1_Channel4->CNDTR = 3U;                    /* 本次传输 3 个数据项 */

    /* 3. 配置控制字（PINC 与 MINC 均在 CCR 内）：
     * DIR=1(M2P), PINC=0(外设固定), MINC=1(内存递增),
     * PSIZE=8-bit, MSIZE=8-bit, CIRC=0(Normal 单次), PL=中等软件优先级 */
    DMA1_Channel4->CCR = DMA_CCR_DIR
                       | DMA_CCR_MINC
                       | DMA_CCR_PL_0
                       | DMA_CCR_TCIE;            /* 如需传输完成中断可开启 TCIE */

    /* 4. 按 USART 手册规范先清 TC，再依次闭合通道 EN 与串口 DMAT 两道开关 */
    USART1->SR  &= ~USART_SR_TC;
    DMA1_Channel4->CCR |= DMA_CCR_EN;             /* DMA 通道 4 进入待命 */
    USART1->CR3 |= USART_CR3_DMAT;                /* USART1 允许向通道 4 发 TX 请求 */
}
```

这里有两个最容易踩的硬件约束：
1. **必须先开 `RCC_AHBENR.DMA1EN`**：时钟未到时配置寄存器是无效操作，很多初学者调库函数没注意时钟使能先后顺序，查半天发现参数根本没写进去。
2. **`EN = 1` 期间通道锁定**：只要 `DMA_CCR4.EN` 保持为 `1`，硬件禁止软件修改 `CNDTR4`、`CPAR4` 或 `CMAR4`；并且只有 `DMA_CCR4.EN == 1` 与 `USART_CR3.DMAT == 1` 两道开关**同时闭合**，串口的数据寄存器空事件才会真正变成发往通道 4 的 DMA 请求。

## 四、逐拍走完 `'A'`、`'B'`、`'C'` 的搬运与三帧双缓冲时序

两道开关闭合的瞬间，由于 `USART1` 发送缓冲本来就是空的（`USART_SR.TXE == 1`），`USART1` 立即向 `DMA1 Channel 4` 拉起第一次硬件请求。下面按时间节拍拆解这 3 个字节在芯片内部的完整动作。

### 1. 第 1 字节 `'A'`：仲裁、跨桥读写、握手与影子寄存器步进

1. **两级仲裁**：请求进入 `DMA1` 内部仲裁器。仲裁器先比较软件优先级 `PL[1:0]`；若多个活跃通道软件等级相同，再比较硬件通道号——编号越小优先级越高（例如同级时 `Ch2` 优先于 `Ch4`）。本例只有 `Ch4` 请求，仲裁器立即把 `AHB Master` 接口授权给通道 4。
2. **两笔总线事务与硬件握手**：
   - 第一笔，`DMA1` AHB 主口将 `tx_buf` 首地址送上 `BusMatrix`，译码接通 SRAM，读出 `'A'`（`0x41`）暂存到 DMA 内部数据通路。
   - 第二笔，主口发出 `0x4001 3804`，经 `BusMatrix → AHB system bus → Bridge 2（AHB→APB2 桥）→ APB2` 把 `0x41` 写入 `USART1->DR`。写入使 `USART_SR.TXE` 短暂清零；同时 `DMA1` 沿控制线回送 `ack`，`USART1` 撤回 `request`，`DMA1` 再撤回 `ack` 完成握手。
3. **软件不可见的内部影子寄存器步进**：
   - 通道 4 内部有一组软件不可见的“当前内存地址 / 当前外设地址”工作逻辑（影子指针）。第 1 字节写完后，真正 `+1` 指向 `'B'` 的是这个**内部当前内存地址**；软件如果回头读取 `DMA_CMAR4`，看到的值依然停留在初始数组首地址，当前外设地址也因 `PINC = 0` 继续停在 `USART1->DR`。
   - 内部计数器同步减 1，软件可读的 `DMA_CNDTR4` 从 `3` 变为 `2`。
4. **串口双级结构与 `TXE` 立即回升**：
   - `USART1->DR` 在发送方向上是**发送数据缓冲器（`TDR`）**，后端还连着物理**发送移位寄存器**。因为开始时移位寄存器是空的，刚写进 `TDR` 的 `'A'` **立刻落入移位寄存器**，开始按设定波特率从 `PA9` 引脚逐位向外发出 `Frame 1`（**开启 DMA 并不会加快串口波特率，它省掉的只是 CPU 等位和搬运的时间**）。
   - 就在 `'A'` 落入移位寄存器的同一瞬间，`TDR` 立刻再次变空，所以硬件几乎马上就把 `USART_SR.TXE` 重新置 `1`！

### 2. 第 2、第 3 字节与 `RM0008 Figure 297` 三帧真实时序

对照 `RM0008 Rev 20` §27.3.13 Figure 297 绘制出 `'A'`、`'B'`、`'C'` 三帧在总线上、在 `TDR` 里与在 `PA9` 引脚上的真实时间对齐关系：

```text
时间轴 -->   |<--- Frame 1 ('A') --->|<--- Frame 2 ('B') --->|<--- Frame 3 ('C') --->|
PA9 引脚:    [  正在逐位发送 'A'     ][  正在逐位发送 'B'     ][  正在逐位发送 'C'     ]
移位寄存器:  |         'A'           ||         'B'           ||         'C'           |
USART_DR     |                       ||                       ||                       |
  (TDR):     |'A'->空   [ 排队: 'B' ]||->移走    [ 排队: 'C' ]||->移走       (空)      |
             ^         ^              ^         ^              ^                       ^
TXE 标志:    1 ->0 -> 1(写'B'后清0)   1(写'C'后清0)            1                       1
DMA 请求:    #1       #2              #3                       #4(Normal 计数=0，被忽略)
CNDTR4 计数: 3 -> 2   2 -> 1          1 -> 0                   0 (停止搬运)
                                      ^                        ^                       ^
关键标志:                             |                        |                       |
                              【此时 TCIF4 = 1】        (第 3 帧仍在发送中)     【此时 USART_SR.TC = 1】
                               DMA 完成中断触发！                                  物理停止位真正发完！
```

盯紧上面这张时间轴里最关键的三步接力：
1. **`Frame 1` 刚起步（`移位器 = 'A'`）**：由于 `'A'` 立即跌入移位器使 `TDR` 腾空，`TXE` 第二次置 `1`，当场拉起第 2 次 DMA 请求。DMA 从 SRAM 读 `'B'`（`0x42`）写入 `TDR`（`CNDTR4: 2 → 1`，内部指针指 `'C'`）。由于移位器还在发 `'A'`，`'B'` 只能留在 `TDR` 里排队等待，整个 `Frame 1` 期间 `TXE` 保持为 `0`。
2. **`Frame 1 → Frame 2` 交界（`移位器 = 'B'`）**：`'A'` 的停止位刚结束，`'B'` 自动装入移位器开始发送 `Frame 2`；`TDR` 再次腾空，`TXE` 第三次置 `1`，触发第 3 次 DMA 请求。DMA 读出最后一个字节 `'C'`（`0x43`）写入 `TDR`（`CNDTR4: 1 → 0`）。
3. **重点时刻——`TCIF4 = 1` 在 `Frame 2` 开头就置起了**：
   就在 `'C'` 刚被 DMA 写进 `TDR`、`DMA_CNDTR4` 归零的这一拍，**DMA1 内部硬件认为 3 个字节全部搬完了**，`DMA_ISR` 中的通道 4 传输完成标志 `TCIF4` 立刻置 `1`！如果配置时打开了 `TCIE`，CPU 在这一刻就会收到 DMA 完成中断。
   随后当 `'B'` 发完、`'C'` 进入移位器开始发送 `Frame 3` 时，`TDR` 会第四次腾空置起 `TXE = 1`，但如 `RM0008 Figure 297` 右侧明确标注的那样：在 **Normal（单次）模式**下，计数已归零，DMA 会直接忽略这一次请求。若要发送下一包数据，必须遵循四步规矩：**先关 `DMA_CCR4.EN` → 向 `DMA_IFCR` 写 `CTCIF4` 等清标志位 → 重写 `DMA_CNDTR4`（及必要地址）→ 重新置 `EN = 1`**。

## 五、总线矩阵并发与竞争：DMA 为什么不会让 CPU 停摆？

回到 `RM0008` Figure 1 系统架构图，就能明白 DMA 到底如何与 CPU 共享资源：

```text
[ Cortex-M3 内核 ]
   |-- ICode 总线  --> Flash 接口 (FLITF) --> [ Flash ]   <-- 并行路径，与 DMA1 访 SRAM 不交叉！
   |-- DCode 总线  --> Flash 接口 (FLITF) --> [ Flash ]
   '-- System 总线 ---+
                      |---> [ 多层 AHB 总线矩阵 (BusMatrix) ] ---> SRAM / AHB / Bridge 2 -> APB2
[ DMA1 AHB Master ] --+
```

- **不同目标真并行**：当 `DMA1` 经 `BusMatrix` 访问 SRAM 或跨 `Bridge 2` 访问 `APB2`（`USART1`）时，如果 CPU 正在通过 `ICode` / `DCode` 总线从 Flash 取指令或读常量，由于经过多层总线矩阵且访问目标互不重叠，**两条通路可以真正并发执行，彼此互不等待**。
- **同目标轮询且有带宽兜底**：只有当 CPU 的 `System` 总线和 `DMA1` **同一周期撞上同一个目标**（例如同时读写 SRAM，或同时跨 `Bridge 2` 访问 `APB2`）时，总线矩阵才会按轮询仲裁让其中一方等几个周期——即便发生满负荷争用，硬件也会为 CPU **保留至少一半的 AHB 带宽**，绝不会让 CPU 完全停摆。同时切记：DMA 只访问挂载在总线上的存储器或外设寄存器地址，**不能绕开总线，也无法直接读写 CPU 内核通用寄存器**。

## 六、回到开头的故障：“DMA 搬完” vs “引脚发完”

把上面这张三帧时序图放大到最后两帧，开头的工程谜题也就彻底破案了：

1. **为什么裸 DMA 中断会丢尾/花屏？**
   当 `TCIF4 = 1` 触发 DMA 完成中断的那一瞬间，DMA1 只是刚把第 3 字节 `'C'` 放进了串口的 `TDR` 缓冲寄存器。此时线上 **`'B'`（`Frame 2`）才刚开始移位，`'C'`（`Frame 3`）还躺在 `TDR` 里连移位器都没进，引脚上足足还有将近两帧物理数据没发出去**！
   对于 **SPI 刷屏** 也是同一套底层道理（TX DMA 把末尾像素送进外设发送缓冲即置起完成标志，此时 SPI 移位器还在吐最后几个字节的 SCK 时钟）。如果抢在裸 DMA 中断里直接关闭串口、翻转 RS-485 `DE` 脚，或者拉高 SPI 屏幕的 `CS` 片选，就会把尚未走出引脚的最后两帧物理波形硬生生掐断——串口表现就是末端丢字节，SPI 屏幕表现就是刷新条带最末尾几个像素花掉。
2. **HAL 库外设回调多等了哪一步？**
   参考 ST 官方驱动逻辑（如 HAL 串口 Normal 发送路径 `UART_DMATransmitCplt` 与 `AN3070` 对 RS-485 收发的规范）：HAL 在进入 DMA 传输完成中断后，**并不会当场回调用户函数**，而是顺手关闭串口 `USART_CR3.DMAT`，转而开启串口自身的“物理发送完成中断 `USART_CR1.TCIE`”；一直等到 `Frame 3`（`'C'`）的最后一个停止位真正离开 `PA9`、硬件将 `USART_SR.TC` 置 `1` 时，才进入 `HAL_UART_TxCpltCallback()`。
   SPI 同理：当 TX DMA 上报完成后，驱动还必须等待外设发送状态与总线忙标志彻底清零（例如 `TXE == 1 && SPI_SR.BSY == 0`），才能安全拉高 `CS`。

因此，所有嵌入式通信与显示驱动在对接 DMA 时，都必须死守这两条**双重完成边界**：

| 工程动作需求 | 该盯紧的硬件标志 | 原理解释 |
| --- | --- | --- |
| **复用或改写 SRAM 发送缓冲区 `tx_buf`** | 看 DMA 完成标志（如 `TCIF4 == 1`） | 此时最后一字节已经离开 SRAM 写进外设缓冲，不会再读内存（注：带 D-Cache 核另需保证缓存一致性） |
| **关外设、进 Stop 休眠、切 RS-485 `DE`、拉高 SPI `CS`** | 看外设物理空闲标志（串口等 `USART_SR.TC == 1`；SPI 等 `BSY == 0`） | 此时外设移位寄存器与缓冲器均已彻底清空，最后 1 bit 停止位或时钟沿已在物理引脚上走完 |

## 七、从 STM32F1 延伸看实用边界与站内关联

把 `STM32F103C8T6` 这一条最小闭环吃透之后，再迁移到其他 STM32 系列或国产 Cortex-M4 平台时，只需要盯住三个差异点就不会迷路：

1. **多控制器与请求路由器升级**：F103C8T6 只有固定映射的 `DMA1`，大容量 F1 或其他平台常配有多个独立 DMA 控制器（如 F1 高密度的 `DMA2`），而更新的系列（如 STM32G4/H7）引入了 `DMAMUX` 把原本死绑在逻辑或门上的请求线改成可软件路由——但不管路由层怎么命名，“控制请求线映射 + 通道任务上下文 + 双总线读写 + 末帧等待外设 `TC`/`BSY`”这套物理骨架完全不变。
2. **多路并发与资源仲裁**：真实项目中往往同时存在屏幕刷屏、传感器采样与 Flash 存储等多路 DMA。本站另一篇工程笔记 [N32G455 SPI 与 DMA 配置参考]({{ '/articles/n32g455-spi-dma-guide.html' | relative_url }}) 演示了如何规划多通道优先级与 NVIC 抢占关系，避免刷屏中断阻塞高频 ADC 采样。
3. **带 D-Cache 内核的一致性边界**：如果代码运行在 Cortex-M7 等带一级数据缓存（D-Cache）的 MCU 上，DMA 与 CPU 所见的 SRAM 视图还可能因缓存滞留而不一致——发送前需要 `clean`、接收前读取前需要 `invalidate`（具体见 ST `AN4839`）。
4. **ST7789 屏幕 `CS` 实战案例**：关于上述 `BSY == 0` 边界在屏幕驱动里的真实应用，可以直接对照 [ST7789 命令时序、窗口配置与像素 DMA 传输参考]({{ '/articles/st7789-command-and-pixel-dma.html' | relative_url }}) 中的命令/像素传输与片选撤除流程。

## 参考资料

1. STMicroelectronics，《DS5319: Medium-density performance line Arm®-based 32-bit MCU (STM32F103x8, STM32F103xB) Datasheet》（Rev 20，2025-07，Table 1/2/5、Figure 1、Figure 11）：[STM32F103C8 官方文档入口](https://www.st.com/en/microcontrollers-microprocessors/stm32f103c8.html)
2. STMicroelectronics，《RM0008: STM32F101xx/F102xx/F103xx/F105xx/F107xx Reference Manual》（Rev 20，2018-12，§3.1 Figure 1、§7.3.6、§13 DMA Figure 48/50 & Table 78、§27.3.13 Figure 297）：[RM0008 Rev 20 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/RM0008_Rev20.pdf)
3. STMicroelectronics，《AN2548: Using the STM32F0/F1/F3/Cx/Gx/Lx Series DMA controller》（Rev 8，2022-12）：[AN2548 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/AN2548_Rev8.pdf)
4. STMicroelectronics，《AN3070: Managing the Driver Enable signal for RS-485 and IO-Link communications with the STM32's USART》（Rev 1，2010-01，§2.1）：[AN3070 PDF](https://www.st.com/resource/en/application_note/an3070-managing-the-driver-enable-signal-for-rs485-and-iolink-communications-with-the-stm32s-usart-stmicroelectronics.pdf)
5. STMicroelectronics，《AN5543: Guidelines for enhanced SPI communication on STM32 MCUs and MPUs》（Rev 4，2024-10，§3.1）：[AN5543 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2020/12/AN5543_Rev4.pdf)
6. STMicroelectronics，《AN5224: STM32 DMAMUX: the DMA request router》（Rev 5，2023-01）与《AN4839: Level 1 cache on STM32F7 Series》（Rev 1，2016-03）：[AN5224 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2018/11/AN5224_Rev5.pdf) · [AN4839 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/DocID029038_Rev1.pdf)
7. STMicroelectronics，`stm32f4xx-hal-driver`（`Src/stm32f4xx_hal_uart.c` 中 `UART_DMATransmitCplt` 等待 `TC` 接力实现参考）：[GitHub 源码](https://github.com/STMicroelectronics/stm32f4xx-hal-driver/blob/6ef30cf0ef6cc29ad518f37b9e6de89b6b815f90/Src/stm32f4xx_hal_uart.c)
