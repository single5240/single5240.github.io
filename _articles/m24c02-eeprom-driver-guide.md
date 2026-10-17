---
layout: article
title: N32G455 M24C02 I2C EEPROM 驱动与页边界处理
description: 基于数显式拉力计 HW1.4 固件的 M24C02（256B I2C EEPROM）驱动实现，详解 I2C3 寄存器配置、16 字节页写自动拆分、ACK 轮询与 A/B 双槽参数存储协同。
date: 2026-10-13
category: 嵌入式
tags:
  - N32G455
  - I2C
  - EEPROM
  - M24C02
  - 参数存储
---

> 本文记录数显式拉力计 HW1.4 固件中的 M24C02 I2C EEPROM 驱动（`DRV/drv_m24c02.c/.h`），涵盖硬件连接、器件寻址、16 字节跨页拆分写入、内部写周期 ACK 轮询、外设故障自恢复，以及上层如何将 256 字节空间划分为 A/B 双槽掉电安全参数镜像。

## 芯片特性与驱动概览

M24C02 是 2 Kbit（`256 × 8 bit`）串行 I2C EEPROM，内部按 16 页 × 16 字节组织，支持标准模式 100 kHz 与快速模式 400 kHz。当前固件驱动配置如下：

| 项目 | 当前实现配置 |
| --- | --- |
| 源文件 | `DRV/drv_m24c02.c`、`DRV/drv_m24c02.h` |
| 硬件总线 | N32G455 `I2C3` 主机，7 位寻址，轮询模式（无中断、无 DMA） |
| 通信速率 | 100 kHz（`PCLK2 = 64 MHz`） |
| 容量与地址范围 | 256 字节，字节地址 `0x00`～`0xFF` |
| 页写边界 | 16 字节/页（跨页写入由驱动自动拆分） |
| 默认 7 位地址 | `0x50`（可通过编译宏 `M24C02_I2C_ADDRESS` 覆盖） |
| 单次标志与写周期超时 | 10 ms（覆盖手册最大内部写周期 `tWR = 5 ms`） |
| 公开接口 | `M24c02_Init()`、`M24c02_Read()`、`M24c02_Write()` |

## 硬件连接与器件地址编码

### 引脚与开漏配置

本板使用 `I2C3` 默认映射（`I2C3_RMP = 00`），无需调用重映射函数：

| MCU 引脚 | 信号网络 | GPIO 模式 | 说明 |
| --- | --- | --- | --- |
| PC0 | `I2C3_SCL` | `GPIO_Mode_AF_OD`（复用开漏，50 MHz） | 必须有外部上拉电阻至 VCC |
| PC1 | `I2C3_SDA` | `GPIO_Mode_AF_OD`（复用开漏，50 MHz） | 必须有外部上拉电阻至 VCC |

M24C02（SO8 封装）的 `E0/E1/E2` 为硬件地址脚，`WC` 为写保护脚（低电平允许写入，高电平禁止写入）。若 `WC` 被拉高，写操作会在内部写周期或数据阶段失败。

### 器件选择字节（Device Select Byte）

```text
Bit:   7   6   5   4   3   2   1   0
     +---+---+---+---+---+---+---+---+
     | 1 | 0 | 1 | 0 | E2| E1| E0|R/W|
     +---+---+---+---+---+---+---+---+
```

- 高 4 位固定为 `1010`；
- `E2/E1/E0` 由硬件引脚电平决定，本板实测 7 位地址为 `0x50`（对应 `E2=0, E1=0, E0=0`）；
- `R/W = 0` 为写（`0xA0`），`R/W = 1` 为读（`0xA1`）。

驱动中将 7 位地址左移 1 位后传给标准外设库 `I2C_SendAddr7bit()`：

```c
#define M24C02_ADDRESS_BYTE ((uint8_t)(M24C02_I2C_ADDRESS << 1U))
```

## 存储组织与 16 字节页回绕陷阱

M24C02 共有 16 页，每页 16 字节，页起始地址依次为 `0x00, 0x10, 0x20 ... 0xF0`。

**页写回绕规则（Page Wrap-around）**：数据手册规定，在单次 `Page Write` 事务中，每写入一字节，芯片内部字地址仅低 4 位自动加 1，高 4 位页号保持不变。如果一次连续写入跨越了 16 字节页尾（例如从 `0x0E` 连续写 4 字节），第 3、4 字节**不会**进入下一页的 `0x10, 0x11`，而是回绕覆盖本页开头的 `0x00, 0x01`！

因此，`M24c02_Write()` 在驱动层实现了严格的页边界自动拆分：

```text
当 length > 0：
  本页剩余空间 pageRemain = 16 - (address % 16)
  本次写入长度 chunkLen   = min(length, pageRemain)
  执行单页写入 M24c02_WritePage(address, data, chunkLen)
  执行 ACK 轮询等待内部写周期 tWR 完成（最长 10 ms）
  address += chunkLen
  data    += chunkLen
  length  -= chunkLen
```

例如从 `0x0E` 写 4 字节时，驱动自动拆成两笔独立事务：第一笔写 `0x0E..0x0F`（2 字节）并等待编程完成；第二笔再写 `0x10..0x11`（2 字节）并等待编程完成，彻底杜绝页内回绕覆盖。

### 交互式在线演示：16 字节页回绕陷阱与 A/B 双槽乒乓存储

为直观体验 EEPROM 芯片物理页回绕 Bug 以及上层 A/B 双槽掉电安全机制，下方提供了一个 256 字节纯前端交互模拟沙箱。你可以点击任意单元格检视其所属页与槽位，模拟向 `0x0E` 写入 4 字节观察“无拆分硬件回绕覆盖 `0x00..0x01`”与“驱动安全拆包”的截然不同结果，并测试 A/B 双槽乒乓参数更新与断电回退保护：

<div class="article-interactive-widget" id="eeprom-demo-app" aria-label="M24C02 EEPROM 页回绕与双槽存储交互演示">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE WIDGET · 硬件物理层仿真</span>
    <h3 class="aiw-title">M24C02 EEPROM 16 字节页回绕陷阱与 A/B 双槽乒乓存储模拟器</h3>
    <p class="aiw-desc">仿真 256 字节（16 页 × 16B）物理特性：字地址低 4 位硬件回绕、驱动层 <code>min(length, 16 - (addr % 16))</code> 自动拆包、以及 128B+128B 双槽乒乓镜像与掉电安全回退。</p>
  </div>
  <div class="aiw-body">
    <div class="aiw-stats" aria-label="EEPROM 当前状态">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">当前活动参数镜像</span>
        <span class="aiw-stat-value accent" id="eeprom-stat-slot">当前活动: Slot A (0x00..0x7F)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">活动槽 CRC-16 状态</span>
        <span class="aiw-stat-value" id="eeprom-stat-crc">0x4A1B (合法)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">选定字节地址与值</span>
        <span class="aiw-stat-value" id="eeprom-stat-addr">0x0E (值: 0xAA)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">选定字节所属物理页</span>
        <span class="aiw-stat-value warn" id="eeprom-stat-page">Page 0 (页首: 0x00)</span>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>256 字节物理内存映射矩阵 (16 页 × 16 字节)</span>
        <span class="aiw-hint">青边: Slot A (0x00~0x7F) · 橙边: Slot B (0x80~0xFF) · 红格: 回绕污染</span>
      </div>
      <div class="eeprom-slot-badges">
        <span class="eeprom-slot-badge slot-a active-indicator" id="eeprom-badge-slot-a">Slot A [当前生效镜像 · 128B]</span>
        <span class="eeprom-slot-badge slot-b" id="eeprom-badge-slot-b">Slot B [备用写入槽 · 128B]</span>
      </div>
      <div class="eeprom-matrix-wrap">
        <div class="eeprom-grid" id="eeprom-grid"></div>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>实验一：16 字节页写边界回绕陷阱对比测试</span>
        <span class="aiw-hint">测试从 0x0E 连续写入 4 字节 [0x11, 0x22, 0x33, 0x44]</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn danger" id="eeprom-btn-raw-bug">原生裸写 (无页拆分，触发回绕篡改Bug)</button>
        <button type="button" class="aiw-btn primary" id="eeprom-btn-driver-safe">驱动智能拆分写入 (Page Chunking)</button>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>实验二：A/B 双槽掉电安全乒乓参数存储实验</span>
        <span class="aiw-hint">演示交替写入非活动槽与断电 CRC 自动回滚</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" id="eeprom-btn-pingpong">正常更新参数 (乒乓切换写入非活动槽)</button>
        <button type="button" class="aiw-btn warn" id="eeprom-btn-fail">故障注入: 写入中途断电 (模拟开机自动回退)</button>
        <button type="button" class="aiw-btn" id="eeprom-btn-reset">恢复出厂配置</button>
      </div>
    </div>

    <div class="aiw-log-panel">
      <div class="aiw-section-title">
        <span>I2C 事务时序与驱动安全追踪日志</span>
        <span class="aiw-hint">注意观察硬件回绕覆盖警报与 ACK 轮询时序</span>
      </div>
      <div class="aiw-log" id="eeprom-log" aria-live="polite"></div>
    </div>
  </div>
</div>

## I2C 事务帧格式与 ACK 轮询

### 随机读单字节

当前 `M24c02_Read()` 对每个字节采用确定性的随机读时序（在最后 1 字节接收前关闭 `ACK` 并产生 `STOP`）：

```text
START
  → 发送 0xA0（写器件地址），等待 ADDRF
  → 发送 8 位字地址 word_address，等待 BYTEF
RESTART
  → 关闭 ACK 使能
  → 发送 0xA1（读器件地址），等待 ADDRF
  → 读 STS1 + 读 STS2 清 ADDRF，立即置位 STOP
  → 等待 RXDATNE，读取 1 字节数据
  → 等待 I2C BUSY = 0，重新打开 ACK 使能
```

### 页写与内部写周期 ACK 轮询（ACK Polling）

发出页写数据的最后一个字节并产生 `STOP` 后，M24C02 进入最长 5 ms 的内部非易失性擦写周期（`tWR`）。在此期间，芯片不会响应外部访问，对器件选择字节会返回 `NACK`。

驱动不采用固定 `Delay(5)` 盲等，而是通过 `M24c02_WaitWriteComplete()` 执行 **ACK 轮询**，一旦芯片提前写完即可立即返回：

```text
等待 I2C BUSY = 0
循环（以 PlatformTime_GetMs() 无符号差值计时，上限 10 ms）：
  发出 START
  发送 0xA0（写器件地址）
  轮询 STS1：
    - 若 ADDRF = 1（从机已回 ACK，内部写完成）：
        读 STS1/STS2 清 ADDRF → 发 STOP → 等 BUSY = 0 → 返回 OK
    - 若 ACKFAIL = 1（从机仍忙，回 NACK）：
        清 ACKFAIL 标志 → 发 STOP → 等 BUSY = 0 → 继续下一轮尝试
若超过 10 ms 仍未收到 ACK → 返回 M24C02_STATUS_TIMEOUT
```

`M24c02_Init()` 同样复用该函数探测器件是否在线应答。

## N32G455 I2C3 外设配置与错误恢复

### 时钟与寄存器特性

`I2C3` 挂载于 APB2 总线（`PCLK2 = 64 MHz`）。调用标准外设库 `I2C_Init()` 配置 100 kHz 时：

- `CLKCTRL (CCR)` 计算值为 `64 MHz / (100 kHz × 2) = 320`，实际产生标准 100 kHz `SCL`；
- 库函数将大于 36 MHz 的 `CTRL2.FREQ` 封顶记为 `36`，`TMRISE` 设为 `37`。实际波形上升时间受板级外部上拉电阻与走线电容支配，联调时应以示波器实测为准。

### 外设异常自恢复（`M24c02_RecoverPeripheral`）

I2C 总线在受到静电、毛刺或从机异常影响时，容易卡在 `BUSY` 或仲裁错误状态。驱动在任何读写或初始化超时/错误退出前，均自动调用 `M24c02_RecoverPeripheral()`：

1. 置位 `STOP` 请求并重新打开 `ACK` 配置；
2. 清除 `TIMOUT`、`OVERRUN`、`ARLOST`、`BUSERR`、`ACKFAIL` 全部错误标志；
3. 置位并释放 `I2C3` 软件复位位（`SWRST`），最后执行 `I2C_DeInit(I2C3)` 并按 100 kHz 重新初始化寄存器。

## 公开接口与最小调用示例

### 接口定义与状态码

```c
typedef enum
{
    M24C02_STATUS_OK = 0,
    M24C02_STATUS_INVALID_PARAM, /* 空指针、长度为 0，或 address + length > 256 */
    M24C02_STATUS_TIMEOUT,       /* 10 ms 内标志未就绪或内部写周期未完成 */
    M24C02_STATUS_NACK,          /* 地址或数据阶段收到 NACK */
    M24C02_STATUS_BUS_ERROR      /* 总线错误、仲裁丢失、溢出等 */
} m24c02_status_t;

m24c02_status_t M24c02_Init(void);
m24c02_status_t M24c02_Read(uint16_t address, uint8_t *data, uint16_t length);
m24c02_status_t M24c02_Write(uint16_t address, const uint8_t *data, uint16_t length);
```

### 最小调用示例

```c
#include "drv_m24c02.h"

static void Eeprom_Demo(void)
{
    /* 选取跨越 0x0F -> 0x10 页边界的 4 字节测试跨页拆分 */
    uint8_t tx[4] = { 0x10U, 0x32U, 0x54U, 0x76U };
    uint8_t rx[4] = { 0U };

    if (M24c02_Init() != M24C02_STATUS_OK)
    {
        return;
    }

    if (M24c02_Write(0x0EU, tx, sizeof(tx)) != M24C02_STATUS_OK)
    {
        return;
    }

    (void)M24c02_Read(0x0EU, rx, sizeof(rx));
}
```

## 与上层 A/B 双槽掉电安全参数存储的协同

驱动层只负责可靠的字节数组读写，不感知业务数据结构。上层 `APP/app_param_store.c` 将 M24C02 的 256 字节对半划分为两个 128 字节的乒乓槽位：

| 槽位 | 地址范围 | 职责说明 |
| --- | --- | --- |
| 槽 A（Slot A） | `0x00`～`0x7F`（128 B） | 保存完整的魔数、版本号、递增序号、用户设置、标定曲线及 CRC-16/MODBUS |
| 槽 B（Slot B） | `0x80`～`0xFF`（128 B） | 与槽 A 结构完全相同，每次保存总是写入**非活动槽** |

这样设计的工程价值在于：

1. **掉电原子性**：即使在 `M24c02_Write()` 跨 8 页（128 B）写入中途发生断电，被破坏的也只是正在写入的新槽；下次上电时，`AppParam_Load()` 校验两个槽的 CRC-16 与递增序号，自动回退到完好无损的旧槽镜像。
2. **写后读回校验**：每次写入非活动槽后，上层立即调用 `M24c02_Read()` 整槽读回并逐字节比对，确认物理存储无误后才更新活动槽指针。
3. **看门狗安全边界**：写满 128 字节共 8 页，正常耗时约 `8 × 5 ms ≈ 40 ms`（极端超时上界 < 100 ms），远小于约 1 s 的独立看门狗窗口。

## 移植检查清单

- [ ] **引脚与重映射**：确认目标板 SCL/SDA 引脚与 `I2C3_RMP` 配置，GPIO 设为复用开漏（`GPIO_Mode_AF_OD`）。
- [ ] **电气与写保护**：确认外部上拉电阻已焊接、`WC` 脚拉低允许写入、`VCC` 与 MCU I2C 电平一致。
- [ ] **跨页边界测试**：向 `0x0F` 地址连续写入 2 字节以上，读回确认 `0x0F` 与 `0x10` 均正确，且本页首地址 `0x00` 未被回绕篡改。
- [ ] **调用上下文约束**：仅在初始化与主循环中调用，严禁在中断服务程序（ISR）中调用阻塞式 I2C 读写。
