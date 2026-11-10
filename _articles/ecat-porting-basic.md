---
layout: article
title: EtherCAT 从站协议栈移植、动态 PDO 与状态机基础
description: STM32F407 + LAN9252 的 Beckhoff SSC 从站移植笔记：PDI 与中断适配、同步模式、CoE 对象字典与动态 PDO、ETG.5001 Slot/Module、ESI/EEPROM 一致性，以及 ESM 状态机与 AL Status Code 排查。
date: 2026-05-18
category: 嵌入式
tags:
  - EtherCAT
  - STM32
  - LAN9252
  - 协议栈移植
  - CoE
  - TwinCAT
---

这是一份 Beckhoff SSC（Slave Stack Code）移植笔记，以 STM32F407 + Microchip LAN9252 为主，也会对照 ET1100/ET1200 的差异。主站使用 TwinCAT 3。

## 这篇笔记覆盖什么

移植 EtherCAT 从站时，问题往往不是出在某一行代码上，而是 **ESC 硬件、SSC 配置、对象字典、ESI/EEPROM 这几方没有对齐**。所以这篇笔记按照“从硬件到状态机”的顺序展开，每一层都会落到移植中真正会出错的点：

| 章节 | 解决的问题 |
| --- | --- |
| 从站系统架构 | ESC 和 MCU 各自做什么，LAN9252 与 ET1100/ET1200 有什么不同 |
| 硬件接口与上电初始化 | PDI 怎么选，IRQ/SYNC/定时器怎么接，EEPROM 决定了哪些东西 |
| SSC 移植路径 | 硬件抽象层要实现哪些接口，中断重入怎么防，回调怎么写 |
| 同步模式 | FreeRun、SM 同步、DC 同步的区别以及周期预算 |
| CoE 对象字典与 PDO 映射 | `TOBJECT`、三级映射、动态 PDO、位长与对齐 |
| ETG.5001 Slot/Module | `0xF0xx` 对象、索引步进与错位陷阱 |
| ESI、EEPROM 与代码一致性 | 改了 XML 之后必须做的几件事 |
| ESM 状态机 | 每次状态跃迁主站配了什么、从站校验了什么 |
| 故障排查 | 常见 AL Status Code 与排查顺序 |

如果只是想快速定位报错，可以直接跳到文末的 AL Status Code 速查表；如果是第一次移植，建议从头按顺序读，因为后面的报错几乎都能追溯到前面某一层的配置。

## 从站系统架构

### ESC 与 MCU 的分工

一个带 MCU 的 EtherCAT 从站由两部分组成：

- **ESC（EtherCAT Slave Controller）**：本文中是 LAN9252。它负责以太网帧的收发与转发、按地址读写自己的寄存器和过程数据 RAM、SyncManager 缓冲管理、FMMU 地址映射、分布式时钟（DC）以及看门狗。这些都是硬件完成的，与 MCU 是否在运行无关。
- **MCU（应用控制器）**：本文中是 STM32F407。它通过 PDI（Process Data Interface）访问 ESC，运行 SSC 协议栈，负责状态机（ESM）的软件部分、邮箱协议（CoE/FoE 等）、对象字典，以及最终的业务逻辑。

可以把 ESC 理解为“带有一致性保护的双口 RAM”：主站从网线一侧读写，MCU 从 PDI 一侧读写，SyncManager 负责保证两侧不会读到半新半旧的数据。

```text
          EtherCAT 帧（主站 → 从站 → 下一站 → … → 返回主站）
                         │
     ┌───────────────────▼────────────────────┐
     │  ESC（LAN9252）                         │
     │  寄存器区 0x0000–0x0FFF                  │
     │  Process RAM 0x1000–0x1FFF（4 KB）       │
     │  SyncManager ×4 / FMMU ×3 / DC / WD     │
     └───────────────────▲────────────────────┘
                         │ PDI：SPI 或 HBI
     ┌───────────────────┴────────────────────┐
     │  MCU（STM32F407）                        │
     │  硬件抽象层 → SSC 通用协议栈 → 用户应用   │
     └────────────────────────────────────────┘
```

### “边过边处理”对从站意味着什么

EtherCAT 帧经过每个从站时不会被完整接收后再转发，而是由 ESC 在帧流过时直接读出或写入属于自己的数据，然后继续转发到下一个端口，整个网络在逻辑上构成一个环。这对从站软件有两个直接影响：

1. **MCU 不参与帧级处理**。即使 MCU 卡死，ESC 仍然会转发帧，主站依然能扫描到从站、读取 EEPROM。所以“能扫描到从站”只能说明 ESC 和物理层正常，不能说明 MCU 侧移植正确。
2. **MCU 只能在两帧之间处理数据**。主站写入 SM2 的输出数据，要等 MCU 通过 PDI 读走；MCU 写入 SM3 的输入数据，要等下一帧经过时才被带回主站。PDI 读写的耗时会直接压缩可用的通信周期，这也是后面讨论 SPI 速率和同步模式的原因。

### LAN9252、ET1100、ET1200 的差异

三者都是常见的从站 ESC，但 PDI、内存和外围电路差别很大，移植时不能直接套用对方的 EEPROM 配置和驱动：

| 项目 | LAN9252 | ET1100 | ET1200 |
| --- | --- | --- | --- |
| 端口与 PHY | 2/3 端口，**集成两个以太网 PHY** | 2–4 端口（EBUS/MII），以太网需外接 PHY | 2–3 端口（最多 1 个 MII），以太网需外接 PHY |
| FMMU / SyncManager | 3 / 4 | 8 / 8 | 3 / 4 |
| Process RAM | 4 KB | 8 KB | 1 KB |
| MCU 接口 | SPI/SQI、HBI（复用或索引，8/16 位） | SPI、8/16 位异步或同步 µC 并口 | SPI（无 µC 并口） |
| 内部寄存器访问 | **间接访问**：经 CSR 命令/数据寄存器 | PDI 直接寻址 | PDI 直接寻址 |
| SPI 的 PDI 类型码（0x0140） | `0x80` | `0x05` | `0x05` |

最后一行很关键：PDI 类型由 EEPROM 决定，而 LAN9252 和 Beckhoff ASIC 对同一种 SPI 接口使用的编码并不相同。从 ET1100/ET1200 的例程迁移到 LAN9252 时，如果直接复用旧的 ESI 和 EEPROM 镜像，PDI 根本不会按预期工作。

### TwinCAT 3 在调试中的角色

在联调中，TwinCAT 3 不只是“发周期帧的主站”，它同时是最重要的诊断工具：

- **扫描与识别**：读取从站 EEPROM 中的身份信息，并与 ESI 缓存匹配。
- **EEPROM 烧写**：把 ESI 生成的 SII 镜像写入从站 EEPROM。
- **CoE-Online**：在 Pre-Op 及以上状态浏览、读写从站对象字典，用来验证 SDO 通道和对象定义。
- **状态推进与诊断**：手动请求 Init/Pre-Op/Safe-Op/Op，在 Logger 和从站的 Online 页查看 AL Status 与 AL Status Code。

## 硬件接口与上电初始化

### PDI：SPI 还是 HBI/FSMC

MCU 与 LAN9252 对接时，需要适配三类资源：PDI 总线、三个外部中断（`IRQ`、`SYNC0`、`SYNC1`），以及一个 1 ms 时基。先看 PDI：

| 方案 | 接线 | 速率与特点 | 适用场景 |
| --- | --- | --- | --- |
| **SPI** | SCK/SI/SO/SCS# 四线 | LAN9252 支持最高 80 MHz；普通读指令 `0x03` 限 30 MHz，更高频率需用 `0x0B` Fast Read（带 dummy 字节） | 引脚少，PDO 数据量不大、周期在毫秒级的场景 |
| **SQI** | 6 线（四数据线） | 四线并行，速率最高 | MCU 有 QSPI 主机且需要更高吞吐 |
| **HBI（STM32 用 FSMC）** | 8/16 位数据 + 地址/控制线 | 并行总线，吞吐高、单次访问延迟低；支持复用地址/数据和索引两种模式 | 过程数据量大、周期短，或需要 DC 高频同步 |

STM32F407 的 SPI1 位于 APB2，最高可以跑到 42 MHz 左右。这超过了 LAN9252 普通读指令的 30 MHz 上限：要么把 SPI 时钟降到 30 MHz 以内，要么在驱动里改用 Fast Read。这个限制容易被忽略，表现为写入正常而读出的数据偶发错误。

另外，LAN9252 的 SPI 地址按高字节在前发送，数据却按小端（低字节在前）传输。自己写驱动时，字节序要分别处理。

### LAN9252 的间接寄存器访问

LAN9252 的地址空间分为两层，这是它与 ET1100 在驱动层面最大的不同：

- **直接寻址的系统 CSR**：例如 `BYTE_TEST`（`0x064`）、`HW_CFG`（`0x074`）、中断配置 `IRQ_CFG`（`0x054`）和中断使能 `INT_EN`（`0x05C`），以及 EtherCAT CSR 接口和 Process RAM FIFO 寄存器。
- **间接寻址的 EtherCAT Core**：标准 ESC 寄存器（`0x0000–0x0FFF`）和 Process RAM（`0x1000` 起），必须通过 `ECAT_CSR_CMD`（`0x304`）和 `ECAT_CSR_DATA`（`0x300`）间接访问。

间接读一个 Core 寄存器的流程如下（以读取 `0x1000` 处 4 字节为例，命令字取自 Microchip AN1995）：

```c
/* 1. 写命令：CSR_BUSY=1，R_nW=1（读），CSR_SIZE=4，CSR_ADDR=0x1000 */
write_dword(ECAT_CSR_CMD /* 0x304 */, 0xC0041000);

/* 2. 轮询 CSR_BUSY 清零 */
while (read_dword(ECAT_CSR_CMD) & 0x80000000) { }

/* 3. 从数据寄存器取回结果（低位对齐） */
uint32_t val = read_dword(ECAT_CSR_DATA /* 0x300 */);
```

写操作的顺序相反：先把数据写入 `ECAT_CSR_DATA`，再向 `ECAT_CSR_CMD` 写入 R_nW=0 的命令（如 `0x80041000`），然后等待 BUSY 清零。Process RAM 的批量读写走另一组 FIFO 寄存器（`ECAT_PRAM_RD_ADDR_LEN` `0x308`、`ECAT_PRAM_RD_CMD` `0x30C`、`ECAT_PRAM_WR_ADDR_LEN` `0x310`、`ECAT_PRAM_WR_CMD` `0x314`，以及数据 FIFO），每次命令可以连续搬运多个 DWORD，效率比逐个 CSR 访问高得多。

一次“读 ESC 寄存器”在 LAN9252 上至少包含写命令、轮询、读数据三次 SPI 事务。如果这个过程中被打断，CSR 命令寄存器就会被覆盖，后文的中断重入问题正是由此产生的。

### IRQ、SYNC0/SYNC1 与 1 ms 定时器

| 硬件资源 | 信号 / 外设 | 职责与注意事项 |
| --- | --- | --- |
| **PDI 中断** | `IRQ` → EXTI | 通知 MCU 有 AL Event（主要是 SM2 输出写入或 SM3 输入被读走）。LAN9252 的 `IRQ_CFG` 默认是开漏输出、低有效，`IRQ_EN` 默认关闭：MCU 侧需要上拉并配置下降沿触发，软件里还要打开 `IRQ_EN` 和 `INT_EN` 中的 EtherCAT 中断位。 |
| **DC 同步中断** | `SYNC0` / `SYNC1` → EXTI | DC 模式下由 ESC 按主站设定的周期产生硬件脉冲。输出驱动方式、极性以及是否映射到 AL Event，都由 EEPROM 配置区写入 `0x0151`，接线前要先确认 ESI 里的配置。 |
| **1 ms 时基** | 基础定时器（如 `TIM6`） | 供 SSC 做状态切换超时、邮箱超时、本地看门狗等计时。`ECAT_TIMER_INT = 1` 时在定时器中断里每 1 ms 调用 `ECAT_CheckTimer()`。 |

### EEPROM（SII）决定了什么

LAN9252 上电或复位后，会先从外部 I2C EEPROM 加载 SII（Slave Information Interface）内容。其中最开头的 ESC 配置区直接决定了芯片的硬件行为：

| EEPROM 字 | 加载到的寄存器 | 作用 |
| --- | --- | --- |
| 字 0 [7:0] | PDI Control `0x0140` | PDI 类型：`0x80` SPI，`0x88`–`0x8D` 各种 HBI 模式，`0x04` 数字 I/O |
| 字 0 [15:8] | ESC Configuration `0x0141` | 设备仿真（Device Emulation）、增强链路检测等 |
| 字 1 | PDI Configuration `0x0150` / `0x0151` | HBI 极性与时序、SYNC0/SYNC1 输出驱动与映射 |
| 字 2 | `0x0982:0x0983` | SYNC 脉冲宽度 |
| 字 3 | Extended PDI Configuration `0x0152` | SPI 模式下 16 个 GPIO 的方向等 |

配置区之后才是 Vendor ID、Product Code、Revision、Serial Number 等身份信息，以及邮箱、SyncManager、PDO 等类别数据。由此可以得出两个结论：

1. **EEPROM 空白或内容错误时，MCU 侧的 PDI 可能完全不通**。LAN9252 的 Process RAM 也只有在 EEPROM 正确加载后才能访问。
2. **EEPROM 由 ESI 生成**。所以 ESI 里的 PDI 配置写错，表现出来却像是“SPI 驱动有问题”。

### 上电就绪检测

LAN9252 数据手册规定了明确的就绪判断顺序，`HW_Init()` 里应当照此实现：

1. 轮询 **`BYTE_TEST`（`0x064`）**，直到读回 **`0x87654321`**。读到这个值说明主机接口已退出复位，同时也验证了字节序和 SPI 时序。
2. 再轮询 **`HW_CFG`（`0x074`）的 `READY` 位（bit 27）**，置位后才表示整个芯片复位与配置完成。在 `READY` 置位之前，除 `HW_CFG`、`PMT_CTRL`、`BYTE_TEST`、`RESET_CTL` 外不应读其他资源，写入则一律无效。
3. 就绪后读一次 PDI Control `0x0140`，确认它与预期的 PDI 类型一致（SPI 应为 `0x80`）。这一步能快速区分“驱动问题”和“EEPROM 配置问题”。

```c
UINT16 HW_Init(void)
{
    uint32_t v;
    /* 第 1 步：等待主机接口退出复位 */
    do { v = PDI_ReadDWord(0x0064); } while (v != 0x87654321UL);
    /* 第 2 步：等待 HW_CFG.READY（bit 27） */
    do { v = PDI_ReadDWord(0x0074); } while ((v & (1UL << 27)) == 0);
    /* 第 3 步：配置 IRQ_CFG / INT_EN、AL Event Mask，初始化 EXTI 与定时器 */
    /* 实际工程中应给两个循环加超时并返回非 0 错误码 */
    return 0;
}
```

## SSC 移植路径

### SSC Tool 生成与裁剪宏

SSC 需要以 ETG 会员身份下载，通常借助 SSC Tool 生成工程：选择硬件配置和应用，导入用 Excel 表格描述的对象字典，最后生成源文件和配套的 ESI。生成的代码分为三层：

- **硬件抽象层**：与平台相关，需要自己实现。Beckhoff 的参考实现是 `el9800hw.c`，Microchip LAN9252 SDK 对应的是 `9252_HW.c` / `9252_HW.h`。
- **通用协议栈**：`ecatslv.c`（状态机）、`ecatappl.c`（过程数据）、`mailbox.c`、`coeappl.c`、`objdef.c` 等，原则上不用修改，只通过宏配置。
- **用户应用**：例如本工程的 `ssc-9252.c` / `ssc-9252.h` 和 `SSC-9252Objects.h`。SSC Tool 会把应用表格生成为 `[表名]Objects.h`（变量声明和对象描述）与 `[表名].c`（映射函数与应用函数的空实现）。

`ecat_def.h` 里与移植关系最密切的宏如下：

| 宏 | 含义 | 本工程的考虑 |
| --- | --- | --- |
| `AL_EVENT_ENABLED` | 是否使用 PDI 中断（`PDI_Isr`） | SM 同步或 DC 同步时设为 1 |
| `DC_SUPPORTED` | 是否处理 SYNC0/SYNC1（`Sync0_Isr`/`Sync1_Isr`） | 用到 DC 时设为 1 |
| `ECAT_TIMER_INT` | 是否在定时器中断里调用 `ECAT_CheckTimer()` | 推荐设为 1 |
| `COE_SUPPORTED` | 是否支持 CoE | 动态 PDO、Slot/Module 都依赖 CoE |
| `ESC_32BIT_ACCESS` / `ESC_16BIT_ACCESS` | 对 ESC 的访问宽度 | LAN9252 的寄存器按 DWORD 组织，要与驱动实现一致 |
| `MIN_PD_WRITE_ADDRESS` 等地址范围宏 | SM 起始地址的合法范围 | 必须落在 LAN9252 的 `0x1000–0x1FFF` 之内 |
| `MAX_PD_INPUT_SIZE` / `MAX_PD_OUTPUT_SIZE` | 过程数据长度上限 | 模块化设备挂满 Slot 时最容易超出 |
| `MIN_MBX_SIZE` / `MAX_MBX_SIZE` | 邮箱长度范围 | 要与 ESI 中的 `<Sm>` 定义一致 |

地址范围宏需要特别注意：SSC 的默认示例按 8 KB RAM（ET1100）的芯片生成，地址上限可能写到 `0x3000`。换成只有 4 KB RAM 的 LAN9252 后，如果不修改，从站就会接受一个实际上不存在的 SM 地址。

### 硬件抽象层接口

硬件抽象层需要实现下面这些接口，SSC 会通过它们访问 ESC：

```c
UINT16 HW_Init(void);                 /* 初始化 PDI、中断、定时器，等待 ESC 就绪 */
void   HW_Release(void);
UINT16 HW_GetALEventRegister(void);       /* 读 AL Event Request 0x0220，主循环用 */
UINT16 HW_GetALEventRegister_Isr(void);   /* 同上，中断上下文用 */
void   HW_SetALEventMask(UINT16 intMask); /* 写 AL Event Mask 0x0204 */
void   HW_ResetALEventMask(UINT16 intMask);
void   HW_EscRead(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_EscReadIsr(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_EscWrite(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_EscWriteIsr(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_EscReadMbxMem(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_EscWriteMbxMem(MEM_ADDR *pData, UINT16 Address, UINT16 Len);
void   HW_DisableSyncManChannel(UINT8 channel);
void   HW_EnableSyncManChannel(UINT8 channel);
TSYNCMAN ESCMEM *HW_GetSyncMan(UINT8 channel);
```

在 Microchip LAN9252 SDK 中，底层总线访问函数沿用了 `PMP`（Parallel Master Port，PIC32 的并口外设）前缀。即使底层改成了 SPI，很多移植工程也保留这套封装：

1. `PMPReadWord` / `PMPWriteWord`：16 位读写。
2. `PMPReadDWord` / `PMPWriteDWord`：32 位读写，对应 LAN9252 直接寻址的系统 CSR。
3. `PMPReadRegUsingCSR` / `PMPWriteRegUsingCSR`：通过 `ECAT_CSR_CMD`（`0x304`）与 `ECAT_CSR_DATA`（`0x300`）间接读写 EtherCAT Core 寄存器。
4. `PMPReadPDRamRegister` / `PMPWritePDRamRegister`：通过 Process RAM FIFO 批量读写过程数据。

移植时，只需要把这几个函数的底层替换成 STM32 的 SPI 或 FSMC 访问。常见的做法是在 `HW_EscRead` 中按地址分流：`Address < 0x1000` 走 CSR 间接访问，`>= 0x1000` 走 Process RAM FIFO。

### 中断与临界区（关键易错点）

协议栈依赖下面几个入口的协同调用：

| 入口 | 调用位置 | 条件 |
| --- | --- | --- |
| `MainLoop()` | `while (1)` 中反复调用 | 总是需要。内部依次执行 `ECAT_Main()` 和 `CoE_Main()`；FreeRun 模式下还会执行过程数据映射与应用函数 |
| `PDI_Isr()` | `IRQ` 引脚的 EXTI 中断 | `AL_EVENT_ENABLED = 1` |
| `Sync0_Isr()` / `Sync1_Isr()` | `SYNC0`/`SYNC1` 引脚的 EXTI 中断 | `DC_SUPPORTED = 1` |
| `ECAT_CheckTimer()` | 1 ms 定时器中断 | `ECAT_TIMER_INT = 1` |

需要注意，SSC 在 `PDI_Isr()` 中真正处理的只有过程数据 SyncManager 事件：有输出时是 SM2，只有输入时是 SM3。状态切换请求、邮箱事件等其余 AL Event 都由 `MainLoop()` 轮询 `0x0220` 来处理。因此“状态切换不响应”优先查主循环是否被阻塞，“OP 下数据不更新”才优先查 IRQ。

**SPI/HBI 总线重入冲突是 LAN9252 移植中最典型的问题。** 结合上一节的间接访问流程来看：主循环正在读 `0x0120`，刚把命令写入 `ECAT_CSR_CMD`，`PDI_Isr()` 就进来了，在中断里又发起一次对 `0x0220` 的访问，覆盖了 CSR 命令寄存器；中断返回后，主循环从 `ECAT_CSR_DATA` 读到的其实是 `0x0220` 的内容。如果中断恰好打断了一次 SPI 事务的中间阶段，片选和时序还会直接错乱。Microchip AN1995 专门描述过这个场景，结论是**访问 EtherCAT Core 寄存器期间必须屏蔽中断**。

落到代码上，需要做到三点：

1. **正确实现 `DISABLE_ESC_INT()` / `ENABLE_ESC_INT()`**。SSC 文档要求这对宏屏蔽和恢复“全部四个中断源”：`IRQ`、`SYNC0`、`SYNC1` 以及 1 ms 定时器。主循环中每次访问 ESC 都要包在这对宏之间。
2. **四个中断配置为相同的抢占优先级**，禁止互相抢占嵌套。否则 `Sync0_Isr()` 仍然可能打断正在访问 ESC 的 `PDI_Isr()`。
3. **防止丢中断**。如果 `IRQ` 用边沿触发，屏蔽期间到来的边沿一旦丢失，而 ESC 的 IRQ 又一直保持有效电平，后面就再也不会有新的边沿，现象是 OP 下数据停止更新，最后报 `0x001B`。比较稳妥的做法是在 NVIC 层面屏蔽（例如 `NVIC_DisableIRQ` 或 `BASEPRI`），让 EXTI 的挂起位保留下来；同时参考 Microchip SDK 的做法，在恢复中断后检查一次 IRQ 引脚电平，如果仍为有效电平就补调一次处理。

```c
/* 示意：用 BASEPRI 一次性屏蔽 ESC 相关的四个中断（它们使用同一优先级） */
#define ESC_IRQ_PRIO   5U
#define DISABLE_ESC_INT()  __set_BASEPRI(ESC_IRQ_PRIO << (8U - __NVIC_PRIO_BITS))
#define ENABLE_ESC_INT()   __set_BASEPRI(0U)
```

使用 `BASEPRI` 时要确保更高优先级的中断（如电机 PWM 保护）完全不访问 ESC，否则仍然会发生重入。

### 应用层回调

SSC 把与具体业务相关的逻辑留给应用层实现，回调分为两类。

**周期性过程数据回调。** 每个通信周期都按 `OutputMapping → Application → InputMapping` 的固定顺序执行，什么时候触发由同步模式决定：

1. `APPL_OutputMapping(UINT16 *pData)`：**输出映射（RxPDO，主站 → 从站）**。协议栈已经把 SM2 的数据拷贝到本地，这里把它解包到输出对象变量（如 `0x7000` 区的变量）。
2. `APPL_Application(void)`：**自定义应用逻辑**。根据主站下发的控制字或目标值执行控制算法、驱动外设，并采集本地传感器和状态数据写入输入对象变量。
3. `APPL_InputMapping(UINT16 *pData)`：**输入映射（TxPDO，从站 → 主站）**。把输入对象变量（如 `0x6000` 区的变量）打包到 `pData`，之后由协议栈写入 SM3。

打包时要注意，SSC 生成的 ARRAY/RECORD 结构体第一个成员是 16 位的 `u16SubIndex0`，它不属于过程数据。用 `memcpy` 整块拷贝时要跳过这 2 字节，否则整帧数据都会错位。

**状态转换回调。** 这类回调在状态切换时由 `AL_ControlInd()` 调用。返回值 `0` 表示允许切换；`0xFF`（`NOERROR_INWORK`）表示切换尚未完成，需要应用稍后调用 `ECAT_StateChange()` 完成；其他值会作为 AL Status Code 拒绝这次切换：

| 回调 | 调用时机 | 典型用途 |
| --- | --- | --- |
| `APPL_StartMailboxHandler()` / `APPL_StopMailboxHandler()` | `Init ↔ Pre-Op`（及 `Init ↔ Boot`） | 准备或释放邮箱相关资源 |
| `APPL_GenerateMapping(UINT16 *pInputSize, UINT16 *pOutputSize)` | `Pre-Op → Safe-Op` | 根据 `0x1C12/0x1C13` 计算输入/输出字节数，**是实现动态 PDO 和模块化设备的核心函数** |
| `APPL_StartInputHandler(UINT16 *pIntMask)` / `APPL_StopInputHandler()` | `Pre-Op ↔ Safe-Op` | 启动输入采集；`pIntMask` 是要写入 AL Event Mask 的值；也可以在这里校验 `0xF030` 模块配置 |
| `APPL_StartOutputHandler()` / `APPL_StopOutputHandler()` | `Safe-Op ↔ Op` | 释放或收回硬件输出。退出 `Op` 时，在 `APPL_StopOutputHandler()` 中把输出置于安全状态（如关闭电机使能、断开继电器） |
| `APPL_AckErrorInd(UINT16 stateTrans)` | 主站确认错误时 | 清除应用层故障标志 |

### 推荐的移植与联调顺序

按下面的顺序推进，每一步都有明确的通过标准，出了问题也容易定位到具体层次：

1. **硬件就绪**：网口有 link，TwinCAT 能扫描到从站。这一步只依赖 ESC 和 EEPROM，与 MCU 无关。
2. **EEPROM 首烧**：用 SSC Tool 生成的 ESI 烧写 EEPROM，断电重启后确认 TwinCAT 读到的 Vendor ID / Product Code 正确。
3. **PDI 打通**：MCU 读 `BYTE_TEST` 得到 `0x87654321`，`READY` 置位，`0x0140` 读回 `0x80`。
4. **最小协议栈**：先不开中断（FreeRun，`AL_EVENT_ENABLED = 0`、`DC_SUPPORTED = 0`），只跑 `MainLoop()` 和 1 ms 定时器，目标是进入 `Pre-Op`，并在 CoE-Online 中能浏览对象字典。
5. **固定 PDO 进 OP**：用最简单的固定映射进入 `Safe-Op` 和 `Op`，确认输入输出数值正确。FreeRun 下 SM 需要工作在 3 缓冲模式。
6. **打开 PDI 中断**：切换到 SM 同步，重点验证 `DISABLE_ESC_INT()`，长时间运行不应出现 `0x001B`。
7. **动态 PDO / Slot**：最后再引入 `0x1C12/0x1C13` 可写、`0xF030` 模块列表和步进计算。
8. **DC 同步**：需要时再启用 `SYNC0`，并测量周期内的实际耗时。

## 同步模式

### 三类模式的区别

SSC 的同步方式由两个宏决定可用范围（`AL_EVENT_ENABLED`、`DC_SUPPORTED`），运行时由主站写入的 `0x1C32:01`（SM2/输出）和 `0x1C33:01`（SM3/输入）选择具体模式。如果从站不支持 CoE，或者主站没有写这两个对象，则按 DC 激活寄存器 `0x0981`（对应 ESI 的 `Dc/OpMode/AssignActivate`）的值推断。

| 模式 | `0x1C32:01` / `0x1C33:01` | 应用触发源 | 依赖的宏 | 适用场景 |
| --- | --- | --- | --- | --- |
| **FreeRun** | `0` / `0` | 主循环，与 EtherCAT 周期无关 | 两者都可为 0 | 初次调通、对时序无要求的 IO |
| **SM 同步**（SM Event Synchron） | `0x01` / `0x22` | SM2 写入事件经 `IRQ` 触发（只有输入时为 SM3 读事件） | `AL_EVENT_ENABLED = 1` | 大多数普通 IO，跟随主站周期但不要求多站同时刻动作 |
| **DC 同步，SM/SYNC0** | `2` / `2` | SM2 事件触发输出映射，`SYNC0` 触发应用和输入锁存 | 两者都为 1 | 多轴协调、需要多个从站同一时刻输出或采样 |
| **DC 同步，SM/SYNC0/SYNC1** | `2` / `3` | 同上，但输入锁存改由 `SYNC1` 触发 | 两者都为 1 | 输出和输入需要不同时刻 |

SSC 文档推荐 DC 场景优先使用 SM/SYNC0 组合：在 SM2 事件里先完成输出数据的拷贝，`SYNC0` 到来时只执行应用逻辑，这样 `SYNC0` 到“输出生效”之间的抖动最小。只用 `SYNC0`、不开 PDI 中断也可以工作，但输出数据的拷贝时间会落在 `SYNC0` 之后。

### 周期预算

切换到同步模式之后，每个周期内 MCU 要完成的工作是：

```text
T_cycle ≥ T_SM2读出 + T_APPL_Application + T_SM3写入 + 中断进出开销 + 余量
```

在 SPI 方案下，前两项通常占主要部分。粗略估算：64 字节的输出数据，在 21 MHz SPI 下仅数据位传输就要约 24 µs，还要加上命令、地址、FIFO 状态轮询的开销。如果周期定在 250 µs 而 PDO 又比较大，SPI 很快就会成为瓶颈，这时应考虑 HBI 或 SQI。

SSC 通过几个对象把这些耗时告诉主站：`0x1C32:05` / `0x1C33:05`（Minimum Cycle Time，对应宏 `MIN_PD_CYCLE_TIME`）、`0x1C32:06` / `0x1C33:06`（Calc and Copy Time，对应 `PD_OUTPUT_CALC_AND_COPY_TIME` 等）、`0x1C32:09` / `0x1C33:09`（Delay Time，硬件输出或采样延迟）。在 SM/SYNC0 模式下，如果 SM2 事件来得太晚，`SYNC0` 前来不及完成拷贝，SSC 会累加 SM Event Missed 计数，超过限值后转入 `Safe-Op + Error`。

### DC 参数点到为止

DC 原理本身可以单独写一篇，这里只列出移植时需要知道的几个参数：

- **周期时间**：主站在 `Pre-Op → Safe-Op` 阶段写入 SYNC0 周期 `0x09A0`（SYNC1 周期 `0x09A4`）、起始时间 `0x0990`，最后写激活寄存器 `0x0981`（bit0 启用周期单元，bit1 启用 SYNC0，bit2 启用 SYNC1）。ESI 里常见的 `AssignActivate` 值 `#x0300` 即对应 SYNC0 同步。
- **Shift Time**：输入锁存或输出生效相对 SYNC0 的偏移（如 `0x1C33:03`），在 TwinCAT 的 DC 设置页调整，用来给从站留出计算时间。
- **从站自查**：周期时间不符合应用要求时，从站可以在 `Pre-Op → Safe-Op` 拒绝并报 `0x0030`/`0x0035`/`0x0036`；进入 `Op` 前必须收到 SYNC 事件，否则报 `0x002D`；运行中 SYNC 信号消失则报 `0x002C`。

## CoE 对象字典与 PDO 映射

### `TOBJECT`：SSC 中的对象字典节点

在 CANopen over EtherCAT（CoE）中，从站的所有参数、配置和过程数据都组织在**对象字典（Object Dictionary, OD）**中，以 `Index:SubIndex` 寻址。SSC 用双向链表管理对象字典，每个节点是一个 `TOBJECT`：

```c
/**
 * \brief Object dictionary entry structure
 */
typedef struct OBJ_ENTRY
{
    struct OBJ_ENTRY                      *pPrev;             /** 链表前驱指针 **/
    struct OBJ_ENTRY                      *pNext;             /** 链表后继指针 **/

    UINT16                                Index;              /** 对象索引（如 0x1C12, 0x1600, 0x6000） **/
    TSDOINFOOBJDESC                       ObjDesc;            /** 对象描述符：数据类型、对象类型(VAR/ARRAY/RECORD)、最大子索引数等 **/
    OBJCONST TSDOINFOENTRYDESC OBJMEM     *pEntryDesc;        /** 子索引描述符数组：位长、读写权限、PDO 映射属性等 **/
    OBJCONST UCHAR OBJMEM                 *pName;             /** 对象及各子索引的名称字符串序列 **/
    void MBXMEM                           *pVarPtr;           /** 指向实际 C 语言变量/结构体的内存指针 **/
    UINT8 (* Read)( UINT16 Index, UINT8 Subindex, UINT32 Size, UINT16 MBXMEM * pData, UINT8 bCompleteAccess );  /** SDO 读钩子函数 **/
    UINT8 (* Write)( UINT16 Index, UINT8 Subindex, UINT32 Size, UINT16 MBXMEM * pData, UINT8 bCompleteAccess ); /** SDO 写钩子函数 **/
    UINT16                                NonVolatileOffset;  /** 非易失性存储偏移量 **/
}
TOBJECT;
```

主站发来一次 SDO 读写时，SSC 按 `Index` 在链表中找到节点，用 `pEntryDesc` 检查位长和访问权限，再通过 `pVarPtr` 加上子索引的偏移访问实际变量；如果节点设置了 `Read`/`Write` 钩子，就交给钩子处理。动态 PDO 和 Slot/Module 本质上就是**在运行时修改这些节点指向的数据，或在链表中增删节点**。

SSC 对对象变量的内存布局有一套自己的约定（这是协议栈的实现要求，不是 ETG 规范）：

- 大于 8 位的子索引必须从相对对象起始地址的整字（16 位）偏移处开始；
- 不超过 8 位的子索引要成对地填满 16 位块，块内第一、第二字节之间也必须是子索引的边界，不足的部分用 `ALIGNx` 之类的填充项补齐；
- ARRAY/RECORD 的 `SubIndex0` 在 SSC 中一律定义为 16 位变量。

手写对象时如果违反这些约定，SDO 读出的值就会错位。这种情况下要么调整结构体，要么为该对象实现 `Read`/`Write` 钩子。

`TSDOINFOENTRYDESC` 中的 `ObjAccess` 字段按状态区分读写权限（如 bit0–2 分别表示 Pre-Op/Safe-Op/Op 下可读，bit3 起表示对应状态下可写），并标记该条目能否映射到 RxPDO/TxPDO。动态 PDO 相关的对象通常只允许在 `Pre-Op` 下写入。

### SDO 与 PDO

| | SDO（Service Data Object） | PDO（Process Data Object） |
| --- | --- | --- |
| 通道 | 邮箱，SM0（主→从）/ SM1（从→主） | 过程数据，SM2（输出）/ SM3（输入） |
| 时序 | 非周期，请求-应答 | 每个通信周期都交换 |
| 寻址 | 每次携带 `Index:SubIndex` | 不携带索引，按事先约定的字节排布解析 |
| 可用状态 | `Pre-Op`、`Safe-Op`、`Op` | 输入从 `Safe-Op` 开始，输出从 `Op` 开始 |
| 典型用途 | 参数配置、PDO 映射配置、诊断读取 | 控制字、目标值、反馈值 |

PDO 中“事先约定好的字节排布”，正是主站在 `Pre-Op` 阶段通过 SDO 写入三级映射对象来确定的。

### 三级映射关系

```text
[第一级：SM 通道分配对象 PDO Assign]
  0x1C12 (SM2 RxPDO Assign) ──► 包含若干子索引，指向被激活的 0x16xx 索引
  0x1C13 (SM3 TxPDO Assign) ──► 包含若干子索引，指向被激活的 0x1Axx 索引
        │
        ▼
[第二级：PDO 映射参数对象 PDO Mapping]
  0x1600 ~ 0x17FF (RxPDO Mapping) ──► 每个子索引为 32 位值：[Index(16b) | SubIndex(8b) | BitLen(8b)]
  0x1A00 ~ 0x1BFF (TxPDO Mapping) ──► 描述该 PDO 内部依次打包了哪些应用数据条目及位宽
        │
        ▼
[第三级：应用数据对象]
  0x7000 ~ 0x7FFF (Outputs) ──► 主站下发给从站的控制变量（对应 APPL_OutputMapping）
  0x6000 ~ 0x6FFF (Inputs)  ──► 从站上报给主站的状态变量（对应 APPL_InputMapping）
```

### 映射条目编码与位长汇总

第二级中每个映射条目都是 32 位，从高到低依次是 16 位索引、8 位子索引和 8 位位长：

```text
 31            16 15       8 7        0
┌────────────────┬──────────┬──────────┐
│     Index      │ SubIndex │  BitLen  │
└────────────────┴──────────┴──────────┘

0x70100110  →  0x7010:01，16 位
0x60000101  →  0x6000:01，1 位
```

`APPL_GenerateMapping()` 的通用算法是：遍历 `0x1C12` 的每个子索引，找到对应的 `0x16xx`，把其中所有条目的 `BitLen` 累加，最后向上取整为字节数；输入方向对 `0x1C13`/`0x1Axx` 做同样的计算。如果 `0x1C12` 指向了一个不存在的 `0x16xx`，函数应返回 `0x0025`（输入方向为 `0x0024`）。

位长汇总要注意字节对齐：

- SyncManager 的长度以字节为单位，所以总位数要向上取整。但更稳妥的做法是**让每个 PDO 自身就按字节对齐**：例如 4 个 1 位的 DI 后面补一个 4 位的填充条目，凑满 1 字节。ESI 中填充条目通常写成索引为 0、只带位长的 `<Entry>`。
- 如果 ESI 里有填充，而从站代码累加时漏掉了填充位，主站和从站算出的长度就会相差几个字节，结果正是 `0x001D`/`0x001E`。
- 16/32 位变量如果从奇数字节开始，主站可以正常解析，但 SSC 的 `memcpy` 式打包和 MCU 的非对齐访问可能出问题。设计映射时尽量让宽变量落在偶数字节上。

### 固定、可选择与可配置 PDO

ETG 把 PDO 配置分为三种：fixed（固定）、selectable（可选择）和 configurable（可配置）。工程中常说的“动态 PDO”指的是后两种：

1. **可选择 PDO 映射（Selectable）**：`0x16xx`/`0x1Axx` 的内容固定（只读），但 `0x1C12`/`0x1C13` 可写。主站在 `Pre-Op` 阶段修改 `0x1C12`/`0x1C13`，从若干预定义的 PDO 中选择挂到 SM2/SM3 上的那几个。
2. **可配置 PDO 映射（Configurable，常称完全动态 PDO）**：`0x16xx`/`0x1Axx` 本身也能通过 SDO 改写。主站的典型写入顺序是：
   1. 把 `0x1C12:00` 写为 `0`，先解除分配；
   2. 把 `0x16xx:00` 写为 `0`，清空映射；
   3. 向 `0x16xx:01..n` 写入新的映射条目（如 `0x70100110`）；
   4. 把条目数 `n` 写回 `0x16xx:00`；
   5. 依次写 `0x1C12:01..m`，最后把 `0x1C12:00` 写为 `m`，使分配生效。

从站侧的 SDO 写处理要配合这个顺序：子索引 0 不为 0 时拒绝修改条目；写回子索引 0 时校验每个条目引用的对象是否存在、是否允许映射，以及位长是否匹配。在写入时就把错误挡住，比等到 `Pre-Op → Safe-Op` 时再报错更容易定位。

无论哪一种，当从站收到 `Pre-Op → Safe-Op` 请求时，都会调用 `APPL_GenerateMapping()` 计算总字节数，交给协议栈与主站配置的 SM2/SM3 长度严格比对。

### 常用对象索引

| 索引 | 名称 | 移植时关注的点 |
| --- | --- | --- |
| `0x1000` | Device Type | 低 16 位为设备 Profile 号，高 16 位为模块 Profile；ETG.5001 模块化设备为 `0x00001389`（5001） |
| `0x1008` / `0x1009` / `0x100A` | 设备名、硬件版本、软件版本 | 与 ESI 中的显示信息对应 |
| `0x1018` | Identity | `:01` Vendor ID、`:02` Product Code、`:03` Revision、`:04` Serial Number，必须与 ESI 和 EEPROM 一致 |
| `0x1600–0x17FF` | RxPDO Mapping | 输出 PDO 的映射内容 |
| `0x1A00–0x1BFF` | TxPDO Mapping | 输入 PDO 的映射内容 |
| `0x1C00` | Sync Manager Communication Type | 每个 SM 的用途：1 邮箱写（主→从）、2 邮箱读、3 过程数据输出、4 过程数据输入 |
| `0x1C12` / `0x1C13` | RxPDO / TxPDO Assign | 挂到 SM2/SM3 上的 PDO 列表 |
| `0x1C32` / `0x1C33` | SM Output / Input Parameter | 同步模式（`:01`）、周期时间（`:02`）、Shift Time（`:03`）、最小周期（`:05`）等 |
| `0x2000–0x5FFF` | 厂商自定义区 | 私有参数 |
| `0x6000` / `0x7000` / `0x8000` / `0x9000` / `0xA000` 起 | 输入 / 输出 / 配置 / 信息 / 诊断区 | MDP 设备按 Slot 步进在这些区域内分配 |
| `0xF000–0xFFFF` | 设备区 | `0xF000`、`0xF010`、`0xF030`、`0xF050` 等模块化设备对象 |

## ETG.5001 Slot/Module

### 模块化设备专属对象（`0xF0xx`）

在网关、耦合器以及多轴或多通道 IO 从站中，一个从站下有多个**插槽（Slot）**，每个插槽可以挂载不同类型的功能**模块（Module）**。ETG.5001（Modular Device Profile，MDP）规定：ESI 只描述“有哪些 Slot、每个 Slot 允许插哪些 Module”，运行时由主站按实际配置拼出对象字典和 PDO。为了避免为每个插槽手写几十个重复的对象，ETG.5001 采用了**基于步进（Increment）的索引分配**。

| 对象 | 名称 | 作用 |
| --- | --- | --- |
| `0xF000` | Modular Device Profile | `:01` Module Index Distance（每个 Slot 的对象索引间距，如 `0x0010`），`:02` Maximum Number of Modules（最大模块数） |
| `0xF010` | Module Profile List | 各模块使用的 Profile 号 |
| `0xF030` | Configured Module Ident List | **已配置模块标识列表**。主站在 `Pre-Op` 阶段通过 SDO，把用户在 TwinCAT 中为各 Slot 选择的 `ModuleIdent` 写入对应子索引 |
| `0xF050` | Detected Module Ident List | **实际检测到的模块标识列表**（可选）。从站根据实际插入的硬件上报模块 ID，供主站与 `0xF030` 比对 |

使用 SSC Tool 时，Slot 定义在基础应用表格的 `0xF030` 行里，每个 Module 单独一张表并在表头写明唯一的 `Module Ident`。生成的 ESI 中，模块里的 PDO 映射对象和 `0x2000` 以上的对象会带上 `DependOnSlot` 属性，表示索引要随 Slot 编号偏移。

### 索引步进与错位陷阱

假设某类 Module 的模板数据对象基地址为 `0x6000`（输入）和 `0x7000`（输出），模板 PDO 映射对象基地址为 `0x1600`（RxPDO）和 `0x1A00`（TxPDO）。当它被挂到第 `n` 个插槽（`n = 0, 1, 2, ...`，即 Slot 1 对应 `n = 0`，Slot 2 对应 `n = 1`）时：

- **数据对象索引**：`ObjectIndex(n) = BaseObjectIndex + n * SlotIndexIncrement`
- **PDO 映射对象索引**：`PdoIndex(n) = BasePdoIndex + n * SlotPdoIncrement`

以 ETG.5001 推荐的 `SlotIndexIncrement = 0x0010`、`SlotPdoIncrement = 0x0001` 为例：

| Slot | n | RxPDO / TxPDO 映射对象 | 输出 / 输入数据对象 |
| --- | :---: | --- | --- |
| Slot 1 | 0 | `0x1600` / `0x1A00` | `0x7000` / `0x6000` |
| Slot 2 | 1 | `0x1601` / `0x1A01` | `0x7010` / `0x6010` |
| Slot 3 | 2 | `0x1602` / `0x1A02` | `0x7020` / `0x6020` |

偏移不只作用于 PDO 映射对象的索引，**映射对象内部的条目也要同步偏移**：`0x1601:01` 的内容应当是 `0x7010:01`，而不是模板里的 `0x7000:01`。主站启动时会依次把 `0x1600`、`0x1601`…写入 `0x1C12` 的子索引 1、2…，从而把所有已挂载 Slot 的 PDO 串进同一个 SM2/SM3 过程数据区。

按这组参数，`0x1600–0x17FF` 可以容纳 512 个 RxPDO 映射对象，`0x6000–0x6FFF` 按 `0x10` 的间距可以容纳 256 个模块的输入对象，所以模块数量的上限由较小的那个决定。多轴伺服（CiA402）通常每轴需要很大的对象空间，常见的步进是 `SlotIndexIncrement = 0x800`、`SlotPdoIncrement = 0x10`。

**错位陷阱。** 代码中的 `SlotIndexIncrement` 和 `SlotPdoIncrement` **必须与 ESI 中 `<Slots>` 元素的 `SlotIndexIncrement`、`SlotPdoIncrement` 属性严格一致**。另外 ESI 允许在单个 `<Slot>` 上用同名属性覆盖全局值，核对时不要漏掉。一旦两边不一致，Slot 1（`n = 0`，偏移为 0）看起来一切正常，但**从 Slot 2（`n >= 1`）开始，主站按 XML 计算出的索引就会和从站内部生成的 `TOBJECT` 索引错开**。结果是 SDO 写入返回“对象不存在”，或者 PDO 长度对不上而报 `0x001D`/`0x001E`/`0x0025`。所以调试模块化设备时，至少要插两个 Slot 测试，只插一个是发现不了这个问题的。

### 与动态 PDO、`APPL_GenerateMapping` 的衔接

从站在 `Pre-Op` 阶段收到 `0xF030` 和 `0x1C12/0x1C13` 写入后，到 `Pre-Op → Safe-Op` 时需要把它们串起来：

```text
Pre-Op：主站 SDO 写 0xF030:01..n（每个 Slot 的 ModuleIdent）
        └─ 从站：按 ModuleIdent 和 Slot 号 n，在 TOBJECT 链表中实例化
                 0x16xx/0x1Axx（+ n*SlotPdoIncrement）和
                 0x6xxx/0x7xxx（+ n*SlotIndexIncrement）
Pre-Op：主站 SDO 写 0x1C12/0x1C13
Pre-Op → Safe-Op：
        └─ APPL_GenerateMapping()：沿 0x1C12/0x1C13 → 0x16xx/0x1Axx 累加位长
        └─ 协议栈：比较结果与主站写入的 SM2/SM3 长度
        └─ APPL_StartInputHandler()：可在此比对 0xF030 与 0xF050，不一致则拒绝
```

有两个点容易遗漏：

1. **长度上限**。挂满 Slot 后，总长度可能超过 `MAX_PD_OUTPUT_SIZE`/`MAX_PD_INPUT_SIZE`。SSC 检查 SM 设置时，会把超过上限当作配置错误，报出来的同样是 `0x001D`/`0x001E`，看起来和映射写错一模一样。
2. **3 缓冲占用**。SM2/SM3 在 3 缓冲模式下实际占用 3 倍长度的 RAM。LAN9252 只有 4 KB，模块多时要算一下 SM0–SM3 的区域会不会重叠，或者超出 RAM 范围。

## ESI XML、EEPROM 与代码三方一致

### ESI 的双重作用

ESI（EtherCAT Slave Information）XML 文件描述从站的全部信息，它有两个用途：

1. **供主站组态**。放入 TwinCAT 的 ESI 目录（如 `C:\TwinCAT\3.1\Config\Io\EtherCAT`）后，TwinCAT 从中解析身份信息、SM0–SM3 参数、对象字典、PDO、DC 模式以及 Slot/Module 组合规则。
2. **生成 EEPROM（SII）镜像**。前文提到的 PDI 类型、SYNC 配置、身份信息和邮箱参数，都来自 ESI 中的 `ConfigData` 及相关字段。

因此一个正常工作的从站，需要下面三方完全一致：

```text
          ESI XML（TwinCAT 缓存中的那一份）
           ╱                         ╲
  EEPROM 中的 SII 镜像  ──────  MCU 固件（ecat_def.h、对象字典、步进值）
```

### 代码与 ESI 对齐清单

| 代码侧 | 对应的 ESI 字段 | 不一致时的现象 |
| --- | --- | --- |
| `VENDOR_ID` | `<Vendor><Id>` | TwinCAT 识别为未知设备，或 `0x1018` 与 ESI 不符 |
| `PRODUCT_CODE` | `<Device><Type ProductCode="...">` | 同上 |
| `REVISION_NUMBER` | `<Device><Type RevisionNo="...">` | 选中的 ESI 版本与实际设备不一致 |
| `DEVICE_PROFILE_TYPE` | `<Profile><ProfileNo>` | 模块化设备设为 `0x00001389`，对应 `<ProfileNo>5001</ProfileNo>` |
| `MIN_MBX_SIZE` / `MAX_MBX_SIZE`、邮箱地址范围宏 | `<Sm>` 中 SM0/SM1 的 `StartAddress`、`DefaultSize` | `Init → Pre-Op` 报 `0x0016` |
| `DC_SUPPORTED`、同步相关宏 | `<Dc><OpMode>` | `Pre-Op → Safe-Op` 报 `0x0030`、`0x0027`/`0x0028` |
| `SlotIndexIncrement` / `SlotPdoIncrement` | `<Slots SlotIndexIncrement="..." SlotPdoIncrement="...">` | Slot 2 起错位 |

### `ssc-9252` 模块化实现文件

1. `ssc-9252.c`、`ssc-9252.h` 和 `SSC-9252Objects.h` 是实现模块化对象字典动态挂载与 PDO 映射解析的核心文件。`SSC-9252Objects.h` 由 SSC Tool 根据应用表格生成，原则上**改表格再重新生成**，不要直接手改，否则下次生成时会被覆盖，ESI 也不会同步更新。
2. 步进值、`ModuleIdent`、每个模块的 PDO 位长这三类信息同时存在于表格、生成的 ESI 和 `ssc-9252.c` 中。只要手动改了其中一处，就必须检查另外两处。

### 改 XML 之后的固定动作

每次修改 ESI 中与硬件或身份相关的参数后，需要依次完成以下操作，漏掉任何一步都可能看到“改了但没生效”的假象：

1. 同步修改 MCU 代码（`ecat_def.h`、对象表格），重新编译并烧录固件。
2. 用新的 ESI 在 TwinCAT 中**重新烧写从站 EEPROM**。
3. **对从站断电重启**。LAN9252 只在上电或复位时加载 EEPROM，热复位 MCU 不会重新加载 PDI 配置。
4. 刷新 TwinCAT 的 ESI 缓存（替换目录中的 XML 后重新加载设备描述，必要时重启 TwinCAT），然后**删除旧的从站并重新扫描**。旧工程里保存的 SM 长度和 PDO 配置不会自动更新。

## EtherCAT 状态机（ESM）

### 五种运行状态

ESM 由主站写 AL Control（`0x0120`）请求状态，从站把实际状态写回 AL Status（`0x0130`）。共有 5 种状态：

| 状态名称 | 缩写 | 编码 | 邮箱通信（SDO） | 过程数据输入（SM3） | 过程数据输出（SM2） | 说明 |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| **Init** | `I` | `0x01` | 关闭 | 关闭 | 关闭 | 链路初始化，主站只能直接读写 ESC 寄存器与 EEPROM |
| **Pre-Operational** | `P` | `0x02` | **开启** | 关闭 | 关闭 | 开启 SM0/SM1 邮箱，主站通过 SDO 配置参数、下发 `0xF030` 模块列表和 `0x1C12/0x1C13` 映射 |
| **Safe-Operational** | `S` | `0x04` | **开启** | **开启** | 保持安全状态 | 从站上传输入；输出仍处于安全状态，不驱动外部执行器 |
| **Operational** | `O` | `0x08` | **开启** | **开启** | **开启** | 全功能运行，主站通过 SM2 下发的输出正式驱动硬件 |
| **Bootstrap** | `B` | `0x03` | 仅 FoE | 关闭 | 关闭 | 可选状态，用于 FoE（File Access over EtherCAT）固件升级 |

状态只能逐级向上切换（`I → P → S → O`），向下可以直接回到任意较低状态；`Bootstrap` 只能从 `Init` 进入，也只能回到 `Init`。像 `I → S` 这种越级请求，会被从站以 `0x0011`（Invalid requested state change）拒绝。

在 LAN9252 上，RUN LED 由 ESC 根据 AL Status 自动驱动：熄灭表示 Init，闪烁（Blinking）表示 Pre-Op，单闪表示 Safe-Op，常亮表示 Op，快闪（Flickering）表示 Bootstrap。这是不接调试器时判断状态最快的方法。

### AL 寄存器与事件

| 寄存器 | 地址 | 写入方 | 关键位 |
| --- | --- | --- | --- |
| AL Control | `0x0120` | 主站 | bit3:0 请求的状态；bit4 错误确认（Error Ind Ack） |
| AL Status | `0x0130` | 从站（经 PDI） | bit3:0 当前状态；bit4 错误标志（Error Ind） |
| AL Status Code | `0x0134` | 从站（经 PDI） | 16 位错误原因 |
| AL Event Request | `0x0220` | ESC 硬件 | bit0 AL Control 被写入；bit8 起依次对应 SM0、SM1…的事件 |
| AL Event Mask | `0x0204` | 从站（经 PDI） | 哪些事件会拉起 IRQ |

一次状态切换的完整交互如下：

1. 主站把目标状态写入 `0x0120`，然后开始轮询 `0x0130`。
2. ESC 置位 `0x0220` 的 bit0。SSC 在 `MainLoop()` 中轮询到这个事件，读取 `0x0120`（读操作本身会清除该事件位）。
3. `AL_ControlInd()` 调用对应的检查函数和应用回调。
4. 成功时写入新状态；失败时写入“当前状态 + Error 位”（例如 `0x14` 表示 Safe-Op + Error），并把原因写入 `0x0134`。
5. 主站读到结果。出错时，主站写入带 bit4 的 AL Control 进行确认，从站随即调用 `APPL_AckErrorInd()`。

从站本地也可以主动降级，例如看门狗超时后从 `Op` 降到 `Safe-Op + Error`。此时 `0x0134` 中保存的就是降级原因。

主站对每次切换都有超时限制，ESI 中的默认值为：`PreopTimeout` 3000 ms，`SafeopOpTimeout` 10000 ms，`BackToInitTimeout` 5000 ms，`BackToSafeopTimeout` 200 ms。SSC 自己的超时宏（如 `PREOPTIMEOUT`、`SAFEOP2OPTIMEOUT`）一般设得比主站略短，这样从站能先报出具体的 AL Status Code，而不是让主站只看到一个笼统的超时。

### SyncManager 与 FMMU 在各阶段的作用

**SyncManager（SM）** 是 ESC 中保证数据一致性的硬件单元。每个 SM 占 8 字节寄存器（`0x0800 + 8·n`），包括起始地址、长度、控制字（工作模式、方向、中断与看门狗使能）、状态、激活和 PDI 控制。它有两种工作模式：

| 模式 | 用于 | 特点 |
| --- | --- | --- |
| 邮箱（单缓冲） | SM0/SM1 | 握手式访问：写方写满后读方才能读，读完后写方才能再写，数据不会丢 |
| 缓冲（3 缓冲） | SM2/SM3 | 读写双方各自访问一个缓冲区，ESC 在一次完整写入后交换缓冲区。读方总能拿到最新的完整数据，但物理上占用 **3 倍**长度的 RAM |

**FMMU（Fieldbus Memory Management Unit）** 负责把 EtherCAT 帧中的“逻辑地址”按位映射到本站 ESC 的“物理地址”。主站可以用一个逻辑读写报文（如 LRW）一次访问所有从站的过程数据，每个从站的 FMMU 只截取属于自己的那一段，并落到 SM2/SM3 所在的物理地址上。FMMU 寄存器从 `0x0600` 开始，每个 16 字节。对从站软件来说，FMMU 完全由主站配置，MCU 不需要处理，但要知道它存在：**SM2/SM3 的长度不对时，FMMU 映射的长度也会跟着出错**。LAN9252 有 3 个 FMMU，常见用法是 FMMU0 映射输出、FMMU1 映射输入。

### 看门狗与 WKC

**过程数据看门狗**：SM2 的控制字中有看门狗触发使能位，每次主站完整写入 SM2 时，看门狗都会重新计时。超时时间由 `0x0400`（分频）和 `0x0420`（过程数据看门狗时间）决定，默认约为 100 ms，状态见 `0x0440`。超时后，从站从 `Op` 降到 `Safe-Op + Error` 并报 `0x001B`。Beckhoff 文档特别指出，**单纯加大看门狗时间不是解决办法**，应当去查主站为什么没有按时写入，或者从站为什么没有及时读走数据。只有输入的从站通常不使用这个看门狗。

**WKC（Working Counter）**：每个 EtherCAT 报文都带一个工作计数器，从站每成功处理一次读或写就让它递增，主站据此判断有多少从站真正处理了这次报文。从站软件不直接操作 WKC，但 SM 长度错误、FMMU 未生效或从站掉出 `Safe-Op` 等情况，都会在主站侧表现为 WKC 不符（TwinCAT 中的 WcState 报错）。所以 WKC 异常往往是比 AL Status Code 更早出现的信号。

### 状态转换流程与校验条件

SSC 处理状态转换请求的核心入口是 `ecatslv.c` 中的 `AL_ControlInd()`。每次跃迁都要先由主站完成相应的寄存器配置，并通过从站内部校验，才会置位新状态；校验失败时，从站置位 Error Ind，并把原因写入 **AL Status Code（`0x0134`）**。

#### 1. Init (`I`) → Pre-Operational (`P`)

**目标**：建立非周期的邮箱通信通道，以便后续通过 SDO 配置对象字典。

- **主站完成的配置**：
  - 配置 **SM0**：Mailbox Out（主站发送 → 从站接收）。
  - 配置 **SM1**：Mailbox In（从站发送 → 主站接收）。
  - 向 AL Control 写入 `0x02`（Pre-Op）。
- **从站内部校验（`CheckSmSettings()` → `MBX_StartMailboxHandler()` → `APPL_StartMailboxHandler()`）**：
  - 校验 SM0/SM1 的起始地址、长度和控制字是否落在协议栈宏定义的范围内（这些范围应与 ESI 一致）；邮箱 SM 设置不符时报 `0x0016`，SM 地址或长度与 MCU 架构不兼容时报 `0x0017`。
  - 激活邮箱 SM，初始化邮箱收发队列。

#### 2. Pre-Operational (`P`) → Safe-Operational (`S`)

**目标**：确定周期性过程数据的映射和长度，配置 SM2/SM3 与 FMMU，启动输入采集。**这是涉及动态 PDO 和 Slot/Module 时最容易报错的阶段。**

- **主站完成的配置**：
  - 通过 SDO 完成对象字典配置，例如写入 `0xF030` 模块列表，以及 `0x1C12`/`0x1C13`、`0x16xx`/`0x1Axx` 映射，还有 `0x1C32:01`/`0x1C33:01` 同步模式。
  - 按 PDO 映射结果配置 **SM2（Outputs）** 和 **SM3（Inputs）** 的起始地址、长度与控制字。
  - 配置 **FMMU**，建立逻辑地址到从站物理地址的映射。
  - 若启用 DC，配置 SYNC0/SYNC1 周期时间、起始时间和激活寄存器。
  - 向 AL Control 写入 `0x04`（Safe-Op）。
- **从站内部校验（`APPL_GenerateMapping()` → `CheckSmSettings()` → `StartInputHandler()` → `APPL_StartInputHandler()`）**：
  - 调用 `APPL_GenerateMapping(&u16InputSize, &u16OutputSize)`，计算从站认为生效的输入/输出总字节数；找不到 `0x1C12/0x1C13` 指向的映射对象时报 `0x0024`/`0x0025`。
  - **严格比对**：SM2 的长度必须等于 `u16OutputSize`，SM3 的长度必须等于 `u16InputSize`，方向和地址也要合法，且不能超过 `MAX_PD_*_SIZE`；否则拒绝进入 `Safe-Op`，报 `0x001D` 或 `0x001E`。
  - 检查 SM 区域是否重叠（3 缓冲按 3 倍长度计算）；检查 DC 配置（`0x0030` 等）；配置过程数据看门狗；写入 AL Event Mask。
  - 首次调用 `APPL_InputMapping` 更新输入数据。

#### 3. Safe-Operational (`S`) → Operational (`O`)

**目标**：建立完整的闭环控制，释放硬件安全锁，允许主站输出数据驱动从站执行机构。

- **主站完成的配置**：
  - 持续发送周期性过程数据帧，确保输出数据有效、工作计数器（WKC）正常。
  - 向 AL Control 写入 `0x08`（Op）。
- **从站内部校验（`StartOutputHandler()` → `APPL_StartOutputHandler()`）**：
  - 确认已经收到有效的 SM2 输出过程数据。在 `SAFEOP2OPTIMEOUT` 时间内收不到输出时，SSC 报 `0x001B`。
  - 若启用了 DC，确认已正常收到 `SYNC0`（及 `SYNC1`）事件，否则报 `0x002D`。
  - 调用 `APPL_StartOutputHandler()`，激活硬件输出。

<div id="ecat-esm-demo-app" class="ecat-demo-root">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h3 style="margin:0; font-size:16px;">EtherCAT 从站状态机（ESM）与动态 PDO 诊断控制台</h3>
    <span style="font-size:12px; color:var(--muted);">纯前端交互演示</span>
  </div>

  <!-- State Track -->
  <div class="esm-track">
    <div id="esm-node-init" class="esm-node active">
      <div class="esm-node-code">STATE_INIT</div>
      <div class="esm-node-name">Init (初始)</div>
      <div class="esm-node-ch">仅寄存器/EEPROM</div>
    </div>
    <div class="esm-arrow">➔</div>
    <div id="esm-node-preop" class="esm-node">
      <div class="esm-node-code">STATE_PREOP</div>
      <div class="esm-node-name">Pre-Op (预运行)</div>
      <div class="esm-node-ch">SM0/1 邮箱 SDO 通道</div>
    </div>
    <div class="esm-arrow">➔</div>
    <div id="esm-node-safeop" class="esm-node">
      <div class="esm-node-code">STATE_SAFEOP</div>
      <div class="esm-node-name">Safe-Op (安全运行)</div>
      <div class="esm-node-ch">SM3 输入采集上传</div>
    </div>
    <div class="esm-arrow">➔</div>
    <div id="esm-node-op" class="esm-node">
      <div class="esm-node-code">STATE_OP</div>
      <div class="esm-node-name">Operational (运行)</div>
      <div class="esm-node-ch">SM2 输出物理驱动</div>
    </div>
  </div>

  <div class="ecat-grid">
    <!-- Left Column: Controls & Module PDO Config -->
    <div class="ecat-card">
      <div class="ecat-card-title">
        <span>主站状态推进控制</span>
        <span style="font-size:11px; color:var(--muted);">AL Control 驱动</span>
      </div>

      <div class="ecat-btn-grid">
        <button class="ecat-btn" id="ecat-btn-to-preop">Init ➔ Pre-Op</button>
        <button class="ecat-btn" id="ecat-btn-to-safeop">Pre-Op ➔ Safe-Op</button>
        <button class="ecat-btn" id="ecat-btn-to-op">Safe-Op ➔ Operational</button>
        <button class="ecat-btn" id="ecat-btn-to-init">复位回到 Init</button>
      </div>

      <button class="ecat-btn danger" id="ecat-btn-fault-wd" style="width:100%; margin-bottom:12px;">
        故障注入：在 OP 状态模拟看门狗超时 (0x001B)
      </button>

      <div class="ecat-card-title" style="margin-top:12px;">
        <span>ETG.5001 插槽模块动态挂载 (Slot/Module)</span>
      </div>
      <div class="ecat-modules-list">
        <div class="ecat-module-row">
          <label><input type="checkbox" id="ecat-mod-m1" checked> Slot 1: 4通道数字量输入 (4-CH DI)</label>
          <span style="color:var(--muted);">TxPDO: 1B</span>
        </div>
        <div class="ecat-module-row">
          <label><input type="checkbox" id="ecat-mod-m2" checked> Slot 2: 8通道数字量输出 (8-CH DO)</label>
          <span style="color:var(--muted);">RxPDO: 1B</span>
        </div>
        <div class="ecat-module-row">
          <label><input type="checkbox" id="ecat-mod-m3" checked> Slot 3: 2通道模拟量输出 (2-CH AO 16b)</label>
          <span style="color:var(--muted);">RxPDO: 4B</span>
        </div>
        <div class="ecat-module-row">
          <label><input type="checkbox" id="ecat-mod-m4" checked> Slot 4: 4通道模拟量输入 (4-CH AI 16b)</label>
          <span style="color:var(--muted);">TxPDO: 8B</span>
        </div>
      </div>
      <div class="ecat-calc-summary">
        <div>从站计算 RxPDO (SM2 输出总长): <strong id="ecat-rx-sum">5 字节</strong></div>
        <div>TxPDO (SM3 输入总长): <strong id="ecat-tx-sum">9 字节</strong></div>
      </div>

      <div class="ecat-card-title" style="margin-top:12px;">
        <span>故障注入开关（勾选后触发对应跃迁校验失败）</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; font-size:12px;">
        <label><input type="checkbox" id="ecat-fault-mbx"> 注入 0x0016: 主站下发 SM0 邮箱长度与 XML 不符 (I ➔ P)</label>
        <label><input type="checkbox" id="ecat-fault-rx"> 注入 0x001D: 主站 SM2 输出长度与从站 RxPDO 不符 (P ➔ S)</label>
        <label><input type="checkbox" id="ecat-fault-tx"> 注入 0x001E: 主站 SM3 输入长度与从站 TxPDO 不符 (P ➔ S)</label>
        <label><input type="checkbox" id="ecat-fault-dc"> 注入 0x002C: DC SYNC0 锁相中断丢失 (S ➔ O)</label>
      </div>
    </div>

    <!-- Right Column: Status & Logs -->
    <div class="ecat-card" style="display:flex; flex-direction:column;">
      <div class="ecat-card-title">
        <span>ESC 核心寄存器与 SyncManager 状态</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
        <div style="font-size:12px; color:var(--muted);">
          AL Control (0x0120): <span id="ecat-al-control" class="ecat-status-val">0x01</span>
        </div>
        <div style="font-size:12px; color:var(--muted);">
          AL Status (0x0130): <span id="ecat-al-status" class="ecat-status-val">0x01</span>
        </div>
      </div>
      <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">
        AL Status Code (0x0134): <span id="ecat-al-code" class="ecat-status-val">0x0000 (No error)</span>
      </div>

      <table class="ecat-sm-table">
        <thead>
          <tr>
            <th>通道</th>
            <th>物理地址</th>
            <th>方向</th>
            <th>当前通道状态</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>SM0</td>
            <td>0x1000</td>
            <td>Mailbox Out (主 ➔ 从)</td>
            <td id="sm-status-0" class="ecat-sm-inactive">CLOSED</td>
          </tr>
          <tr>
            <td>SM1</td>
            <td>0x1080</td>
            <td>Mailbox In (从 ➔ 主)</td>
            <td id="sm-status-1" class="ecat-sm-inactive">CLOSED</td>
          </tr>
          <tr>
            <td>SM2</td>
            <td>0x1100</td>
            <td>Process Data Out (主 ➔ 从)</td>
            <td id="sm-status-2" class="ecat-sm-inactive">LOCKED</td>
          </tr>
          <tr>
            <td>SM3</td>
            <td>0x1400</td>
            <td>Process Data In (从 ➔ 主)</td>
            <td id="sm-status-3" class="ecat-sm-inactive">CLOSED</td>
          </tr>
        </tbody>
      </table>

      <div class="ecat-card-title" style="margin-top:14px; margin-bottom:6px;">
        <span>TwinCAT 3 / ESC 状态诊断日志</span>
      </div>
      <div id="ecat-log" style="flex:1; min-height:120px; max-height:160px; overflow-y:auto; background:var(--code-bg); color:var(--code-ink); border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-family:ui-monospace, Consolas, monospace; font-size:11px; line-height:1.5;"></div>
    </div>
  </div>
</div>

## AL Status Code 速查与故障排查

### 常见 AL Status Code 速查

当 TwinCAT 报告状态切换失败（如卡在 `INIT to PREOP`、`PREOP to SAFEOP`，或从 `OP` 掉回 `SAFEOP + ERROR`）时，优先在 Logger 或从站的 Online 页查看 **AL Status Code（`0x0134`）**。下表只收录与移植关系密切的错误码，名称以 Beckhoff Information System 和 SSC 头文件 `ecatslv.h` 中的定义为准：

| 错误码 | 标准名称（SSC 宏） | 常见触发阶段 | 根因分析与排查方向 |
| :---: | --- | :---: | --- |
| `0x0011` | **Invalid requested state change**（`ALSTATUSCODE_INVALIDALCONTROL`） | 任意 | 请求了 ESM 不允许的跃迁，例如越级请求。通常是手动操作或主站脚本的问题，与固件无关。 |
| `0x0014` | **No valid firmware**（`ALSTATUSCODE_NOVALIDFIRMWARE`） | `I → P` | 除固件下载失败外，SSC 在 SM 配置超出 ESC DPRAM 物理范围时也会返回此码。把 ET1100 的配置搬到 4 KB RAM 的 LAN9252 上时要注意。 |
| `0x0016` | **Invalid mailbox configuration**（`ALSTATUSCODE_INVALIDMBXCFGINPREOP`） | `I → P` | SM0/SM1 的起始地址或长度不匹配。检查 `ecat_def.h` 中的 `MIN_MBX_SIZE` / `MAX_MBX_SIZE` 和 `MIN_MBX_WRITE_ADDRESS` 等地址范围宏，是否与 ESI 的 `<Sm>` 配置及 EEPROM 内容一致。 |
| `0x0017` | **Invalid sync manager configuration**（`ALSTATUSCODE_INVALIDSMCFG`） | `P → S`、`S → O` | SM 的基本设置（地址、长度、方向）与从站期望不符，常见于修改了 PDO 却没有让 TwinCAT 重新计算配置。重新扫描或重新激活配置。 |
| `0x001B` | **Sync manager watchdog**（`ALSTATUSCODE_SMWATCHDOG`） | `S → O`、`O` 运行中 | **SM2 过程数据看门狗超时**：从站在看门狗时间内没有检测到主站更新 SM2。常见原因有：主站 PLC 停止或断线；MCU 的 `IRQ` 中断丢失；SPI 总线因中断重入而错乱，导致读不到 AL Event。 |
| `0x001D` | **Invalid output configuration**（`ALSTATUSCODE_INVALIDSMOUTCFG`） | `P → S` | **SM2（Outputs）配置错误**。最常见的原因是主站配置的 RxPDO 总字节数与 `APPL_GenerateMapping()` 算出的 `u16OutputSize` 不相等：`0x1C12`/`0x16xx` 动态映射没有生效、Slot 步进不一致、填充位漏算，或总长度超过了 `MAX_PD_OUTPUT_SIZE`。SM 区域重叠也会报这个码。 |
| `0x001E` | **Invalid input configuration**（`ALSTATUSCODE_INVALIDSMINCFG`） | `P → S` | **SM3（Inputs）配置错误**。原因同上，只是对应 `0x1C13`/`0x1Axx` 和 `u16InputSize`。 |
| `0x0024` / `0x0025` | **Invalid input / output mapping**（`ALSTATUSCODE_INVALIDINPUTMAPPING` / `…OUTPUTMAPPING`） | `P → S` | `0x1C13`/`0x1C12` 指向的映射对象不存在，或映射内容与从站期望不符。模块化设备中，多半是 `0xF030` 没有正确实例化对应 Slot 的 `0x16xx`/`0x1Axx`。 |
| `0x0029` | **Freerun needs 3 buffer mode**（`ALSTATUSCODE_FREERUNNEEDS3BUFFERMODE`） | `P → S` | FreeRun 模式要求 SM2/SM3 工作在 3 缓冲模式，检查 ESI 中 SM 的控制字。 |
| `0x002C` | **Fatal sync error**（`ALSTATUSCODE_FATALSYNCERROR`） | `O` 运行中 | ESC 不再产生 SYNC 信号，常见于从站掉线后重新连上。让主站回到 Init 再重新进入 Op，以重新初始化 DC。 |
| `0x002D` | **No sync error**（`ALSTATUSCODE_NOSYNCERROR`） | `S → O` | 在 Safe-Op 到 Op 的超时时间内没有收到第一个 SYNC0/SYNC1 事件。检查 `SYNC0` 引脚是否有脉冲输出（EEPROM 中的 SYNC 输出配置），以及 MCU 对应的 EXTI 是否正常调用了 `Sync0_Isr()`。 |
| `0x0030` | **Invalid DC SYNC configuration**（`ALSTATUSCODE_DCINVALIDSYNCCFG`） | `P → S`、`S → O` | DC 配置不满足应用要求。检查 ESI 中 `<Dc><OpMode>` 的设置与 `DC_SUPPORTED` 等宏是否匹配。 |
| `0x0036` | **DC Sync0 cycle time**（`ALSTATUSCODE_DCSYNC0CYCLETIME`） | `P → S` | SYNC0 周期不符合应用要求，例如小于从站能处理的最小周期。检查 `MIN_PD_CYCLE_TIME` 与 TwinCAT 中设置的周期。 |

### 可操作的排查顺序

遇到问题时，按“从下往上”的顺序排查，每一步确认没问题后再进入下一层：

1. **物理层与扫描**：网口 link 灯是否正常，TwinCAT 能否扫描到从站。扫描不到时查 PHY 供电、晶振、strap 引脚和网线方向（端口 0 必须是 IN 口），这时还不用看 MCU。
2. **EEPROM 内容**：扫描结果中的 Vendor ID、Product Code 是否正确。不正确或为空，说明 EEPROM 没有烧写或与 ESI 不一致，重新烧写后断电重启。
3. **PDI 通路**：MCU 读 `BYTE_TEST` 是否为 `0x87654321`，`HW_CFG.READY` 是否置位，`0x0140` 是否为预期的 PDI 类型。如果读到全 0 或全 F，查 SPI 模式、片选和时钟（普通读不超过 30 MHz）。
4. **Init → Pre-Op**：卡住时看 AL Status Code。`0x0016` 查邮箱 SM 配置；如果没有错误码而是超时，说明 `MainLoop()` 没有在跑，或者 `0x0220` 读不到，用逻辑分析仪抓一下 SPI 波形。
5. **CoE 可用性**：进入 Pre-Op 后，在 CoE-Online 中读取 `0x1018`、`0x1C12`、`0x1C13`、`0xF030`，确认对象字典与 ESI 一致。读不到某个对象时，优先怀疑 `TOBJECT` 的索引或 Slot 步进。
6. **Pre-Op → Safe-Op**：在 `APPL_GenerateMapping()` 返回前，打印 `u16InputSize` 和 `u16OutputSize`，与 TwinCAT 的 Process Data 页中显示的 SM2/SM3 长度逐字节对比。插两个以上 Slot 测试步进。
7. **Safe-Op → Op**：`0x001B` 查主站是否在发周期帧、IRQ 是否进入 `PDI_Isr()`；`0x002D` 查 SYNC0 是否有脉冲。
8. **Op 运行中掉线**：长时间运行后出现 `0x001B`，基本就是中断重入或丢中断。检查 `DISABLE_ESC_INT()` 是否覆盖了全部四个中断源、优先级是否一致，并用示波器同时抓 `IRQ` 和 SPI 片选：如果 IRQ 一直保持低电平，却不再有新的下降沿进入中断，就说明发生过丢中断。

## 参考资料

**官方资料（主要依据）**

- [Beckhoff EtherCAT Slave Controller 数据手册 Section II：寄存器说明（AL Control/Status、AL Event、SyncManager、FMMU、DC、看门狗）](https://download.beckhoff.com/download/Document/io/ethercat-development-products/ethercat_esc_datasheet_sec2_registers_v3.3.pdf)
- [Beckhoff EtherCAT Slave Controller 数据手册 Section I：技术概述（ESC 功能块与各型号对比）](https://download.beckhoff.com/download/Document/io/ethercat-development-products/ethercat_esc_datasheet_sec1_technology_v2.5.pdf)
- [Beckhoff ET1200 数据手册 Section III](https://download.beckhoff.com/download/document/io/ethercat-development-products/ethercat_et1200_datasheet_v2i2.pdf)
- [Beckhoff Application Note ET9300：EtherCAT Slave Stack Code 说明](https://download.beckhoff.com/download/document/io/ethercat-development-products/an_et9300_v1i10.pdf)
- [Beckhoff Information System：EtherCAT AL Status Codes 列表](https://infosys.beckhoff.com/content/1033/ethercatsystem/1037010571.html)
- [Beckhoff Information System：模块化设备对象示例（0xF000/0xF030/0xF050）](https://infosys.beckhoff.com/content/1033/ed2504/21028508555.html)
- [Beckhoff Information System：EL6695 Modular Device](https://infosys.beckhoff.com/english.php?content=../content/1033/el6695/1317558667.html&id=)
- [EtherCAT Technology Group：EtherCAT Device Protocol Poster（ESM、PDO 映射与分配、MDP 对象区）](https://www.ethercat.org/download/documents/EtherCAT_Device_Protocol_Poster.pdf)
- [Microchip LAN9252 数据手册（DS00001909）](https://ww1.microchip.com/downloads/aemDocuments/documents/UNG/ProductDocuments/DataSheets/LAN9252-Data-Sheet-DS00001909.pdf)
- [Microchip AN1995：LAN9252 SOC Porting Guidelines（CSR 访问与中断保护）](https://ww1.microchip.com/downloads/aemDocuments/documents/OTH/ApplicationNotes/ApplicationNotes/00001995A.pdf)
- [Microchip AN1916：Integrating Microchip’s LAN9252 SDK with Beckhoff’s EtherCAT SSC](https://ww1.microchip.com/downloads/aemDocuments/documents/OTH/ApplicationNotes/ApplicationNotes/00001916B.pdf)
- ETG.5001 Modular Device Profile Specification（ETG 会员资料）

**社区资料与实践记录（补充）**

- [基于 STM32F407-LAN9252 的 EtherCAT 从站协议移植过程 - CSDN 博客](https://blog.csdn.net/qq_41580996/article/details/130291788)
- [STM32F407 与 LAN9252 EtherCAT HBI 资源文件介绍 - CSDN 博客](https://blog.csdn.net/gitblog_09761/article/details/143404001)
- [STM32 + LAN9252 + HAL 库 EtherCAT 从站搭建教程 - CSDN 博客](https://blog.csdn.net/a1547998353/article/details/146331849)
- [从零搭建 EtherCAT 从站（STM32F407 + ET1200）学习记录 - CSDN 博客](https://blog.csdn.net/xuexidexiaohai/article/details/138668675)
- [EtherCAT 之 TwinCAT3 安装、使用 - CSDN 博客](https://blog.csdn.net/LclLsh/article/details/122863502)
- [EtherCAT PDO 映射概述 - CSDN 博客](https://blog.csdn.net/m0_74823933/article/details/146030778)
- [EtherCAT Module and Slot - CSDN 博客](https://blog.csdn.net/qq_42039294/article/details/148441210)
- [EtherCAT 从站实现动态 PDO 功能 - HPMicro 知识库](https://kb.hpmicro.com/2025/08/26/ethercat%e4%bb%8e%e7%ab%99%e5%ae%9e%e7%8e%b0%e5%8a%a8%e6%80%81pdo%e5%8a%9f%e8%83%bd/)
- [EtherCAT 的 Module/Slot 概念与 OD 分配 - HPMicro 知识库](https://kb.hpmicro.com/2026/06/02/ethercat%e7%9a%84module-slot%e6%a6%82%e5%bf%b5%e4%b8%8eod%e5%88%86%e9%85%8d/)
- 本地参考资料：`EtherCAT从站学习板参考资料V 2.1\00_必读`
