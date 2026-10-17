---
layout: skill
title: AD7190 DOUT/RDY 复用中断 + SPI DMA 连续采集与自愈 (ad7190-exti-spi-dma-acquisition)
skill_id: ad7190-exti-spi-dma-acquisition
description: AD7190 等 24-bit Σ-Δ 高精度 ADC 的 DOUT/RDY 引脚 EXTI+SPI MISO 双模无竞态切换、SPI DMA 连续采样、256 槽无锁环形队列与 40-bit 自动软复位自愈。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: vendor
target: ADI AD7190/AD7192 + N32G455/STM32 Cortex-M
order: 10
tags:
  - AD7190
  - SPI-DMA
  - EXTI
  - 故障自愈
related_article: n32g455-spi-dma-guide
related_demo: /projects/n32g455-tensile/
---

## SKILL.md 元数据

```yaml
---
name: ad7190-exti-spi-dma-acquisition
description: >-
  [Scope: vendor] AD7190 等 24-bit Σ-Δ 高精度 ADC 的 DOUT/RDY 引脚 EXTI+SPI MISO 双模复用、SPI DMA 连续采样、无锁环形队列与 40-bit 自动软复位自愈。
  当用户需要在 N32G455/STM32 等 MCU 上驱动 AD7190/AD7192/ADS1256、处理 DOUT/RDY 共脚中断竞态、或排查高采样率下 SPI DMA 超时与总线死锁时使用此技能。
---
```

## 1. 适用范围与背景 (Metadata)

- **技术方向**：`mcu-baremetal`
- **使用范围 (Scope)**：`vendor`（适用于 ADI AD7190/AD7192/AD779x 系列 + N32G455/STM32 Cortex-M MCU）
- **典型硬件配置**：SPI Mode 3（`CPOL=1, CPHA=1`），软件片选 `CS`；`DOUT/RDY` 共用同一引脚（同时接 SPI `MISO` 与 `EXTI` 下降沿中断）；SPI RX/TX 绑定双通道 DMA（高抢占优先级，如优先级 1）。

## 2. 核心硬件痛点与解决架构

1. **`DOUT/RDY` 引脚双模复用竞态控制**：
   - AD7190 在 Continuous Read（`0x5C`）模式下，转换完成时将 `DOUT/RDY` 拉低作为就绪中断信号；一旦主机发送 SCLK，该脚立即切换为 `SPI MISO` 输出 24-bit 数据 + 8-bit 状态字节（共 4 字节）。
   - **铁律**：在 `SPI MISO` 输出数据比特流期间，引脚会产生大量高低电平跳变，**若不关闭 EXTI，会引发灾难性的中断风暴与重入**！
   - **标准状态流**：
     - **等待就绪态**：`CS` 保持低电平，开启 `EXTI` 下降沿中断，`dma_busy = 0`。
     - **`EXTI` 触发 ISR**：确认 `DOUT/RDY` 为低电平且 `dma_busy == 0` → **立即在 ISR 中屏蔽本通道 `EXTI` 中断并清挂起位** → 启动 4 字节 SPI RX/TX DMA（TX 发送 `0x00` 产生 32 个时钟）。
     - **DMA RX 完成 ISR**：停用 SPI DMA 请求，拼装 24-bit 样本与 8-bit 状态字节压入 `256` 槽无锁环形队列 → 清除传输期间残留的 `EXTI` 挂起标志 → **重新使能 `EXTI` 下降沿中断**等待下一帧。
2. **5 ms DMA 超时监控与 40-bit 连续高电平自动恢复**：
   - 工业现场静电（ESD）或电源毛刺可能导致 AD7190 串行接口失步或 DMA 半途卡死。
   - 主循环 `ad7190_service()` 每轮检查：若 `dma_busy` 持续超过 `5 ms` 或发生 `DMA_ERR`，立即触发自愈序列：
     1. 屏蔽 `EXTI`，停止 SPI RX/TX DMA 并拉高 `CS`；
     2. 轮询发送 **至少 5~6 字节 `0xFF`（≥ 40 个连续高电平 SCLK）** 软复位 AD7190 串行接口；
     3. 等待 `1 ms` 后读取并校验 `ID` 寄存器（`chip_id & 0x0FU == 0x04U`）；
     4. 重新写入缓存的 `GPOCON`、`CONF`、`MODE` 寄存器，重新发送 `0x5C` 进入连续读并恢复 `EXTI`。
3. **共享中断向量 (`EXTI15_10_IRQn`) 与低优先级 DMA 隔离**：
   - 若 `EXTI14`（AD7190）与 `EXTI11`（如 LTC4150 电量计）共用 `EXTI15_10_IRQn`，中断优先级只能在板级 `NVIC_Configuration()` 统一配置一次，驱动内只改写 `EXTI->IMASK` 位，绝不重配 NVIC 或误清兄弟通道标志。
   - AD7190 DMA（如 DMA1 CH4/CH5，抢占优先级 1）必须高于刷屏等大块慢速 DMA（如 LCD SPI1 DMA，抢占优先级 3）。

> 寄存器位域定义、2402 Hz 采样率计算与恢复时序详见 [references/ad7190-register-and-timing.md](#ref-ad7190-timing)。

## 3. 核心执行流程 (Step-by-Step Workflow)

1. **分阶段上电初始化（防启动期队列溢出）**：
   - 在 `main()` 前半段调用 `AppAd7190_Init()`：仅完成 GPIO/SPI2/DMA 初始化、40-bit 软复位、ID 校验与寄存器写入，**暂不开启连续读取**。
   - 等 LCD 初始化、Flash 扫描等所有长耗时阻塞初始化全部结束后，在进入 `while(1)` 与启动 `IWDG` 前一刻再调用 `AppAd7190_Start()`，避免初始化阻塞期间样本塞满环形队列导致 `overrun`。
2. **主循环排空与去皮/标定解算 (`AppAd7190_Process`)**：
   - 主循环每次调用 `ad7190_service()`（处理超时恢复），随后循环调用 `ad7190_pop_sample()` 排空环形队列。
   - 检查样本 `status` 字节：丢弃 `ERR` 或 `NOREF` 置位的异常帧，校验通道号 `status & 0x07U` 与预期一致。
3. **暴露六大可观测健康计数器**：
   - 驱动内置 `rdy_irq_count`、`dma_complete_count`、`dma_error_count`、`dma_timeout_count`、`recovery_count`、`overrun_count`，接入 RTT `stat` 命令实时监控。

## 4. 关键安全与并发约束检查清单

- [ ] **重使能 EXTI 前先清 Pending**：DMA 传输 4 字节期间 MISO 脚翻转必然再次置位 `EXTI->PEND`；DMA 完成 ISR 中必须**先 `EXTI_ClrITPendBit()`，再置位 `EXTI->IMASK`**，否则会立即误触发一次伪造的 RDY 中断！
- [ ] **退出连续读模式约束**：要把 AD7190 从 `CREAD (0x5C)` 切回寄存器读写模式，必须在 `DOUT/RDY` 变低后发送 `0x58`（`READ_DATA_NOCREAD`），或直接发送 ≥ 40 个 `1` 软复位。
- [ ] **恢复期采样空窗容忍**：一次自动软复位约产生 `11 ms` 采样空窗，上层滤波和峰值捕捉算法不得假定样本严格等间隔到达。

## 5. 验证与调试方法 (Verification)

1. **RTT 计数器稳态判据**：
   - 芯片在线 `ad7190_is_online() == 1`；稳态运行下 `rdy_irq_count` 与 `dma_complete_count` 按标称 ODR（如 `2402 Hz`）同步增长，差值恒为 `0` 或 `1`；`error / timeout / recovery / overrun` 保持 `0`。
2. **故障自愈注入测试**：
   - 用杜邦线短暂触碰扰动 `SCLK` 或在调试器中单次挂起 DMA，观察 `timeout_count` 与 `recovery_count` 各加 `1`，且 `15 ms` 内采样自动恢复正常。

<h2 id="ref-ad7190-timing">参考文档：AD7190 寄存器配置、2402 Hz 时序与 EXTI+DMA 状态切换 (references/ad7190-register-and-timing.md)</h2>

### 1. 常用寄存器地址与输出数据率 (ODR) 计算

AD7190 内部标称时钟 `f_CLK = 4.92 MHz`。当 `CHOP = 0`（斩波关闭）时，输出数据率公式为：

```text
f_ODR = 4.92 MHz / (1024 × FS)
```

| `FS` 配置值 (`MODE[9:0]`) | 标称输出数据率 (`f_ODR`) | 单帧间隔 | 典型应用场景 |
| :---: | :---: | :---: | :--- |
| `2` | **2402.3 Hz** | `416 μs` | 高速破断/按键瞬态力值峰值捕捉（数显拉力计默认） |
| `4` | **1201.2 Hz** | `832 μs` | 中高速动态拉压测试 |
| `5` | **960.9 Hz** | `1.04 ms` | 接近 1 kHz 标准采样 |

核心寄存器配置组合（惠斯通电桥传感器推荐基线）：

- **`GPOCON` (`0x28`, 8-bit)**：`AD7190_GPOCON_BPDSW (1 << 6)` —— 闭合桥路电源低端开关。
- **`CONF` (`0x10`, 24-bit)**：
  - 差分通道：`AD7190_CH_AIN3_AIN4`
  - 增益：`AD7190_GAIN_128 (0x07)`（匹配 `2.0 mV/V` 传感器）
  - 极性与缓冲：`UNIPOLAR = 0`（双极性偏移二进制码，`0x800000` 为零点）、`BUF = 1`（开启输入缓冲）、`REFSEL = 0`（`REFIN1`）
- **`MODE` (`0x08`, 24-bit)**：
  - `MODE_SEL = 0`（连续转换）、`DAT_STA = 1`（24-bit 数据后附带 8-bit `STAT` 寄存器）、`CLKSRC = 2`（内部时钟）、`SINC3 = 0`（使用 Sinc4 滤波器）、`FS = 2`。

### 2. `DOUT/RDY` 引脚在 EXTI 与 SPI DMA 间的精确切换时序

```text
[空闲等待：CS = Low, EXTI14 Enabled, DMA Idle]
      │
      ▼  AD7190 转换完成，PB14 (DOUT/RDY) 下降沿
[EXTI14 ISR (Prio 1)]
  1. 确认 PB14 == Low 且 s_dma_busy == 0
  2. 立即关闭 EXTI14 IMASK 并清除 PEND（防 MISO 翻转风暴）
  3. 启动 4 字节 SPI2 RX/TX DMA（TX 发 0x00 产生 32 个 SCLK，4 MHz 耗时约 8 μs）
      │
      ▼  DMA1 CH4 RX 完成中断
[DMA1_CH4 ISR (Prio 1)]
  4. 关闭 SPI2 DMA 请求与通道
  5. 拼装 raw(24-bit) + status(8-bit) 压入 256 槽无锁 RingBuffer
  6. 先清除传输期产生的 EXTI14 PEND，再重新开启 EXTI14 IMASK
```

### 3. 中断内防重入与防伪触发代码范式

```c
/* 1. EXTI14 ISR：触发采样 */
void ad7190_rdy_irq_handler(void)
{
    if (EXTI_GetITStatus(EXTI_LINE14) == RESET)
    {
        return;
    }
    EXTI_ClrITPendBit(EXTI_LINE14);

    if ((s_continuous_active == 0U) || (s_dma_busy != 0U))
    {
        return;
    }
    /* 确认引脚当前确实处于低电平就绪态 */
    if (GPIO_ReadInputDataBit(GPIOB, GPIO_PIN_14) != Bit_RESET)
    {
        return;
    }

    s_rdy_irq_count++;
    /* 关键：启动 SPI 时钟前先屏蔽 EXTI，防止 MISO 数据位翻转触发中断风暴 */
    EXTI->IMASK &= ~EXTI_LINE14;
    EXTI_ClrITPendBit(EXTI_LINE14);

    s_dma_start_tick = PlatformTime_GetMs();
    (void)ad7190_spi_dma_start(NULL, s_rx_dma_buf, 4U, 0x00U, 1U);
}

/* 2. DMA1 CH4 RX 完成 ISR：入队并恢复 EXTI */
void ad7190_dma_rx_irq_handler(void)
{
    if (DMA_GetIntStatus(DMA1_INT_TXC4, DMA1) != RESET)
    {
        ad7190_spi_dma_stop();
        s_dma_complete_count++;

        /* 拼装 24-bit 样本 + 1B Status 并压入无锁 RingBuffer */
        ad7190_push_frame(s_rx_dma_buf);

        /* 关键：先清除 MISO 翻转遗留的 EXTI 挂起位，再重新打开 EXTI 掩码 */
        if (s_continuous_active != 0U)
        {
            EXTI_ClrITPendBit(EXTI_LINE14);
            EXTI->IMASK |= EXTI_LINE14;
        }
    }
}
```
