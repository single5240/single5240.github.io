---
layout: article
title: N32G455 SPI 与 DMA 配置参考
description: 基于 QW-603 HW1.4 当前固件的 SPI、DMA、EXTI 与中断配置整理，涵盖 LCD、AD7190、W25Q128 的资源分配、调用流程与联调检查项。
date: 2026-09-26
category: 嵌入式
tags:
  - N32G455
  - SPI
  - DMA
  - AD7190
  - ST7789
---

> 本文记录 QW-603 HW1.4 当前固件中的实际源码配置，用于配置核对、接口调用、联调和后续扩展。它不是板级验证结论：引脚连接以《引脚与外设接口说明.md》为准；LCD 控制器、SPI 时序上限和 AD7190 最终采样参数仍需结合器件资料与实测确认。

## 资源概览

### 相关代码

| 功能 | 文件 | 主要职责 |
| --- | --- | --- |
| 系统时钟 | `USER/src/n32g45x_cfg.c` | 配置 HCLK、PCLK1、PCLK2 和 1 ms SysTick |
| 中断入口 | `USER/src/n32g45x_it.c` | 转发 EXTI15_10、DMA1_CH1、DMA1_CH4 中断 |
| AD7190 驱动 | `DRV/drv_ad7190.c/.h` | SPI2、DMA1_CH4/CH5、EXTI14、连续采样队列 |
| LCD 驱动 | `DRV/drv_lcd_st7789.c/.h` | SPI1、DMA1_CH1/CH2、轮询命令和异步像素传输 |
| W25Q128 驱动 | `DRV/drv_w25q128.c/.h` | SPI3 轮询读写、页编程和扇区擦除 |
| AD7190 应用 | `APP/app_ad7190.c/.h` | 初始化、持续取样、去皮和力值换算 |
| LCD 应用 | `APP/app_ui_home.c` | 以 8 行条带生成并提交像素缓冲 |
| 程序入口 | `USER/src/main.c` | 初始化顺序和主循环调度 |

### 时钟树与 SPI 时钟

系统运行于 HSI-PLL 128 MHz。SPI 串行时钟按 `SCLK = 所属 PCLK / SPI 分频系数` 计算；修改 HCLK 或 APB 分频后，必须同步复核 SCLK、SysTick、Flash 等待周期和全部超时。

| 时钟 / 外设 | 总线或当前值 | 分频 | SCLK |
| --- | ---: | ---: | ---: |
| HCLK | 128 MHz | - | DMA1、CPU、存储器总线 |
| PCLK2 / SPI1（LCD） | 64 MHz | 2 | 32 MHz |
| PCLK1 / SPI2（AD7190） | 32 MHz | 8 | 4 MHz |
| PCLK1 / SPI3（W25Q128） | 32 MHz | 4 | 8 MHz |

不要用 Keil 工程元数据中的 `CLOCK(...)` 代替运行时钟计算。

### SPI 资源表

| 项目 | LCD | AD7190 | W25Q128 |
| --- | --- | --- | --- |
| SPI 实例 | SPI1 | SPI2 | SPI3 |
| 引脚 | PA5=SCK、PA6=MISO、PA7=MOSI | PB13=SCK、PB14=MISO/DOUT-RDY、PB15=MOSI | PC3=SCK、PA0=MISO、PA1=MOSI |
| 软件控制引脚 | PC5=CS、PC4=RS、PB0=RST | PB12=CS | PA2=CS |
| 引脚映射 | 默认映射 | 默认映射 | `GPIO_RMP3_SPI3` 重映射 |
| 模式 | Mode 0 | Mode 3 | Mode 0 |
| 默认字长 | 8 bit；像素 DMA 时临时为 16 bit | 8 bit | 8 bit |
| SCLK | 32 MHz | 4 MHz | 8 MHz |
| 传输方式 | 命令轮询；像素 DMA | 事务 DMA；连续采样 DMA 中断 | 全部轮询 |
| 初始化入口 | `LcdSt7789_Init()` | `AppAd7190_Init()` → `ad7190_init()` | `W25q128_Init()` |

三路 SPI 使用不同实例与引脚，可并行工作；但 LCD 和 AD7190 共用 DMA1，必须保持当前 DMA 通道分配与优先级关系。

## DMA 与中断

### DMA 映射

| 使用者 | 方向 | DMA 通道 | 请求重映射 | 数据宽度 | 内存递增 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| LCD SPI1 | RX | DMA1_CH1 | `DMA1_REMAP_SPI1_RX` | 16 bit | 禁止，写入丢弃变量 | Medium |
| LCD SPI1 | TX | DMA1_CH2 | `DMA1_REMAP_SPI1_TX` | 16 bit | 填充色禁止；像素缓冲使能 | Medium |
| AD7190 SPI2 | RX | DMA1_CH4 | `DMA1_REMAP_SPI_I2S2_RX` | 8 bit | 使能 | Very High |
| AD7190 SPI2 | TX | DMA1_CH5 | `DMA1_REMAP_SPI_I2S2_TX` | 8 bit | 使能 | High |

所有通道均为 Normal 模式、外设地址固定、非 Memory-to-Memory；W25Q128 不使用 DMA。SPI 是同步全双工接口，即使业务上只发送或只接收，也会同时产生 RX 数据和 TX 时钟：LCD 的 RX DMA 用于丢弃返回值，AD7190 的 TX DMA 发送 dummy byte 以产生时钟。

### NVIC 配置

| IRQ | 抢占优先级 | 来源 | 处理函数 |
| --- | ---: | --- | --- |
| `EXTI15_10_IRQn` | 1 | AD7190 PB14/DOUT-RDY，与 LTC4150 EXTI 共享 | `EXTI15_10_IRQHandler()` |
| `DMA1_Channel4_IRQn` | 1 | AD7190 SPI2 RX 完成/错误 | `DMA1_Channel4_IRQHandler()` |
| `DMA1_Channel1_IRQn` | 3 | LCD SPI1 RX 完成/错误 | `DMA1_Channel1_IRQHandler()` |

工程使用 `NVIC_PriorityGroup_4`，4 位都用于抢占优先级，副优先级没有有效位。因此 AD7190 的 EXTI 与 DMA 实际抢占级别相同，且均高于 LCD DMA。DMA1_CH2 与 DMA1_CH5 不启用独立 IRQ，完成判定以 RX 通道为主。

## 通用配置与传输规则

### SPI 初始化顺序

新增或修改 SPI 时按以下顺序进行：

1. 确认原理图引脚、IO 电平、器件供电和复用关系。
2. 根据实际 PCLK 与器件最大 SCLK 选择分频，并保留裕量。
3. 打开 AFIO、GPIO、SPI 和所需 DMA 时钟。
4. 先将软件 CS 写为非选中电平，再配置为推挽输出，避免误选中器件。
5. 配置 SCK/MOSI 为复用推挽、MISO 为输入；上下拉依电路决定。
6. 在 SPI 禁用时配置主从、字长、CPOL/CPHA、NSS、分频和位序。
7. 不使用硬件 CRC 时关闭 CRC 计算；现有驱动未启用 CRC。
8. 清理遗留 RX 数据和 OVR，关闭 SPI DMA 请求。
9. 配置 DMA、NVIC、EXTI，清除历史标志后再使能。
10. 最后使能 SPI。

同一个 SPI 实例必须只有一个所有者。运行中不可用通用初始化函数覆盖驱动设置的 CPOL、CPHA、字长、分频、DMA 请求或引脚映射。

### 全双工 DMA 流程

启动传输时应遵循以下顺序：

```text
确认上一笔传输结束
  → 关闭 SPI RX/TX DMA 请求
  → 禁用 RX、TX DMA 通道
  → 清全局/完成/错误标志并 DeInit 通道
  → 配置 RX DMA，再配置 TX DMA
  → 配置请求重映射和所需中断
  → 打开 SPI RX/TX DMA 请求
  → 先使能 RX DMA，再使能 TX DMA
```

必须先开 RX、后开 TX：TX 一启动便可能写入首项并产生时钟，RX 未就绪会丢失首项。DMA 通道使能后不能修改地址、方向或长度。`BufSize` 的单位是数据项：AD7190 使用 8 bit 项，等于字节数；LCD 像素使用 16 bit 项，等于像素数。

收尾时，RX TC 不代表最后一位已离开 SPI 移位寄存器。应确认 TC/TE 或超时、等待 `BUSY` 清零、关闭 SPI DMA 请求、禁用 DMA 与中断、清标志、恢复临时字长，最后才释放 CS。异常退出还需清 SPI OVR。

DMA 未结束前，发送缓冲区不得被修改或离开作用域，接收缓冲区不得被其他模块读写。N32G455 当前未使用数据缓存；迁移到带 D-Cache 的 MCU 时必须增加 cache clean/invalidate。

## AD7190：SPI2 + DMA 连续采样

### 初始化与默认参数

`AppAd7190_Init()` 依次初始化 GPIO、SPI2、DMA1、EXTI14/NVIC，复位 AD7190，校验 ID 低 4 位为 `0x4`，再调用 `ad7190_config_default()`、`ad7190_configure()` 与 `ad7190_start_continuous(NULL)`。

| 参数 | 当前值 |
| --- | --- |
| 转换模式 / 时钟源 | Continuous / AD7190 内部时钟 |
| FS | `AD7190_FS_1201HZ`，宏值 4 |
| 滤波 | Sinc4；Sinc3 关闭 |
| 数据帧 | 3 字节数据 + 1 字节状态 |
| 通道 / 增益 / 极性 | AIN3-AIN4 / 1 / 双极性 |
| 输入缓冲 / 基准 / BPDSW | 开启 / REFIN1 / 开启后等待 10 ms |
| 60 Hz 抑制、斩波 | 关闭 |

FS 宏名不等同于最终有效输出率；采样率还受时钟、滤波器、斩波和多通道配置影响。

### 连续采样时序

```text
发送 0x5C 进入 Continuous Read
  → CS 保持低，打开 PB14 EXTI14 下降沿
  → DOUT/RDY 下降沿触发 EXTI15_10_IRQHandler
  → 暂时关闭 EXTI14，避免数据位边沿误触发
  → CH5 发送 0x00 dummy，CH4 接收 3/4 字节帧
  → CH4 TC 中断解析帧并压入环形队列
  → 停止本次 DMA，重新打开 EXTI14
```

Continuous Read 期间 dummy 必须是 `0x00`；连续发送逻辑 1 可能触发串口复位。普通寄存器读取则使用 `0xFF`。PB14 同时承担 MISO 与 DOUT/RDY，DMA 期间必须关闭 EXTI14，完成并停止 SCLK 后再恢复。

驱动维护 256 项 `ad7190_sample_t` 环形数组，实际容量为 255 项：DMA ISR 是唯一生产者并只修改 `head`，主循环是唯一消费者并只修改 `tail`。队列满时丢弃最新帧、递增 `overrun_count`，并在发布/消费索引前使用 `__DMB()`。

正常应用只需在初始化阶段调用 `AppAd7190_Init()`，并在主循环持续调用 `AppAd7190_Process()`。重新配置寄存器前必须先调用 `ad7190_stop_continuous()`；连续模式下不应发起普通事务或单次读取。

诊断时关注：`ad7190_get_rdy_irq_count()` 与 `ad7190_get_dma_complete_count()` 应持续增长，`ad7190_get_dma_error_count()` 与 `ad7190_get_overrun_count()` 应保持为 0。

## LCD：SPI1 + DMA 像素传输

命令、单字节参数和 RDDID 使用 SPI1 8 bit CPU 轮询；RGB565 像素传输时 SPI1 临时切换到 16 bit，由 DMA1_CH2 发送，CH1 丢弃同步接收值。像素缓冲区元素为 `uint16_t`，改变字长、位序或像素格式后须用色块和逻辑分析仪重新核对字节序。

```c
bool LcdSt7789_DrawPixelsAsync(uint16_t x, uint16_t y,
                               uint16_t width, uint16_t height,
                               const uint16_t *pixels);
```

当 DMA 未完成、`pixels == NULL`、尺寸为零、区域超出 240×320，或 `width * height > 65535` 时，该函数返回 `false`。调用成功后，CS 保持低、SPI 保持 16 bit，直到传输真正结束；调用方必须保证 `pixels` 内容在 `LcdSt7789_IsBusy()` 返回 `false` 前持续有效且不被改写。

主循环每轮都应先调用 `LcdSt7789_Process()`，再由 UI 提交下一条带。当前 UI 使用 240×8 像素条带，每条带为 1920 像素/3840 字节。DMA ISR 只置完成/错误标志；主循环负责等待 `BUSY` 清零、关闭 DMA、释放 CS、恢复 8 bit，并以 200 ms 超时进行恢复。

`LcdSt7789_Fill()` 和 `LcdSt7789_FillRect()` 为同步 DMA 填充，发送地址始终指向同一 `uint16_t color`，超过 65535 像素会分块。异步传输期间不得调用同步填充、命令发送或重新初始化；上层必须保证互斥。

## W25Q128：SPI3 轮询传输

W25Q128 不使用 DMA 或中断。SPI3 按字节轮询 TE、RNE，并在事务结束前等待 `BUSY` 清零；全部事务由 PA2 软件 CS 包围。

```c
uint32_t jedecId;

if ((W25q128_Init() == W25Q128_STATUS_OK) &&
    (W25q128_ReadJedecId(&jedecId) == W25Q128_STATUS_OK))
{
    /* 期望 W25Q128_JEDEC_ID：0xEF4018。 */
}
```

`W25q128_ReadJedecId()` 只返回读取结果，不会自动比较器件 ID。`W25q128_Read()` 的地址和长度不能超过 16 MiB；`W25q128_Write()` 会按 256 字节页边界分块但不会自动擦除；`W25q128_SectorErase()` 要求 4 KiB 对齐。页编程与扇区擦除超时分别为 100 ms、1000 ms。

该驱动为阻塞式，长读写或擦除会影响 AD7190 队列消费、LCD Process 和约 1 s 的 IWDG 喂狗。大批量存储应改为分段调度，或设计明确的非阻塞状态机。

## 初始化、调度与风险

当前初始化顺序为：

```text
RCC_Configuration()
  → AppAd7190_Init()
  → W25q128_Init()
  → LcdSt7789_Init()
  → AppUi_Init()
  → Iwdg_Init()
```

主循环顺序为：

```c
LcdSt7789_Process();
AppUi_Process();
AppAd7190_Process();
Iwdg_Feed();
```

三个 `Process` 都不能长期缺席。新增阻塞操作前应评估最坏执行时间，保证 LCD 可在 200 ms 内完成收尾、AD7190 队列不溢出、IWDG 能在约 1 s 内喂狗。

当前实现中，LCD 的 32 MHz Mode 0 与 ST7789 初始化、AD7190 的 4 MHz Mode 3 和默认采样参数，都只是源码配置而非板级验证。AD7190 仅对 RX CH4 开中断，LCD 仅对 RX CH1 开中断；对应 TX 通道单独异常时，分别依赖上层处理或 200 ms 超时恢复。轮询循环计数的超时会受主频和编译优化影响，毫秒级恢复优先使用 `mwTick`。

## 故障排查与接入清单

| 现象 | 优先检查 |
| --- | --- |
| 没有 SCLK | SPI 时钟/使能、TX DMA 重映射和通道、轮询 TE |
| 有 SCLK，RX 为 `0xFF`/`0x00` | CS、电源、MISO 复用、电平、CPOL/CPHA、复位状态 |
| 首字节丢失或整体错位 | 是否先使能 RX、CS 建立时间、dummy byte 数 |
| RX DMA 不完成 | TX 是否产生时钟、RX/TX 长度、重映射、OVR、DMA 请求 |
| LCD 颜色错误或一直 Busy | RGB/BGR、RGB565 字节序、16 bit 模式、`LcdSt7789_Process()`、CH1 IRQ、`mwTick` |
| AD7190 无样本或完成数不增 | CS、PB14 EXTI、RDY、`0x5C`、CH4/CH5、`0x00` dummy、SPI2 模式 |
| AD7190 队列溢出 | 主循环阻塞时间、`AppAd7190_Process()` 调用频率、实际采样率 |
| W25Q128 写后不符 | 擦除、页边界、地址范围、WEL/BUSY、读回校验 |

新设备接入前，至少确认以下事项：

- [ ] 从原理图确认引脚、电平、上下拉、供电与安全初始状态。
- [ ] 从数据手册确认 CPOL/CPHA、位序、字长、最大 SCLK、CS 时序和 dummy 规则。
- [ ] 按实际 PCLK 计算 SCLK，并确认复用、DMA 通道、请求重映射与 IRQ 没有冲突。
- [ ] 为 RX/TX 配置一致的数据项数，先开 RX 后开 TX；核对缓冲区类型、对齐、长度单位和生命周期。
- [ ] 设计 TC、TE、SPI/器件 BUSY 和总事务超时的恢复路径；ISR 仅处理最小状态与数据投递。
- [ ] 用逻辑分析仪核对 CS/SCLK/MOSI/MISO 的模式、频率、帧长和边沿关系，并做长时间错误、丢帧、溢出与异常恢复测试。

完成板级验证时，应同时观察三路 SPI 信号；在 LCD 连续刷新下运行 AD7190；统计 RDY、DMA 完成、DMA 错误和 overrun；以色块/棋盘格验证 LCD；对 W25Q128 做跨页、边界、擦除和读回测试；并人为制造断线或超时，确认驱动可以退出 Busy、释放 CS 并恢复后续事务。
