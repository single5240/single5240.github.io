---
layout: article
title: ST7789 命令时序、窗口配置与像素 DMA 传输参考
description: 面向 MCU 驱动移植的 ST7789 4 线 SPI 控制协议参考，涵盖命令表、RS/CS 事务边界、上电序列、8/16 位切换与阻塞/异步像素 DMA 实现。
date: 2026-10-07
category: 嵌入式
tags:
  - ST7789
  - N32G455
  - SPI
  - DMA
  - 驱动移植
---

移植 ST7789 驱动时，需要先核对命令、RS/CS 时序和显示窗口，再接入像素 DMA。下面按这个顺序整理接口与传输流程。上层 UI 条带裁剪与帧快照机制见 [N32G455 LCD 条带渲染与异步刷新实现分析]({{ '/articles/n32g455-lcd-strip-rendering.html' | relative_url }})，花屏与反色问题见 [嵌入式 RGB565 LCD 颜色反转、字节错序与花屏排查指南]({{ '/articles/lcd-rgb565-color-troubleshooting.html' | relative_url }})。

## 可迁移边界与最小驱动接口

将本驱动迁移到新板卡或同系列 MCU 时，各部分的复用边界如下：

| 可直接带走 | 必须按新板重绑 | 不要一起带走 |
| --- | --- | --- |
| 命令码、参数格式、初始化顺序与延时 | GPIO / SPI / DMA 通道 / 时钟分频 | `AppUiContext`、条带画布、字库 |
| `RS` / `CS` / `RST` 事务规则 | NVIC 与 `DmaRxIrqHandler` 中断入口 | 业务页面布局 |
| `CASET` / `RASET` / `RAMWR` 窗口写 GRAM | 背光有效极性与调光定时器 | AD7190 的采样 DMA 通道 |
| 命令 8 bit、像素 16 bit RGB565 切换 | 由实际 `PCLK` 与分频算出的 `SCK` | Mem2Mem DMA 模式 |
| TX DMA 发像素 + RX DMA 丢弃全双工回读 | 与高优先级采样 DMA 的抢占关系 | |
| DMA 完成后再等 `SPI BUSY = 0` 才拉高 `CS` | | |

新工程建议保留以下最小驱动接口语义：

```c
bool LcdXxx_Init(void);
void LcdXxx_Process(void);          /* 主循环推进异步收尾 */
bool LcdXxx_IsBusy(void);
bool LcdXxx_DrawPixelsAsync(uint16_t x, uint16_t y,
                            uint16_t w, uint16_t h,
                            const uint16_t *pixels);
void LcdXxx_DmaRxIrqHandler(void);
void LcdXxx_BacklightOn(void);
bool LcdXxx_SetOrientation(uint8_t orientation); /* 可选 */
void LcdXxx_FillRect(uint16_t x, uint16_t y,
                     uint16_t w, uint16_t h,
                     uint16_t color);            /* 可选，阻塞填色/产测 */
```

## 电气接口与安全初始化电平

当前数显式拉力计 HW1.4 使用 N32G455 SPI1 默认引脚连接 240×320 LCD：

| 信号 | 本板 MCU | 作用 | 有效电平与约束 |
| --- | --- | --- | --- |
| `SCL` | PA5 | SPI1 SCK | Mode 0：空闲低电平 |
| `SDA` | PA7 | SPI1 MOSI，命令/参数/像素 | MSB first |
| `DOUT` | PA6 | SPI1 MISO，读 ID | 写 GRAM 时回读数据无业务含义 |
| `RS`（D/C） | PC4 | 命令/数据选择 | `0` = 命令，`1` = 参数或像素 |
| `CS` | PC5 | 片选 | 低有效，软件 GPIO 控制（`SPI_NSS_SOFT`） |
| `RST` | PB0 | 硬件复位 | 低有效 |
| `BL` | PC2 | 背光控制 | 本板高电平点亮 |

GPIO 初始化必须**先写安全输出电平，再切换为推挽输出模式**：

- `CS = 1`：避免上电瞬间误选中屏幕；
- `RS = 1`：默认处于数据态；
- `RST = 0`：保持复位态；
- `BL = 0`：保持背光关闭，避免 GRAM 未初始化时闪出随机花屏；
- `SCK = 0`：匹配 Mode 0 空闲低电平。

`CS` 必须由软件控制，因为一次完整刷屏要经历“多段短命令事务 + 一段长像素流事务”，不能交给硬件 NSS 自动翻转。

## 命令阶段 SPI 配置与命令表

### 命令阶段 SPI 参数

| 配置项 | 当前值 | 移植处理原则 |
| --- | --- | --- |
| 主从与方向 | Master，双线全双工 | 保持；即使只写屏幕也必须排空 RX |
| 命令位宽 | 8 bit | 命令码和单字节参数一律使用 8 bit |
| CPOL / CPHA | Low / First edge | SPI Mode 0 |
| 位序 | MSB first | 保持 |
| 本板 SCK | `PCLK2 / 2 = 64 MHz / 2 = 32 MHz` | 按新板总线时钟重算；超过屏模组上限则加大分频 |
| CRC | 关闭 | 保持关闭 |

### 驱动实际使用的命令表

| 命令 | 命令码 | 参数 | 作用 |
| --- | ---: | --- | --- |
| `SWRESET` | `0x01` | 无 | 软件复位；发送后等待 ≥ 150 ms |
| `RDDID` | `0x04` | 读：1 字节 dummy + 3 字节 ID | 探测总线与控制器应答 |
| `SLPOUT` | `0x11` | 无 | 退出休眠；发送后等待 ≥ 120 ms |
| `NORON` | `0x13` | 无 | 进入普通显示模式 |
| `INVON` | `0x21` | 无 | 开启显示反相（本屏实测需 `INVON` 才显示正确颜色） |
| `DISPON` | `0x29` | 无 | 打开显示输出（不等于打开物理背光） |
| `CASET` | `0x2A` | 4 字节：`x0H x0L x1H x1L` | 设置列地址窗口（含首尾端点） |
| `RASET` | `0x2B` | 4 字节：`y0H y0L y1H y1L` | 设置行地址窗口（含首尾端点） |
| `RAMWR` | `0x2C` | 随后为 RGB565 像素流 | 开始向 GRAM 连续写像素 |
| `MADCTL` | `0x36` | 1 字节扫描与颜色序 | 正向 `0x00`，180° 反向 `0xC0`（`MY | MX`） |
| `COLMOD` | `0x3A` | `0x55` | 选择 16 bit/pixel（RGB565） |

当 `COLMOD = 0x55` 时，MCU 侧一个像素对应 `uint16_t` RGB565（高 5 位红、中 6 位绿、低 5 位蓝）。若纯色测试中红、绿、蓝变成青、黄、紫，应优先检查 `INVON (0x21)` / `INVOFF (0x20)` 及 `MADCTL` 的 RGB/BGR 位，不要盲目修改 DMA 字节序。

## 单条命令与上电初始化流程

### 命令与参数轮询事务

命令阶段全程采用 8 bit CPU 轮询，不使用 DMA：

```text
写命令 WriteCommand(cmd):
  RS = 0
  CS = 0
  等待 TXE → 写 SPI->DAT → 等待 RXNE → 读走 SPI->DAT（丢弃）
  等待 SPI BUSY = 0
  CS = 1

写单字节参数 WriteData(data):
  RS = 1
  CS = 0
  等待 TXE → 写 SPI->DAT → 等待 RXNE → 读走 SPI->DAT（丢弃）
  等待 SPI BUSY = 0
  CS = 1
```

无论命令还是像素，**在 `SPI BUSY` 清零之前绝不能拉高 `CS`**，否则移位寄存器中的最后一位可能被截断。

### 读 ID（RDDID）事务

在同一个 `CS = 0` 周期内完成：

```text
RS = 0, CS = 0
发送 0x04，读走 1 个同步字节
RS = 1
连续发送 4 次 0x00：第 1 次对应 dummy，后 3 次依次读回 ID1、ID2、ID3
等待 SPI BUSY = 0
CS = 1
```

### 上电初始化序列

初始化总耗时约 430 ms 以上，必须放在独立看门狗（IWDG）启动之前：

```text
1. 配置 GPIO / SPI1 / DMA1 / NVIC，保持背光关闭 (BL = 0)
2. RST = 0 保持 ≥ 20 ms
3. RST = 1 等待 ≥ 120 ms
4. 发送 SWRESET (0x01)，等待 ≥ 150 ms
5. 发送 SLPOUT  (0x11)，等待 ≥ 120 ms
6. 发送 RDDID   (0x04)，读取 3 字节 ID
7. 发送 COLMOD  (0x3A)，参数 0x55 (RGB565)
8. 发送 MADCTL  (0x36)，参数 0x00 (正向扫描)
9. 发送 INVON   (0x21)
10. 发送 NORON  (0x13)
11. 发送 DISPON (0x29)，等待 ≥ 20 ms
12. 保持背光关闭，待首帧全部条带像素写入 GRAM 后再调用 BacklightOn()
```

## 窗口设置与两条像素传输路径

### 窗口命令流程

向 GRAM 写入任何像素前，先指定目标矩形 `[x0..x1, y0..y1]`（坐标含两端端点，例如 `240×8` 条带为 `x0=0, x1=239, y0=n, y1=n+7`）：

```text
CASET (0x2A) + x0H, x0L, x1H, x1L   // 8-bit 轮询
RASET (0x2B) + y0H, y0L, y1H, y1L   // 8-bit 轮询
RAMWR (0x2C)                        // 8-bit 轮询
RS = 1, CS = 0（保持低电平）
SPI1 切换为 16-bit HalfWord 模式
DMA 连续发送 width × height 个 uint16_t 像素
等待 RX DMA 完成 且 SPI BUSY = 0
CS = 1
SPI1 恢复为 8-bit 模式
```

若新模组内部 GRAM 大于可视区域（如 240×240 模组复用 240×320 GRAM），需按屏幕规格书在 `CASET/RASET` 中加上 `colstart/rowstart` 偏移。

### 路径一：阻塞填色（`Fill` / `FillRect`）

适用于开机产测色块或初始化清屏：

- 数据源为单个 `uint16_t color` 变量，TX DMA **内存地址不递增**，反复发送同一半字；
- RX DMA 写入局部变量 `rxDiscard`，内存地址不递增；
- 像素总数超过 65,535（如全屏 `240×320 = 76,800`）时，自动按 65,535 像素拆分为多次 DMA 传输；
- CPU 原地等待每次 DMA 与 `SPI BUSY` 结束后再返回。**运行期主循环禁止使用该阻塞路径**，以免阻塞传感器采样和看门狗喂狗。

### 路径二：异步矩形像素传输（`DrawPixelsAsync`）

适用于运行期 UI 条带刷屏：

- 前置条件：异步状态机处于 `IDLE`、`pixels != NULL`、矩形位于 `240×320` 内且 `width × height <= 65535`（8 行条带为 1,920 像素）；
- 完成 `SetWindow` 与 `RAMWR` 后，拉高 `RS`、拉低 `CS` 并切到 16 bit 模式；
- 配置 RX DMA（CH1，内存不递增，写入静态变量 `lcdAsyncRxDiscard`）和 TX DMA（CH2，**内存递增**，指向 `pixels`）；
- 状态切为 `TRANSFER`，开启 RX DMA 完成/错误中断，**先使能 RX DMA、后使能 TX DMA**；
- 函数立即返回 `true`；在 `LcdSt7789_IsBusy()` 回到 `false` 前，调用方严禁修改 `pixels` 缓冲区。

## DMA 寄存器级配置与异步收尾状态机

### DMA1 通道参数对照

| 字段 | RX 通道（DMA1_CH1） | TX 通道（DMA1_CH2） |
| --- | --- | --- |
| `PeriphAddr` | `&SPI1->DAT` | `&SPI1->DAT` |
| `MemAddr` | 静态 `&lcdAsyncRxDiscard` | 像素缓冲区 `pixels` |
| `Direction` | `DMA_DIR_PERIPH_SRC`（外设→内存） | `DMA_DIR_PERIPH_DST`（内存→外设） |
| `BufSize` | 像素个数（HalfWord 项数，非字节数） | 像素个数（HalfWord 项数，非字节数） |
| `PeriphInc` | 关闭 | 关闭 |
| `MemoryInc` | 关闭 | 异步像素开启；阻塞填色关闭 |
| `DataSize` | HalfWord / HalfWord | HalfWord / HalfWord |
| `Mode` / `M2M` | Normal / 关闭 `M2M` | Normal / 关闭 `M2M` |
| `Priority` | Medium（低于 AD7190 采样 DMA） | Medium |
| 请求重映射 | `DMA1_REMAP_SPI1_RX` | `DMA1_REMAP_SPI1_TX` |
| 中断 | 开启传输完成（TC）与错误（TE） | 关闭（以 RX 完成作为全双工基准） |

### 异步状态机与主循环职责

```text
IDLE
  ├─ DrawPixelsAsync() 启动 DMA ────────────► TRANSFER
TRANSFER
  ├─ RX DMA 完成中断置位 dmaDone ───────────► WAIT_SPI
  └─ RX DMA 错误或 200 ms 超时 ─────────────► AsyncFinish(false) ──► IDLE
WAIT_SPI
  ├─ 主循环检测到 SPI BUSY == 0 ────────────► AsyncFinish(true)  ──► IDLE
  └─ 200 ms 超时 ───────────────────────────► AsyncFinish(false) ──► IDLE
```

- **ISR 职责边界**：`LcdSt7789_DmaRxIrqHandler()` 只允许置位 `dmaDone` / `dmaError` 并清除本通道中断标志，严禁在中断内等待 `BUSY`、切位宽、拉高 `CS` 或打印日志。
- **主循环职责**：`LcdSt7789_Process()` 应放在主循环中 UI 提交新条带之前调用。`AsyncFinish()` 依次执行：关闭 RX DMA 中断 → 关闭 SPI DMA 请求并停止 CH1/CH2 → 拉高 `CS` → SPI 恢复 8 bit → 状态切回 `IDLE`。

## 移植检查清单

- [ ] **引脚与极性**：核对原理图引脚、`RST`/`CS`/`RS`/`BL` 有效电平，GPIO 初始化先写安全电平再切输出模式。
- [ ] **时钟与位宽**：按实际 `PCLK` 计算 `SCK` 不超屏模组上限；命令 8 bit 与像素 16 bit 切换成对出现，异常退出路径同样恢复 8 bit。
- [ ] **协议与窗口**：初始化延时不短于规格书且不触发看门狗；`CASET`/`RASET` 包含首尾端点，必要时加上面板偏移；像素阶段 `CS` 保持低电平直到 `SPI BUSY = 0`。
- [ ] **DMA 与并发**：关闭 `Mem2Mem`；先使能 RX DMA 后使能 TX DMA；`IsBusy()` 为真时严禁覆盖源像素缓冲或混用阻塞接口；中断优先级低于硬实时采样通道。
- [ ] **上板验证**：完成红、绿、蓝、白、黑纯色与 1 像素边框测试；逻辑分析仪确认命令期 `RS=0`、像素期 `RS=1` 且 `CS` 覆盖完整像素段；与高优先级采样长时间并行无 200 ms 超时。
