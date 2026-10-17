---
layout: article
title: EtherCAT 从站协议栈移植、动态 PDO 与状态机基础
description: 基于 STM32F407 + LAN9252 的 EtherCAT 从站（SSC）移植笔记，涵盖硬件与中断适配、CoE 对象字典、动态 PDO、ETG.5001 模块化设备（Slot/Module）及状态机故障排查。
date: 2026-05-18
category: 嵌入式
tags:
  - EtherCAT
  - STM32
  - LAN9252
  - 协议栈移植
---

> 本文整理自 STM32F407 + LAN9252（或 ET1100/ET1200）平台的 Beckhoff SSC（Slave Stack Code）从站协议栈移植笔记，重点梳理硬件抽象层适配、CoE 对象字典与动态 PDO 映射机制、ETG.5001 模块化设备（Slot/Module）地址偏移规则，以及 EtherCAT 状态机（ESM）转换条件与常见 `AL Status Code` 报错排查。

## 从站协议栈移植

### 参考资料

- [基于 STM32F407-LAN9252 的 EtherCAT 从站协议移植过程 - CSDN 博客](https://blog.csdn.net/qq_41580996/article/details/130291788)
- [STM32F407 与 LAN9252 EtherCAT HBI 资源文件介绍 - CSDN 博客](https://blog.csdn.net/gitblog_09761/article/details/143404001)
- [EtherCAT 之 TwinCAT3 安装、使用 - CSDN 博客](https://blog.csdn.net/LclLsh/article/details/122863502)
- [STM32 + LAN9252 + HAL 库 EtherCAT 从站搭建教程 - CSDN 博客](https://blog.csdn.net/a1547998353/article/details/146331849)
- [从零搭建 EtherCAT 从站（STM32F407 + ET1200）学习记录 - CSDN 博客](https://blog.csdn.net/xuexidexiaohai/article/details/138668675)
- 本地参考资料：`EtherCAT从站学习板参考资料V 2.1\00_必读`

### 硬件资源适配

将 MCU（如 STM32F407）与 ESC 芯片（如 Microchip LAN9252）对接时，MCU 侧需要适配以下三类外设资源：

| 硬件资源 | 信号 / 外设 | 核心职责与注意事项 |
| --- | --- | --- |
| **PDI 通信总线** | SPI 接口或并行总线（HBI/FSMC） | 用于 MCU 读写 ESC 内部寄存器与 Process RAM。SPI 模式接线简单，HBI 并行总线吞吐量更高、延迟更低。 |
| **3 个外部中断（EXTI）** | `ESC_IRQ`、`SYNC0`、`SYNC1` | `IRQ` 通知 MCU 处理 AL Event（邮箱、SM2 输出事件、状态切换）；`SYNC0` / `SYNC1` 在分布式时钟（DC）模式下提供周期性高精度硬件同步触发。注意确认中断有效边沿（通常为下降沿触发）及引脚上拉配置。 |
| **1 ms 硬件定时器** | 基础定时器（如 `TIM2` / `TIM6`） | 为 SSC 协议栈提供 1 ms 周期时基，用于状态机切换超时检测、邮箱超时和看门狗计时。 |

### 驱动层与协议栈接口适配

工程通常使用 **TwinCAT 3** 作为主站配合测试。在软件层面，移植工作主要分为 **底层 ESC 读写封装**、**中断与临界区适配** 以及 **SSC 应用层回调实现** 三部分。

#### 1. 底层寄存器与内存访问函数

在 Microchip LAN9252 官方 SDK 中，底层总线访问函数沿用了 `PMP`（Parallel Master Port）前缀命名（即使底层走的是 SPI 接口也常保留该封装）：

1. `PMPReadWord` / `PMPWriteWord`：16 位字读写。
2. `PMPReadDWord` / `PMPWriteDWord`：32 位双字读写（LAN9252 的系统控制状态寄存器 CSR 均为 32 位对齐访问）。
3. `PMPReadRegUsingCSR` / `PMPWriteRegUsingCSR`：通过 LAN9252 的 CSR 接口（`0x0304 ECAT_CSR_DATA` 与 `0x0300 ECAT_CSR_CMD`）间接读写内部 EtherCAT Core 寄存器。

这些底层读写最终要对接到 Beckhoff SSC 硬件抽象层（如 `el9800hw.c` 或 `lan9252_hw.c`）要求的标准接口：

- `HW_Init()` / `HW_Release()`：初始化 PDI 接口、外部中断与定时器，等待 ESC 芯片 EEPROM 加载就绪（检测 `0x0064 BYTE_TEST` 寄存器返回 `0x87654321` 及 `READY` 标志位）。
- `HW_GetALEventRegister()` / `HW_GetALEventRegister_Isr()`：读取 ESC 的 AL Event 请求寄存器（`0x0220`），分别供主循环和中断上下文调用。
- `HW_EscRead()` / `HW_EscWrite()` 及 `_Isr` 版本：访问 ESC 寄存器与过程数据 RAM（Process RAM FIFO）。
- `HW_EscReadMbxMem()` / `HW_EscWriteMbxMem()`：读写邮箱（Mailbox）缓冲区。

#### 2. 中断服务函数与临界区保护（关键易错点）

协议栈运行依赖以下入口函数的协同调用：

- **主循环**：在 `while (1)` 中周期性调用 `MainLoop()`，处理非实时邮箱通信（SDO/CoE）、状态机后台任务以及自由运行（FreeRun）模式下的周期性数据更新。
- **PDI 中断（`EXTI` → `PDI_Isr()`）**：当 ESC 产生 `IRQ` 信号（如主站写入了 SM2 输出数据或下发了邮箱帧）时触发。
- **DC 同步中断（`EXTI` → `Sync0_Isr()` / `Sync1_Isr()`）**：在启用分布式时钟（DC Synchron）时触发高精度周期控制。
- **1 ms 定时器中断（`TIM` → `ECAT_CheckTimer()`）**：每 1 ms 调用一次协议栈定时检查函数（或递增 `u16LocalTimer`）。

**必须注意 SPI/HBI 总线重入冲突**：如果主循环 `MainLoop()` 正在通过 SPI 读写 LAN9252，此时若触发 `PDI_Isr()` 或 `Sync0_Isr()` 并在中断里发起新的 SPI 读写，会导致 SPI 时序错乱与芯片状态机死锁。因此必须正确实现 `DISABLE_ESC_INT()` 与 `ENABLE_ESC_INT()` 宏，在主循环访问 ESC 期间屏蔽 `IRQ`/`SYNC0`/`SYNC1` 及定时器中断，并将这几个中断配置为**相同抢占优先级**（禁止互相抢占嵌套）。

#### 3. SSC 应用层回调函数

SSC 协议栈将与具体业务强相关的逻辑留给应用层回调实现，按职责分为两类：

**周期性过程数据与业务回调**（在每个通信周期内按 `OutputMapping → Application → InputMapping` 顺序执行）：

1. `APPL_OutputMapping(UINT16 *pData)`：**输出映射（RxPDO，主站 → 从站）**。将主站下发到 SM2 缓冲区的数据解包并拷贝到本地输出结构体（如 `0x7000` 关联变量）。
2. `APPL_Application(void)`：**自定义应用逻辑**。根据接收到的主站控制字/目标值执行控制算法或驱动外设，并采集本地传感器/状态数据写入输入结构体。
3. `APPL_InputMapping(UINT16 *pData)`：**输入映射（TxPDO，从站 → 主站）**。将本地输入结构体（如 `0x6000` 关联变量）打包写入 SM3 缓冲区供主站读取。

**状态转换与映射计算回调**（在状态机切换阶段由 `AL_ControlInd` 调用）：

1. `APPL_GenerateMapping(UINT16 *pInputSize, UINT16 *pOutputSize)`：根据当前 `0x1C12`（RxPDO 分配）和 `0x1C13`（TxPDO 分配）以及对应的 `0x16xx`/`0x1Axx` 映射表，动态计算当前激活的输入、输出过程数据总字节数。**这是实现动态 PDO 和模块化设备的核心函数**。
2. `APPL_StartMailboxHandler()` / `APPL_StopMailboxHandler()`：`Init ↔ Pre-Op` 切换时启停邮箱处理。
3. `APPL_StartInputHandler()` / `APPL_StopInputHandler()`：`Pre-Op ↔ Safe-Op` 切换时启停输入数据更新。
4. `APPL_StartOutputHandler()` / `APPL_StopOutputHandler()`：`Safe-Op ↔ Op` 切换时启停输出驱动；当从站退出 `Op` 状态时，应在 `APPL_StopOutputHandler()` 中将硬件输出置于安全状态（如关闭电机使能、断开输出继电器）。

---

## 动态 PDO 与模块化设备（Slot / Module）

### 参考资料

- [Beckhoff Information System - EL6695 Modular Device](https://infosys.beckhoff.com/english.php?content=../content/1033/el6695/1317558667.html&id=)
- [EtherCAT PDO 映射概述 - CSDN 博客](https://blog.csdn.net/m0_74823933/article/details/146030778)
- [EtherCAT 从站实现动态 PDO 功能 - HPMicro 知识库](https://kb.hpmicro.com/2025/08/26/ethercat%e4%bb%8e%e7%ab%99%e5%ae%9e%e7%8e%b0%e5%8a%a8%e6%80%81pdo%e5%8a%9f%e8%83%bd/)
- [EtherCAT Module and Slot - CSDN 博客](https://blog.csdn.net/qq_42039294/article/details/148441210)
- 核心协议规范：**ETG.5001 (Modular Device Profile Specification)**。

### CoE 对象字典与 `TOBJECT` 结构

在 CANopen over EtherCAT（CoE）中，从站的所有参数、配置与过程数据都组织在**对象字典（Object Dictionary, OD）**中。SSC 代码里通过双向链表管理对象字典，核心节点结构体为 `TOBJECT`：

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

理解动态 PDO 与 Slot/Module 的前提，是先理解 SSC 如何通过遍历和修改 `TOBJECT` 链表来响应主站 SDO 读写请求。

### SDO 配置与 PDO 三级映射关系

许多初学者容易混淆 SDO 和 PDO 的关系：

- **SDO（Service Data Object）** 是走邮箱（SM0/SM1）的**非周期性配置通道**，用于在 `Pre-Op` 阶段按 `Index:SubIndex` 读写对象字典中的任意条目。
- **PDO（Process Data Object）** 是走过程数据 RAM（SM2/SM3）的**周期性实时数据通道**，传输时不携带索引头，主从站直接按事先约定好的字节排布解析数据。

这个“事先约定好的字节排布”，正是由主站在 `Pre-Op` 阶段通过 **SDO 写入 CoE 对象字典中的三级映射对象** 来完成的：

```text
[第一级：SM 通道分配对象]
  0x1C12 (SM2 RxPDO Assign) ──► 包含若干子索引，指向被激活的 0x16xx 索引
  0x1C13 (SM3 TxPDO Assign) ──► 包含若干子索引，指向被激活的 0x1Axx 索引
        │
        ▼
[第二级：PDO 映射参数对象]
  0x1600 ~ 0x17FF (RxPDO Mapping) ──► 每个子索引为 32 位值：[Index(16b) | SubIndex(8b) | BitLen(8b)]
  0x1A00 ~ 0x1BFF (TxPDO Mapping) ──► 描述该 PDO 内部依次打包了哪些应用数据条目及位宽
        │
        ▼
[第三级：应用数据对象]
  0x7000 ~ 0x7FFF (Outputs) ──► 主站下发给从站的控制变量（对应 APPL_OutputMapping）
  0x6000 ~ 0x6FFF (Inputs)  ──► 从站上报给主站的状态变量（对应 APPL_InputMapping）
```

工程中常说的“动态 PDO”细分为两个层次：

1. **可选择 PDO 映射（Selectable PDO Mapping）**：`0x16xx` / `0x1Axx` 内部包含哪些子条目是固定的（只读），但 `0x1C12` / `0x1C13` 可写。主站在 `Pre-Op` 阶段通过 SDO 修改 `0x1C12` / `0x1C13`，选择将哪些 `0x16xx` / `0x1Axx` 挂载到 SM2 / SM3 上。
2. **完全动态 PDO 映射（Dynamic PDO Mapping）**：不仅 `0x1C12` / `0x1C13` 可写，连 `0x16xx` / `0x1Axx` 本身也支持 SDO 改写。主站先将 `0x16xx:00`（SubIndex 0）写为 `0` 清空映射，接着往 `0x16xx:01..0n` 写入自定义的 `0x70xx` 映射项，最后将条目总数写回 `0x16xx:00` 生效。

无论是哪一种，当从站收到 `Pre-Op → Safe-Op` 转换请求时，都会调用 `APPL_GenerateMapping()` 顺着 `0x1C12/0x1C13 → 0x16xx/0x1Axx` 计算出总位长并换算成字节数，交给协议栈去和主站配置的 SM2/SM3 长度做严格比对。

### ETG.5001 模块化设备（Slot 与 Module）工作原理

先完全掌握上面的三级 PDO 映射，再看 **ETG.5001 模块化设备（Modular Device Profile）** 就会非常清晰。

在网关、耦合器或多轴/多通道 IO 从站中，一个从站下包含多个**插槽（Slot）**，每个插槽可以灵活挂载不同类型的功能**模块（Module）**。为了避免为每个插槽手动静态定义几十个重复的对象字典条目，ETG.5001 规定了基于**步进偏移（Increment）**的动态地址分配机制：

#### 1. 模块化设备专属字典对象（`0xF0xx`）

- **`0xF000`（Modular Device Profile）**：定义模块化设备的基本信息，包括设备上所有模块共享的索引步进（Index Distance）和最大插槽数量。
- **`0xF030`（Configured Module Ident List）**：**已配置模块标识列表**。主站在 `Pre-Op` 阶段通过 SDO 将用户在 TwinCAT 界面中为各个 Slot 选择的 `Module Ident` 写入 `0xF030` 的对应子索引。
- **`0xF050`（Detected Module Ident List，可选）**：**实际检测到的模块标识列表**。从站根据物理插槽上实际插入的硬件模块上报 Module ID，供主站与 `0xF030` 进行一致性校验。

#### 2. Slot 索引偏移计算规则

假设某类 Module 的模板数据对象基地址为 `0x6000`（输入）和 `0x7000`（输出），模板 PDO 映射对象基地址为 `0x1600`（RxPDO）和 `0x1A00`（TxPDO）。当该 Module 被挂载到第 `n` 个插槽（`n = 0, 1, 2, ...`，即 Slot 1 对应 `n = 0`，Slot 2 对应 `n = 1`）时：

- **数据对象索引**：`ObjectIndex(n) = BaseObjectIndex + n * SlotIndexIncrement`
- **PDO 映射对象索引**：`PdoIndex(n) = BasePdoIndex + n * SlotPdoIncrement`

例如当 `SlotIndexIncrement = 0x0010`、`SlotPdoIncrement = 0x0001` 时：
- **Slot 1（`n = 0`）**：使用 `0x1600` / `0x1A00`，映射的数据对象为 `0x7000` / `0x6000`；
- **Slot 2（`n = 1`）**：自动偏移为 `0x1601` / `0x1A01`，其内部映射的数据对象自动偏移为 `0x7010` / `0x6010`；
- 主站在启动时会将 `0x1600`、`0x1601` 依次写入 `0x1C12` 的子索引 `1`、`2`，从而把所有已挂载 Slot 的 PDO 串联进同一个 SM2/SM3 过程数据帧中。

### ESI XML 文件与 EEPROM（SII）一致性

- **ESI（EtherCAT Slave Information）XML 文件**是连接从站固件开发与主站工程组态的桥梁。
- **双重作用**：
  1. 放入主站配置目录（如 `C:\TwinCAT\3.1\Config\Io\EtherCAT`），供 TwinCAT 解析从站的身份信息、SM0~SM3 参数、对象字典以及 Slot/Module 组合规则。
  2. 用于生成并烧写从站板载 **EEPROM（SII，Slave Information Interface）** 二进制镜像。LAN9252 上电复位时会首先读取外部 I2C EEPROM 来初始化 PDI 接口模式（如 SPI 或 HBI）、Vendor ID 和 Product Code。
- **注意**：每次修改 XML 中的关键硬件或身份参数后，不仅要同步修改 MCU 代码，还必须**在 TwinCAT 中重新烧写从站 EEPROM 并对从站断电重启**，同时重新加载 TwinCAT 的 ESI 缓存。

### 关键代码适配检查点

#### 1. `ecat_def.h`

以下宏定义必须与 ESI XML 文件中的字段完全一致：

- `VENDOR_ID`：厂商 ID，对应 XML 的 `<Vendor><Id>`。
- `PRODUCT_CODE`：产品代码，对应 XML 的 `<Device><Type ProductCode="...">`。
- `REVISION_NUMBER`：修订版本号，对应 XML 的 `<Device><Type RevisionNo="...">`。
- `DEVICE_PROFILE_TYPE`：对于 ETG.5001 模块化设备设为 `0x00001389`（十进制 `5001`），对应 XML 中的 `<Profile><ProfileNo>5001</ProfileNo>`。

其他协议栈裁剪宏（如 `COE_SUPPORTED`、`MAX_RX_PDOS`、`MAX_TX_PDOS`、`DC_SUPPORTED` 等）可参考 SSC Tool 中的描述与生成配置。

#### 2. `SSC-9252` 模块化设备实现文件

1. `ssc-9252.c`、`ssc-9252.h` 和 `SSC-9252Objects.h` 是实现模块化对象字典动态挂载与 PDO 映射解析的核心文件。
2. 代码中的 `SlotIndexIncrement` 和 `SlotPdoIncrement` **必须与 XML `<Slots>` 标签下的 `<SlotIndexIncrement>` 和 `<SlotPdoIncrement>` 严格一致**。一旦两边步进值不一致，Slot 1（`n = 0`，偏移量为 0）看起来仍然正常，但**从第二个插槽（Slot 2，`n >= 1`）开始，主站按 XML 计算出的索引与从站内部生成的 `TOBJECT` 索引就会错位**，导致 SDO 配置失败或 PDO 数据错位。

---

## EtherCAT 状态机（ESM）与报错排查

### 五种运行状态

EtherCAT 从站状态机（EtherCAT State Machine, ESM）由主站通过读写 AL Control（`0x0120`）与 AL Status（`0x0130`）寄存器驱动，共包含 5 种状态：

| 状态名称 | 缩写 | 邮箱通信（SDO） | 过程数据输入（Inputs / SM3） | 过程数据输出（Outputs / SM2） | 说明 |
| --- | :---: | :---: | :---: | :---: | --- |
| **Init** | `I` | 关闭 | 关闭 | 关闭 | 链路初始化，仅允许主站直接读写 ESC 寄存器与 EEPROM |
| **Pre-Operational** | `P` | **开启** | 关闭 | 关闭 | 开启 SM0/SM1 邮箱通道，主站通过 SDO 配置参数、下发 `0xF030` 模块列表与 `0x1C12/0x1C13` 动态 PDO 映射 |
| **Safe-Operational** | `S` | **开启** | **开启** | 保持安全状态 | 开启 SM3 输入数据上传（从站 → 主站），硬件输出仍处于安全锁定状态，不实际驱动外部执行器 |
| **Operational** | `O` | **开启** | **开启** | **开启** | 全功能闭环运行，主站通过 SM2 下发的输出数据正式驱动从站物理硬件 |
| **Bootstrap** | `B` | 仅 FoE | 关闭 | 关闭 | 可选状态，专用于通过 FoE（File Access over EtherCAT）进行固件升级 |

### 状态转换流程与校验条件

SSC 协议栈中处理状态转换请求的核心入口函数是 `AL_ControlInd()`（位于 `ecatslv.c`）。每次状态跃迁都必须由主站完成前置寄存器配置，并通过从站内部校验后才会置位新状态；若校验失败，从站会置位错误标志（Error Ind）并将错误原因写入 **AL Status Code（`0x0134`）** 寄存器。

#### 1. Init (`I`) → Pre-Operational (`P`)

**目标**：建立非周期性的邮箱（Mailbox）通信通道，以便后续通过 SDO 配置对象字典。

- **主站完成的配置**：
  - 配置 **SyncManager 0（SM0）**：Mailbox Out（主站发送 → 从站接收）。
  - 配置 **SyncManager 1（SM1）**：Mailbox In（从站发送 → 主站接收）。
  - 向 AL Control 寄存器写入 `STATE_PREOP` 请求。
- **从站内部校验（`CheckSmSettings` & `APPL_StartMailboxHandler`）**：
  - 校验 SM0 和 SM1 的物理起始地址、长度和控制字是否与协议栈宏定义（及 ESI XML）一致。
  - 初始化从站内部邮箱收发缓冲区。

#### 2. Pre-Operational (`P`) → Safe-Operational (`S`)

**目标**：锁定周期性过程数据（Process Data）映射长度，配置 SM2/SM3 与 FMMU，启动从站输入采集。**这是涉及动态 PDO 和 Slot/Module 时最容易报错的阶段。**

- **主站完成的配置**：
  - 通过 SDO 完成对象字典配置（如写入 `0xF030` 模块列表、写入 `0x1C12`/`0x1C13` 及 `0x16xx`/`0x1Axx` 动态 PDO 映射）。
  - 根据当前 PDO 映射结果配置 **SyncManager 2（SM2，Outputs）** 和 **SyncManager 3（SM3，Inputs）** 的起始地址、长度与控制字。
  - 配置 **FMMU（Fieldbus Memory Management Unit）**，建立逻辑地址到从站物理地址的映射。
  - 若启用分布式时钟（DC），配置 DC 同步周期（`SYNC0` / `SYNC1` Cycle Time）与启动偏移。
  - 向 AL Control 寄存器写入 `STATE_SAFEOP` 请求。
- **从站内部校验（`APPL_GenerateMapping` → `CheckSmSettings` → `APPL_StartInputHandler`）**：
  - 调用 `APPL_GenerateMapping(&u16InputSize, &u16OutputSize)` 计算从站当前认为生效的输入/输出字节总长。
  - **严格比对**：主站写入 SM2 寄存器的长度必须等于 `u16OutputSize`，写入 SM3 寄存器的长度必须等于 `u16InputSize`；若不一致，直接拒绝进入 `Safe-Op` 并报 `0x001D` 或 `0x001E`。
  - 校验 DC 同步配置并启动输入数据首次打包更新（`APPL_InputMapping`）。

#### 3. Safe-Operational (`S`) → Operational (`O`)

**目标**：建立完整闭环控制，释放硬件安全锁，允许主站输出数据驱动从站执行机构。

- **主站完成的配置**：
  - 持续发送周期性过程数据帧，确保输出数据有效且工作计数器（WKC）正常。
  - 向 AL Control 寄存器写入 `STATE_OP` 请求。
- **从站内部校验（`APPL_StartOutputHandler`）**：
  - 确认已收到有效的 SM2 输出过程数据事件（或在自由运行/同步模式下已完成首次输出更新）。
  - 若启用了分布式时钟（DC），确认本地时钟已与主站参考时钟完成同步锁定，且正常接收到 `SYNC0` 中断。
  - 调用 `APPL_StartOutputHandler()`，激活硬件输出。

<div id="ecat-esm-demo-app" class="ecat-demo-root">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h3 style="margin:0; font-size:16px;">🔄 EtherCAT 从站状态机（ESM）与动态 PDO 诊断控制台</h3>
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
        ⚡ 故障注入：在 OP 状态制造看门狗超时 (0x001B)
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
      <div id="ecat-log" style="flex:1; min-height:120px; max-height:160px; overflow-y:auto; background:#1e1e1e; border-radius:6px; padding:8px 10px; font-family:ui-monospace, Consolas, monospace; font-size:11px; line-height:1.5;"></div>
    </div>
  </div>
</div>

### 常见 AL Status Code 错误码速查

当 TwinCAT 报状态切换失败（如卡在 `INIT to PREOP`、`PREOP to SAFEOP` 或从 `OP` 掉回 `SAFEOP + ERROR`）时，优先查看 TwinCAT Logger 中的 **AL Status Code（`0x0134`）**：

| 错误码 | 标准名称 | 常见触发阶段 | 根因分析与排查方向 |
| :---: | --- | :---: | --- |
| `0x0016` | **Invalid mailbox configuration** | `I → P` | SM0/SM1 邮箱起始地址或长度不匹配。检查 `ecat_def.h` 中的 `MIN_MBX_SIZE` / `MAX_MBX_SIZE`、`MBX_WRITE_START_ADDR` 是否与 ESI XML `<Sm>` 配置及 EEPROM 内容一致。 |
| `0x001D` | **Invalid output configuration** | `P → S` | **SM2（Outputs）配置错误**。最常见原因是主站配置的 RxPDO 总字节数与从站 `APPL_GenerateMapping()` 算出的 `u16OutputSize` 不相等（如 `0x1C12` / `0x16xx` 动态映射未正确生效、Slot 偏移步进不一致、或未对齐到偶数字节/位填充缺失）。 |
| `0x001E` | **Invalid input configuration** | `P → S` | **SM3（Inputs）配置错误**。原因同上，主站配置的 TxPDO 总字节数与从站算出的 `u16InputSize`（`0x1C13` / `0x1Axx`）不一致。 |
| `0x001B` | **Sync manager watchdog** | `S` / `O` 运行中掉线 | **SM2 过程数据看门狗超时**。从站在看门狗超时期限内未检测到主站更新 SM2 数据。常见于：主站断线/停止发帧、MCU 的 `ESC_IRQ` 中断丢失、或 SPI 总线因中断抢占发生死锁导致无法读取 AL Event。 |
| `0x002C` / `0x002D` | **Fatal sync error / No sync error** | `S → O` 或 `O` 运行中 | **DC 分布式时钟同步错误 / 未收到 SYNC 信号**。检查 LAN9252 的 `SYNC0`/`SYNC1` 引脚是否已正确配置并输出脉冲、MCU 对应 `EXTI` 中断是否正常触发 `Sync0_Isr()`。 |
| `0x0030` | **Invalid DC SYNCH configuration** | `P → S` | DC 同步周期或激活配置不合法。检查 XML 中 `<Dc><OpMode>` 配置与代码中 `DC_SUPPORTED` 相关宏是否匹配。 |
