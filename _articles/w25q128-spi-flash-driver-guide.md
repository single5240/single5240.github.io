---
layout: article
title: N32G455 W25Q128 SPI NOR Flash 驱动与非阻塞擦写实践
description: 基于数显式拉力计 HW1.4 固件的 W25Q128（16 MiB SPI NOR Flash）驱动实现，涵盖 SPI3 重映射、256B 页边界拆分、状态寄存器写保护检查及非阻塞擦写轮询设计。
date: 2026-10-09
category: 嵌入式
tags:
  - N32G455
  - SPI
  - W25Q128
  - NOR Flash
  - 非阻塞驱动
---

> 本文记录数显式拉力计 HW1.4 固件中的 W25Q128 SPI NOR Flash 驱动（`DRV/drv_w25q128.c/.h`），重点说明 SPI3 引脚重映射、256 字节跨页编程拆分、状态寄存器（SR1/SR2/SR3）写保护核查，以及如何在不阻塞主循环与看门狗的前提下推进 4 KiB 扇区擦除与页编程。SPI 与 DMA 总线全景见 [N32G455 SPI 与 DMA 配置参考]({{ '/articles/n32g455-spi-dma-guide.html' | relative_url }})。

## 芯片特性与驱动概览

W25Q128 是 Winbond 128 Mbit（16 MiB）标准 SPI NOR Flash，期望 24 位 JEDEC ID 为 `0xEF4018`（`0xEF` 代表 Winbond，`0x40` 代表存储器类型，`0x18` 代表 128 Mbit 容量）。

| 项目 | 当前实现配置 |
| --- | --- |
| 源文件 | `DRV/drv_w25q128.c`、`DRV/drv_w25q128.h` |
| 硬件总线 | N32G455 `SPI3` 主机，软件片选（`PA2`），Mode 0，8 bit，MSB first |
| 传输方式 | 按字节全双工轮询，不占用 DMA 通道与中断 |
| 串行时钟 `SCLK` | `PCLK1 / 4 = 32 MHz / 4 = 8 MHz` |
| 容量与组织 | 总容量 `16 MiB`（`16 × 1024 × 1024 B`），页大小 `256 B`，扇区大小 `4 KiB` |
| 页编程超时上限 | 100 ms（手册典型值约 0.4 ms，最大值约 3 ms；实测 256 B 约 4～5 ms） |
| 4 KiB 扇区擦除超时上限 | 1000 ms（手册典型值约 45 ms，最大值约 400 ms；实测约 86～88 ms） |
| 非阻塞事务模型 | 下发单页编程或扇区擦除命令后立即返回，由主循环单次查询 `BUSY` 位推进 |

## 硬件连接与 SPI3 重映射

### 引脚分配

本板通过 `GPIO_RMP3_SPI3`（即 `AFIO_RMP_CFG3` 的 `SPI3_RMP = 11`）将 SPI3 重映射至 `PC3 / PA0 / PA1`，片选 `/CS` 由 `PA2` 软件控制：

| W25Q128 引脚 | MCU 引脚 | 信号方向 | 驱动 GPIO 配置 |
| --- | --- | --- | --- |
| `/CS`（Pin 1） | PA2 | MCU → Flash | 推挽输出，初始化先写高电平再切输出模式 |
| `DO / IO1`（Pin 2） | PA0 | Flash → MCU MISO | 浮空输入 |
| `DI / IO0`（Pin 5） | PA1 | MCU MOSI → Flash | SPI3 复用推挽输出 |
| `CLK`（Pin 6） | PC3 | MCU → Flash | SPI3 复用推挽输出 |
| `/WP`（Pin 3）、`/HOLD`（Pin 7） | 硬件上拉 | — | 标准 SPI 模式下外部上拉至 VCC |

初始化时钟与重映射代码如下：

```c
RCC_EnableAPB2PeriphClk(RCC_APB2_PERIPH_AFIO |
                        RCC_APB2_PERIPH_GPIOA |
                        RCC_APB2_PERIPH_GPIOC, ENABLE);
RCC_EnableAPB1PeriphClk(RCC_APB1_PERIPH_SPI3, ENABLE);
GPIO_ConfigPinRemap(GPIO_RMP3_SPI3, ENABLE);
```

### 全双工单字节收发规则

SPI3 工作在双线全双工模式，即使只向 Flash 发送命令或地址，MISO 也会同步移入字节。每次写入 `SPI_DAT` 后必须等待 `RNE (RXNE)` 并读走 `SPI_DAT`，否则下一字节会触发 `OVR`（接收溢出）；整段命令或数据结束后，必须等待 `BUSY` 标志清零才能拉高 `PA2 (/CS)`。

## 存储组织与 NOR Flash 物理写入规则

| 存储单元 | 大小 | 总数量 | 驱动支持方式 |
| --- | ---: | ---: | --- |
| 字节（Byte） | 1 B | 16,777,216 | 线性字节读取与页内编程寻址（24 位地址高字节在前） |
| 页（Page） | 256 B | 65,536 | 同步 `W25q128_Write()` 自动按页尾拆分；非阻塞 `W25q128_PageProgramStart()` 限单页内 |
| 扇区（Sector） | 4 KiB | 4,096 | `W25q128_SectorErase()` 与 `W25q128_SectorEraseStart()`（要求 4096 字节对齐） |
| 32K / 64K 块与全片 | 32K / 64K / 16M | — | 未实现（全片擦除耗时数秒，会突破 1 s 看门狗窗口） |

使用 NOR Flash 必须遵守三条硬件底线：

1. **先擦后写（只允许 1 → 0）**：扇区擦除后所有位变为 `1`（字节为 `0xFF`），页编程只能把 `1` 改写为 `0`；若要把 `0` 变回 `1`，必须先擦除整个 4 KiB 扇区。驱动层 `W25q128_Write()` 不会隐式替调用方擦除扇区。
2. **256 字节页回绕边界**：单次 `Page Program (0x02)` 若跨越 256 字节页尾（`address & 0xFF` 溢出），芯片内部地址会回绕覆盖当前页首部。因此 `W25q128_Write()` 每次计算 `pageRemain = 256 - (address & 255)`，在页边界处自动拆分为多笔页编程事务。
3. **4 KiB 扇区对齐检查**：扇区擦除传入的 `address` 若不满足 `(address & 0xFFFU) == 0`，驱动直接返回 `W25Q128_STATUS_INVALID_PARAM`，防止误擦除相邻数据。

## 已实现命令与状态寄存器保护核查

### 命令列表

| 命令名称 | 命令码 | 事务帧格式 | 驱动函数 |
| --- | ---: | --- | --- |
| Write Enable | `0x06` | `CS` 低 → `0x06` → `CS` 高 | `W25q128_WriteEnable()` |
| Read Status Register-1 | `0x05` | `0x05` + 读 1 字节状态 | `W25q128_ReadStatus1()` |
| Read Status Register-2 / 3 | `0x35` / `0x15` | 命令 + 读 1 字节状态 | `W25q128_ReadStatusRegisters()` |
| Read Data | `0x03` | `0x03` + 24 位地址 + 连续读 N 字节 | `W25q128_Read()` |
| Page Program | `0x02` | `0x02` + 24 位地址 + 1～256 字节数据 | `W25q128_PageProgram()` / `PageProgramStart()` |
| Sector Erase (4 KiB) | `0x20` | `0x20` + 24 位对齐地址 | `W25q128_SectorErase()` / `SectorEraseStart()` |
| Read JEDEC ID | `0x9F` | `0x9F` + 读 3 字节 ID | `W25q128_ReadJedecId()` |

### 状态寄存器与写保护检查

状态寄存器 1（SR1，`0x05`）的核心位定义如下：

| 位 | 名称 | 驱动掩码 | 含义 |
| ---: | --- | --- | --- |
| Bit 0 | `BUSY`（WIP） | `0x01` | `1` = 内部编程或扇区擦除进行中；`0` = 空闲 |
| Bit 1 | `WEL` | `0x02` | `1` = 写使能锁存器已置位（每次编程/擦除完成后自动清零） |
| Bit 2..4 | `BP0..BP2` | — | 块写保护范围配置位 |

每次发送 `Write Enable (0x06)` 后，驱动都会立即读回 SR1 校验 `WEL == 1`；若 `WEL` 未置位，立即返回 `W25Q128_STATUS_WRITE_ENABLE_FAILED`。

此外，上层记录存储服务在挂载前会调用 `W25q128_ReadStatusRegisters()` 同时读取 SR1、SR2、SR3，保守要求：

- SR1 的 `BP[2:0] == 0`；
- SR2 的 `CMP == 0`；
- SR3 的 `WPS == 0`。

任一保护位非零时拒绝写入，且驱动绝不主动下发改写状态寄存器的指令，防止意外将 Flash 锁成只读状态。

## 为什么需要非阻塞页编程与扇区擦除

在开启独立看门狗（窗口约 1 s）和 AD7190 高频连续采样后，一次 4 KiB 扇区擦除在物理上需要 **45～400 ms**（实测约 88 ms）。如果主循环直接调用阻塞式 `W25q128_SectorErase()` 原地死等 `BUSY == 0`，会导致：

- 主循环停摆近百毫秒，按键消抖掉帧、LCD 8 行条带刷新卡顿；
- AD7190 的 255 帧环形队列可能逼近高水位；
- 连续擦除多个扇区时直接触发看门狗复位。

而拆分看物理过程可以发现：

- **SPI 命令下发阶段**：发送 `0x06` + `0x20` + 3 字节地址仅占几个微秒；即使是 256 字节满页编程，在 8 MHz SCLK 下线上数据传输也仅需 **约 0.256 ms**；
- **芯片内部电荷擦写阶段**：拉高 `/CS` 后，Flash 内部高压泵独自工作数毫秒至数百毫秒，此时完全不需要占用 MCU。

因此驱动提供了一组**单事务非阻塞接口**：

```c
w25q128_status_t W25q128_PageProgramStart(uint32_t address, const uint8_t *data, uint16_t length);
w25q128_status_t W25q128_SectorEraseStart(uint32_t address);
w25q128_status_t W25q128_ReadBusy(bool *busy);
w25q128_status_t W25q128_PollOperation(bool *completed);
bool             W25q128_IsOperationActive(void);
```

非阻塞状态推进流程如下：

```text
1. 调用 Start 接口（PageProgramStart 或 SectorEraseStart）：
   ├─ 校验地址、单页不跨界或 4 KiB 扇区对齐
   ├─ 若驱动已有活动事务，或单次读 SR1 发现硬件 BUSY=1 → 立即返回 W25Q128_STATUS_BUSY
   ├─ 发送 0x06 并确认 WEL = 1
   ├─ 记录活动事务上下文与起始时间戳（100 ms / 1000 ms 超时）
   └─ 发送 0x02+地址+数据（≤ 0.26 ms）或 0x20+地址，拉高 CS 后立即返回主循环

2. 主循环每轮调用 W25q128_PollOperation(&completed)：
   ├─ 发送一次 0x05 读取 1 字节 SR1（耗时仅数微秒）
   ├─ 若 BUSY == 0：清除活动事务标志，置 *completed = true，返回 OK
   ├─ 若 BUSY == 1 且未超时：置 *completed = false，立即返回 OK 让主循环继续运行
   └─ 若 BUSY == 1 且超出截止时间：返回 TIMEOUT，但保持事务隔离直到物理 BUSY 真正清零
```

在非阻塞事务活动期间（`W25q128_IsOperationActive() == true`），任何普通 `Read`、重复 `Start` 或同步擦写都会被驱动拦截并返回 `W25Q128_STATUS_BUSY`，从而在单执行上下文下实现严密的事务互斥。

<div id="w25q-demo-app" class="w25q-demo-root">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h3 style="margin:0; font-size:16px;">⏱️ W25Q128 非阻塞状态机 vs 阻塞轮询抖动模拟器</h3>
    <span style="font-size:12px; color:var(--muted);">纯前端交互演示</span>
  </div>

  <!-- Chip Status Bar -->
  <div class="w25q-chip-bar">
    <div class="w25q-chip-state">
      <span id="w25q-led-busy" class="w25q-led"></span>
      <span id="w25q-chip-state-text">STANDBY (空闲就绪)</span>
    </div>
    <div style="display:flex; align-items:center; gap:16px;">
      <div class="w25q-chip-flags">
        <span class="w25q-flag"><span id="w25q-led-wel" class="w25q-led" style="margin-right:4px;"></span>WEL</span>
        <span class="w25q-flag">BUSY</span>
      </div>
      <span id="w25q-mode-badge" class="ecat-status-val">当前模式：非阻塞状态机 (推荐)</span>
      <button class="ecat-btn" id="w25q-mode-toggle" style="background:#2a2a2a; border-color:#444; color:#fff;">切换为：阻塞轮询 while(BUSY)</button>
    </div>
  </div>

  <!-- Meters Grid -->
  <div class="w25q-meter-grid">
    <div class="w25q-meter-card">
      <div class="w25q-meter-title">
        <span>主循环单圈耗时 (Jitter)</span>
        <span style="color:var(--muted);">基准: 0.15 ms</span>
      </div>
      <div id="w25q-jitter-val" class="w25q-meter-val">0.15 ms</div>
      <div class="w25q-meter-bar">
        <div id="w25q-jitter-bar" class="w25q-meter-fill" style="width:2%;"></div>
      </div>
      <div style="font-size:11px; color:var(--muted); line-height:1.4;">
        阻塞 88ms 期间主循环完全停摆，导致按键消抖掉帧、LCD 条带刷屏撕裂。
      </div>
    </div>

    <div class="w25q-meter-card">
      <div class="w25q-meter-title">
        <span>AD7190 2.4kHz 连续采样队列</span>
        <span style="color:var(--muted);">容量: 255 帧</span>
      </div>
      <div id="w25q-queue-val" class="w25q-meter-val">2 / 255 帧</div>
      <div class="w25q-meter-bar">
        <div id="w25q-queue-bar" class="w25q-meter-fill" style="width:1%;"></div>
      </div>
      <div style="font-size:11px; color:var(--muted); line-height:1.4;">
        硬件中断以 2400 sps 灌入数据。阻塞 88ms 累积 ~211 帧，逼近 255 满溢危险线。
      </div>
    </div>

    <div class="w25q-meter-card">
      <div class="w25q-meter-title">
        <span>独立看门狗 (IWDG 窗口)</span>
        <span style="color:var(--muted);">超时: 1000 ms</span>
      </div>
      <div id="w25q-iwdg-val" class="w25q-meter-val">1000 ms</div>
      <div class="w25q-meter-bar">
        <div id="w25q-iwdg-bar" class="w25q-meter-fill" style="width:100%;"></div>
      </div>
      <div style="font-size:11px; color:var(--muted); line-height:1.4;">
        主循环非阻塞轮询每圈正常喂狗；若连续阻塞擦除累积超时将引发单片机硬件复位。
      </div>
    </div>
  </div>

  <!-- Page Chunking Visualizer -->
  <div class="w25q-chunk-box">
    <div class="w25q-chunk-title">
      📄 跨页 256 字节边界自动拆分器 (以 500 字节写入地址 0x0010E0 为例)
    </div>
    <div class="w25q-chunk-track">
      <div id="w25q-seg-0" class="w25q-chunk-segment" style="flex:32;">Page 0: 32B (0x10E0..0x10FF)</div>
      <div id="w25q-seg-1" class="w25q-chunk-segment" style="flex:256;">Page 1: 满页 256B (0x1100..0x11FF)</div>
      <div id="w25q-seg-2" class="w25q-chunk-segment" style="flex:212;">Page 2: 剩余 212B (0x1200..0x12D3)</div>
    </div>
    <div style="font-size:11px; color:var(--muted); margin-top:4px;">
      单次 0x02 页编程若跨越 256 字节页尾会发生硬件回绕覆盖页首。驱动自动在页边界处拆分为多笔事务。
    </div>
  </div>

  <!-- Actions and Log -->
  <div class="w25q-actions-grid">
    <div class="w25q-ctrl-card">
      <div class="w25q-ctrl-title">发起 Flash 硬件操作</div>
      <div class="w25q-btn-row">
        <button class="ecat-btn" id="w25q-btn-erase" style="background:var(--accent); color:#fff; border-color:var(--accent);">
          🧹 4 KiB 扇区擦除 (~88 ms)
        </button>
        <button class="ecat-btn" id="w25q-btn-prog">
          ✏️ 256 B 页编程 (~0.8 ms)
        </button>
        <button class="ecat-btn" id="w25q-btn-multipage">
          📑 跨页 500 字节写入 (自动拆包)
        </button>
      </div>
      <div style="font-size:12px; color:var(--muted); margin-top:4px; line-height:1.5;">
        切换不同工作模式后点击上方操作按钮，对比观察左侧主循环耗时抖动与 AD7190 环形队列水位变化。
      </div>
    </div>

    <div class="w25q-ctrl-card">
      <div class="w25q-ctrl-title">驱动状态机与 SPI 事件日志</div>
      <div id="w25q-log" style="flex:1; min-height:110px; max-height:140px; overflow-y:auto; background:#1e1e1e; border-radius:6px; padding:8px 10px; font-family:ui-monospace, Consolas, monospace; font-size:11px; line-height:1.5;"></div>
    </div>
  </div>
</div>

## 最小探测与读写自检示例

```c
#include "drv_w25q128.h"

/* 1. 启动阶段探测 JEDEC ID */
static w25q128_status_t Flash_Probe(void)
{
    uint32_t jedecId = 0U;
    w25q128_status_t status;

    status = W25q128_Init();
    if (status != W25Q128_STATUS_OK)
    {
        return status;
    }

    status = W25q128_ReadJedecId(&jedecId);
    if (status != W25Q128_STATUS_OK)
    {
        return status;
    }

    return (jedecId == W25Q128_JEDEC_ID) ? W25Q128_STATUS_OK
                                         : W25Q128_STATUS_ID_MISMATCH;
}

/* 2. 主循环中推进非阻塞扇区擦除 */
static void Flash_NonBlockingEraseExample(uint32_t sectorAddr)
{
    bool completed = false;

    if (!W25q128_IsOperationActive())
    {
        (void)W25q128_SectorEraseStart(sectorAddr);
        return;
    }

    if (W25q128_PollOperation(&completed) == W25Q128_STATUS_OK && completed)
    {
        /* 扇区擦除已在后台完成，可安全发起后续页编程或读取 */
    }
}
```

## 常见故障排查表

| 故障现象 | 优先排查项 |
| --- | --- |
| 没有 `SCLK` 波形 | `SPI3` 与 `AFIO` 时钟是否使能、`GPIO_RMP3_SPI3` 重映射是否生效、`SPI_Enable` 是否调用 |
| `MISO` 恒为 `0xFF` 或 `0x00` | `PA2 (/CS)` 极性、芯片 3.3 V 供电、`PA0` 是否配为浮空输入、芯片是否处于 Power-down |
| `JEDEC ID` 不是 `0xEF4018` | 核对实装芯片丝印、检查 MOSI/MISO 是否接反、是否在读完 3 字节前提前拉高了 `/CS` |
| `WEL` 无法置位 | 检查硬件 `/WP` 引脚电平、读取 SR1/SR2/SR3 核查块保护位、`0x06` 后是否正常拉高 `/CS` |
| 写入后读回仍是 `0xFF` | 确认是否真正发出了 `0x02`、写入期间是否等待 `BUSY` 清零 |
| 写后部分 bit 无法从 `0` 变 `1` | 违反 NOR Flash 先擦后写规则，写入前目标区域不是 `0xFF` |
| 写后页首数据被意外改写 | 单次 `0x02` 页编程跨越了 256 字节页边界，触发页内地址回绕 |
