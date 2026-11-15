---
layout: article
title: 为什么 DMA 报“完成”还会丢尾花屏？跟着 STM32F1 走完 3 字节发送全过程
description: 以 STM32F103C8T6 用 USART1_TX 发送 SRAM 中 3 个字节（'A'/'B'/'C'）为例，结合 DS5319 与 RM0008 拆解 DMA1 主从总线接口、7 通道仲裁、固定请求映射、内存地址空间、TDR 双缓冲与 TCIF4 提前置位时序，理清“DMA 搬完”和“引脚发完”两层边界。
date: 2026-11-15
category: 嵌入式
tags:
  - DMA
  - STM32F1
  - USART
  - 总线架构
  - 驱动调试
---

写串口或 SPI 驱动时常遇到一个问题：使用 HAL 库的外设发送完成回调一切正常，但一旦改在裸 DMA 传输完成中断里顺手关掉串口、翻转 RS-485 方向脚 `DE`，或者拉高 SPI 屏幕片选 `CS`，串口报文末尾就会丢掉最后几个字节，屏幕刷新区域的结尾也会多出几个像素花屏。

原因在于，DMA 报告“传输完成”只表示数据搬进了外设发送缓冲，不代表物理引脚已经把最后一个比特移位发完。下面以 **STM32F103C8T6**（中容量 STM32F1，`64 KB Flash` / `20 KB SRAM`）用 `USART1_TX` 发送 SRAM 里的 `tx_buf[3] = {'A', 'B', 'C'}`（`0x41`、`0x42`、`0x43`）为例，对照 ST 官方数据手册 `DS5319 Rev 20` 与参考手册 `RM0008 Rev 20`，从总线结构、请求线、通道寄存器一路跟到移位寄存器和物理波形。文中 ASCII 框图为功能示意（手册未公开门级电路实现），寄存器配置代码依手册语义编写，未在特定实板上实测波形。

## 不用 DMA 时 CPU 慢在哪，DMA 在总线里是什么

如果不开启 DMA，CPU 要把 SRAM 里的 `'A'`、`'B'`、`'C'` 通过 `USART1` 发出去，只能在循环里轮询 `USART_SR.TXE == 1`，再读出 `tx_buf[i]` 写入 `USART1->DR`。数据量大时，这段“查空位 → 读内存 → 写外设”的循环会一直占用 CPU 时间。

DMA 接管的就是这段重复搬运，但芯片里并没有藏着第二个小 CPU 在后台跑 `for` 循环。对照 `DS5319 Rev 20` Figure 1 整芯框图与 `RM0008 Rev 20` §13.1、Figure 48，DMA1 是一块挂在 AHB 高速总线上的数字硬件模块，在总线上同时拥有从接口和主接口两个角色：

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

### 区分三个概念：控制器、通道与一次传输

不要把“7 个通道”当成芯片里有 7 条互不干扰的硬件总线，三者的边界很清楚：

1. **DMA 控制器（Controller）**：真正拥有时钟、仲裁器、内部数据通路和 AHB 主从接口的硬件实体。STM32F103C8T6 片上只有一个 `DMA1`（共 7 个通道），没有 `DMA2`；大容量（High-density）、XL 密度或互联型 F1 芯片才会多出一块独立的 5 通道 `DMA2` 实例，各自有独立的通道和请求映射表。
2. **通道（Channel）**：挂在同一控制器下的一组独立任务上下文（`CPARx`、`CMARx`、`CNDTRx`、`CCRx` 以及对应的中断状态标志）。7 个通道最终都汇向同一个硬件仲裁器和同一个 AHB 主接口，同一拍只能由仲裁器选中一条通道占用总线。
3. **一次传输（Transfer）**：某条通道当前装入并执行的计数搬运任务——本例里就是配置在 `DMA1 Channel 4` 上的这 `3` 个字节任务（`CNDTR4 = 3`）。

## 两条独立路径：固定请求线与总线数据通路

把 `USART1` 和 `DMA1 Channel 4` 配合起来时，很容易混淆“在哪里选通道”和“数据从哪条线走”。实际上芯片内部存在控制握手和数据搬运两条完全不同的物理路径：

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

- **路径一（固定硬件请求映射，对应 `RM0008` Figure 50 & Table 78）**：STM32F1 使用固定请求映射，没有自由路由器，查表可知 `USART1_TX` 硬件固定连到 `DMA1 Channel 4`。这条线只传 `request` 和 `ack` 握手信号，不走数据字节，也不经过 GPIO 引脚。另外 Channel 4 入口是一个逻辑“或”门（logically ORed），上面同时并接着 `TIM1_CH4/TRIG/COM`、`TIM4_CH2`、`SPI2/I2S2_RX` 与 `I2C2_TX`，同一时刻不能同时打开同组多个外设的 DMA 请求。
- **路径二（内存映射数据地址，对应 `DS5319` Figure 11 & `RM0008` §27.6.2）**：在 STM32F103C8 的统一编址空间里，各节点物理地址如下：

| 地址对象 | 所属总线 | 起始/物理地址 | 职责说明 |
| --- | --- | --- | --- |
| 内部 `SRAM`（`tx_buf`） | `BusMatrix` | `0x2000 0000` 起（`20 KB`） | 存放 `'A'`（`0x41`）、`'B'`（`0x42`）、`'C'`（`0x43`） |
| `DMA1` 控制寄存器基址 | `AHB` | `0x4002 0000` | CPU 通过 AHB 从接口配置 Channel 4 参数 |
| `USART1` 外设基址 | `APB2` | `0x4001 3800` | 挂载在 AHB 到 APB2 总线桥 `Bridge 2` 下 |
| `USART1->DR` 数据寄存器 | `APB2` | `0x4001 3804`（偏移 `+0x04`） | `DMA_CPAR4` 填入此地址只用于指明写入目标，并不是用来选通道 |

## 按硬件顺序配置通道 4 与两道使能开关

明确总线和请求路径后，初始化顺序必须配合硬件的时钟和锁存规则（依据 `RM0008 Rev 20` §7.3.6、§13.3.3 与 §27.3.13）：

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

这里有两条常见的硬件约束：
1. **先开 `RCC_AHBENR.DMA1EN`**：时钟没打开之前写 `CPAR` 或 `CMAR` 都会被忽略，调试时容易出现参数怎么写都不生效的情况。
2. **`EN = 1` 期间通道锁定**：只要 `DMA_CCR4.EN` 为 `1`，硬件禁止修改 `CNDTR4`、`CPAR4` 或 `CMAR4`；并且只有 `DMA_CCR4.EN == 1` 和 `USART_CR3.DMAT == 1` 两个开关同时打开，串口的 `TXE` 事件才会发向通道 4。

## `'A'`、`'B'`、`'C'` 搬运与双缓冲时序

两道开关闭合时，因为 `USART1` 发送缓冲本来是空的（`USART_SR.TXE == 1`），串口立刻向 `DMA1 Channel 4` 发出第 1 次硬件请求。下面按时间顺序跟完这 3 个字节在芯片内部的动作。

### 第 1 字节 `'A'`：仲裁、跨桥读写、握手与影子指针步进

1. **两级仲裁**：请求进入 `DMA1` 仲裁器后，先比软件优先级 `PL[1:0]`；同等级下再比通道号，编号越小优先级越高（例如同级时 `Ch2` 优先于 `Ch4`）。本例只有 `Ch4` 活跃，仲裁器直接把 `AHB Master` 接口交给通道 4。
2. **两笔总线事务与握手**：
   - 第一笔，`DMA1` AHB 主口将 `tx_buf` 首地址送上 `BusMatrix`，选通 SRAM，读出 `'A'`（`0x41`）暂存到 DMA 内部数据通路。
   - 第二笔，主口发出 `0x4001 3804`，经 `BusMatrix → AHB system bus → Bridge 2（AHB→APB2 桥）→ APB2` 把 `0x41` 写入 `USART1->DR`。写入使 `USART_SR.TXE` 短暂清零；随后 `DMA1` 沿控制线回送 `ack`，`USART1` 撤回 `request`，`DMA1` 再撤回 `ack` 完成一次握手。
3. **内部影子寄存器步进**：
   - 通道 4 内部有一组软件看不到的“当前内存地址 / 当前外设地址”工作指针。第 1 字节写完后，真正 `+1` 指向 `'B'` 的是内部当前内存地址；程序回头读 `DMA_CMAR4`，读到的依然是初始数组首地址，当前外设地址也因 `PINC = 0` 继续停在 `USART1->DR`。
   - 内部计数器同步减 1，软件可读的 `DMA_CNDTR4` 从 `3` 变成 `2`。
4. **串口双级缓冲与 `TXE` 立即回升**：
   - `USART1->DR` 在发送方向上是发送数据缓冲器（`TDR`），后端接着物理发送移位寄存器。开始时移位寄存器是空的，写进 `TDR` 的 `'A'` 立刻落入移位寄存器，按波特率从 `PA9` 引脚逐位发送 `Frame 1`（开启 DMA 不会加快波特率，它省掉的是 CPU 轮询和搬运的时间）。
   - `'A'` 落入移位寄存器的瞬间，`TDR` 再次变空，硬件随即把 `USART_SR.TXE` 重新置 `1`。

### 第 2、第 3 字节与 `RM0008 Figure 297` 三帧时序

对照 `RM0008 Rev 20` §27.3.13 Figure 297，`'A'`、`'B'`、`'C'` 三帧在总线、`TDR` 和 `PA9` 引脚上的时间对齐如下：

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

其中最关键的三拍接力是：

1. **`Frame 1` 刚起步（移位器 = `'A'`）**：`'A'` 掉进移位器让 `TDR` 变空，`TXE` 第二次置 `1` 并立刻拉起第 2 次 DMA 请求。DMA 读出 `'B'`（`0x42`）写入 `TDR`（`CNDTR4: 2 → 1`，内部指针指 `'C'`）。由于移位器还在发 `'A'`，`'B'` 暂时留在 `TDR` 里等待，整个 `Frame 1` 期间 `TXE` 保持为 `0`。
2. **`Frame 1 → Frame 2` 交界（移位器 = `'B'`）**：`'A'` 的停止位刚结束，`'B'` 装入移位器开始发 `Frame 2`；`TDR` 再次腾空，`TXE` 第三次置 `1`，触发第 3 次 DMA 请求。DMA 读出最后一个字节 `'C'`（`0x43`）写入 `TDR`（`CNDTR4: 1 → 0`）。
3. **`TCIF4 = 1` 在 `Frame 2` 开头就置起了**：
   `'C'` 刚写进 `TDR`、`DMA_CNDTR4` 归零的这一拍，DMA1 内部就认定 3 个字节全部搬完了，`DMA_ISR` 中的通道 4 传输完成标志 `TCIF4` 立刻置 `1`。如果开启了 `TCIE`，CPU 此时就会进 DMA 完成中断。
   随后 `'B'` 发完、`'C'` 进移位器开始发送 `Frame 3` 时，`TDR` 会第四次腾空置起 `TXE = 1`，但正如 `RM0008 Figure 297` 右侧标出的那样：Normal（单次）模式下计数已经归零，DMA 会忽略这一次请求。下一包发送前必须按顺序操作：**先关 `DMA_CCR4.EN` → 向 `DMA_IFCR` 写 `CTCIF4` 清标志位 → 重写 `DMA_CNDTR4`（及必要地址）→ 重新置 `EN = 1`**。

## 总线矩阵并发与竞争：DMA 为什么不会卡死 CPU

按 `RM0008` Figure 1 的系统架构，DMA 和 CPU 共享总线的规则很清楚：

```text
[ Cortex-M3 内核 ]
   |-- ICode 总线  --> Flash 接口 (FLITF) --> [ Flash ]   <-- 并行路径，与 DMA1 访 SRAM 不交叉！
   |-- DCode 总线  --> Flash 接口 (FLITF) --> [ Flash ]
   '-- System 总线 ---+
                      |---> [ 多层 AHB 总线矩阵 (BusMatrix) ] ---> SRAM / AHB / Bridge 2 -> APB2
[ DMA1 AHB Master ] --+
```

- **不同目标并行**：`DMA1` 经 `BusMatrix` 读写 SRAM 或跨 `Bridge 2` 访问 `APB2`（`USART1`）时，如果 CPU 正在通过 `ICode`/`DCode` 总线从 Flash 取指或读常量，由于经过多层总线矩阵且访问目标不同，两条通路互不干扰，可以并行访问。
- **同目标轮询且有带宽兜底**：只有当 CPU 的 `System` 总线和 `DMA1` 同一周期访问同一个目标（比如同时读写 SRAM，或同时跨 `Bridge 2` 访问 `APB2`）时，总线矩阵按轮询仲裁让其中一方等几个周期；即使发生满负荷争用，硬件也会为 CPU 保留至少一半的 AHB 带宽，不会让 CPU 停摆。另外，DMA 只能访问挂载在总线上的存储器和外设地址，无法直接读写 CPU 内核通用寄存器。

## 回到开头的故障：“DMA 搬完” vs “引脚发完”

把最后两帧放开来看，开头的丢尾和花屏原因就很清楚了：

1. **为什么裸 DMA 中断会丢尾、花屏**：
   `TCIF4 = 1` 触发 DMA 完成中断时，DMA1 只是刚把第 3 字节 `'C'` 放进串口的 `TDR`。此时线上 `'B'`（`Frame 2`）才刚开始移位，`'C'`（`Frame 3`）还在 `TDR` 里连移位器都没进，物理引脚上还有接近两帧数据没发出去。
   SPI 刷屏是同样的道理：TX DMA 把最后几个像素放进 SPI 发送缓冲就置起完成标志，SPI 移位器这时还在输出最后几个字节的 SCK 时钟。如果直接在裸 DMA 中断里关串口、切 RS-485 `DE` 脚，或者拉高 SPI `CS` 片选，移位器和发送缓冲里剩下的最后两帧物理波形就会被当场截断——串口表现为丢尾字节，SPI 屏幕表现为刷新条带末尾几个像素花屏。
2. **HAL 库外设回调多等了哪一步**：
   参考 ST 官方驱动（例如 HAL 串口 Normal 发送路径 `UART_DMATransmitCplt` 和 `AN3070` 对 RS-485 的说明）：HAL 进到 DMA 传输完成中断后不会立刻回调用户函数，而是关闭串口 `USART_CR3.DMAT`，转手打开串口自身的传输完成中断 `USART_CR1.TCIE`；直到 `Frame 3`（`'C'`）最后一个停止位走出 `PA9`、硬件将 `USART_SR.TC` 置 `1`，才调用 `HAL_UART_TxCpltCallback()`。
   SPI 也是同理：TX DMA 完成后，还要等外设空闲（如 `TXE == 1 && SPI_SR.BSY == 0`）才能拉高 `CS`。

写 DMA 发送驱动时，必须按操作目的区分两个完成边界：

| 操作需求 | 依据的硬件标志 | 原因 |
| --- | --- | --- |
| 复用或改写 SRAM 发送缓冲区 `tx_buf` | DMA 完成标志（如 `TCIF4 == 1`） | 最后一字节已从 SRAM 读出写入外设缓冲，不再访问内存（带 D-Cache 内核另需处理缓存一致性） |
| 关外设、进 Stop 休眠、切 RS-485 `DE`、拉高 SPI `CS` | 外设物理空闲标志（串口 `USART_SR.TC == 1`；SPI `BSY == 0`） | 移位寄存器与发送缓冲均已清空，最后 1 bit 停止位或时钟沿已在物理引脚走完 |

## 扩展到其他 STM32 与站内关联

换到其他 STM32 系列或同类 Cortex-M4 MCU 时，请求映射、通道上下文、双总线读写以及末帧等待外设空闲这几层物理关系不变，主要注意三个差异：

1. **多控制器与可编程请求路由**：F103C8T6 只有固定映射的 `DMA1`，大容量 F1 或其他 MCU 常带有多个 DMA 控制器（如 `DMA2`），较新的 STM32G4/H7 则引入了 `DMAMUX`，把原本固定连在逻辑或门上的请求线改成可软件路由。
2. **多通道并发与优先级**：同时跑屏幕刷屏、传感器采样和 Flash 存储时，要合理规划 DMA 通道和 NVIC 抢占优先级。站内笔记 [N32G455 SPI 与 DMA 配置参考]({{ '/articles/n32g455-spi-dma-guide.html' | relative_url }}) 整理了多路 SPI 共用 DMA1 时的优先级配置。
3. **带 D-Cache 内核的一致性**：在 Cortex-M7 等带一级数据缓存（D-Cache）的芯片上，DMA 与 CPU 看到的 SRAM 视图可能不一致，发送前需要 `clean`、接收后读取前需要 `invalidate`（参考 ST `AN4839`）。
4. **ST7789 片选收尾实例**：关于 `BSY == 0` 边界在 SPI 屏幕驱动里的写法，可以对照 [ST7789 命令时序、窗口配置与像素 DMA 传输参考]({{ '/articles/st7789-command-and-pixel-dma.html' | relative_url }})。

## 参考资料

1. STMicroelectronics，《DS5319: Medium-density performance line Arm®-based 32-bit MCU (STM32F103x8, STM32F103xB) Datasheet》（Rev 20，2025-07，Table 1/2/5、Figure 1、Figure 11）：[STM32F103C8 官方文档入口](https://www.st.com/en/microcontrollers-microprocessors/stm32f103c8.html)
2. STMicroelectronics，《RM0008: STM32F101xx/F102xx/F103xx/F105xx/F107xx Reference Manual》（Rev 20，2018-12，§3.1 Figure 1、§7.3.6、§13 DMA Figure 48/50 & Table 78、§27.3.13 Figure 297）：[RM0008 Rev 20 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/RM0008_Rev20.pdf)
3. STMicroelectronics，《AN2548: Using the STM32F0/F1/F3/Cx/Gx/Lx Series DMA controller》（Rev 8，2022-12）：[AN2548 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/AN2548_Rev8.pdf)
4. STMicroelectronics，《AN3070: Managing the Driver Enable signal for RS-485 and IO-Link communications with the STM32's USART》（Rev 1，2010-01，§2.1）：[AN3070 PDF](https://www.st.com/resource/en/application_note/an3070-managing-the-driver-enable-signal-for-rs485-and-iolink-communications-with-the-stm32s-usart-stmicroelectronics.pdf)
5. STMicroelectronics，《AN5543: Guidelines for enhanced SPI communication on STM32 MCUs and MPUs》（Rev 4，2024-10，§3.1）：[AN5543 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2020/12/AN5543_Rev4.pdf)
6. STMicroelectronics，《AN5224: STM32 DMAMUX: the DMA request router》（Rev 5，2023-01）与《AN4839: Level 1 cache on STM32F7 Series》（Rev 1，2016-03）：[AN5224 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2018/11/AN5224_Rev5.pdf) · [AN4839 PDF](https://www.stmcu.jp/wp/wp-content/uploads/2017/08/DocID029038_Rev1.pdf)
7. STMicroelectronics，`stm32f4xx-hal-driver`（`Src/stm32f4xx_hal_uart.c` 中 `UART_DMATransmitCplt` 等待 `TC` 接力实现参考）：[GitHub 源码](https://github.com/STMicroelectronics/stm32f4xx-hal-driver/blob/6ef30cf0ef6cc29ad518f37b9e6de89b6b815f90/Src/stm32f4xx_hal_uart.c)
