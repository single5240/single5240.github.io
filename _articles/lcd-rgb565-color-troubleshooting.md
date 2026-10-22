---
layout: article
title: 嵌入式 RGB565 LCD 颜色反转、字节错序与花屏排查指南
description: 系统梳理 ST7789 等 RGB565 SPI 彩屏在开发与联调中常见的互补色反相、RGB/BGR 互换、高低字节错序、条带撕裂与 32 MHz 时序异常排查流程。
date: 2026-10-07
category: 嵌入式
tags:
  - LCD
  - ST7789
  - RGB565
  - 故障排查
  - DMA
---

数显式拉力计 HW1.4 的 240×320 SPI 彩屏曾出现颜色反转。排查时需要区分显示反相、RGB/BGR 互换、RGB565 字节错序、缓冲区竞争和 SPI 信号问题，避免看到颜色不对就修改字节序。驱动协议与条带渲染细节可配合阅读 [ST7789 命令时序、窗口配置与像素 DMA 传输参考]({{ '/articles/st7789-command-and-pixel-dma.html' | relative_url }}) 与 [N32G455 LCD 条带渲染与异步刷新实现分析]({{ '/articles/n32g455-lcd-strip-rendering.html' | relative_url }})。

## 真实案例：红蓝绿纯色显示为青黄紫

### 故障现象

上电执行 RGB565 纯色测试，依次发送红、蓝、绿三种纯色，但屏幕实际稳定显示为青、黄、紫：

| 目标颜色 | 发送 RGB565 值 | 屏幕实际显示 |
| --- | ---: | --- |
| 红（Red） | `0xF800` | 青（Cyan） |
| 蓝（Blue） | `0x001F` | 黄（Yellow） |
| 绿（Green） | `0x07E0` | 紫（Magenta） |

### 根本原因分析

初版驱动在 LCD 初始化序列中发送了 `INVOFF (0x20)`（关闭显示反相），但实测该常黑型（Normally Black）IPS 液晶面板模组需要发送 `INVON (0x21)`。

当面板反相配置相反时，送入 GRAM 的 RGB565 数值在光学显示上等价于 16 位按位取反（`~color`）后的互补色：

| 输入值 | 16 位按位取反值 | 取反后的颜色分解 | 视觉颜色 |
| ---: | ---: | --- | --- |
| `0xF800` | `0x07FF` | G 全满 + B 全满 | 青 |
| `0x001F` | `0xFFE0` | R 全满 + G 全满 | 黄 |
| `0x07E0` | `0xF81F` | R 全满 + B 全满 | 紫 |

该映射与实机现象 100% 吻合，从而直接排除 RGB/BGR 通道互换（绿色不会变紫）与高低字节错序（`0x07E0` 交换字节后为 `0xE007`，不会呈现纯正紫品红）。

### 修复方式

将 `DRV/drv_lcd_st7789.c` 初始化序列中的反相控制命令由 `INVOFF (0x20)` 改为 `INVON (0x21)`：

```diff
-#define LCD_CMD_INVOFF (0x20U)
+#define LCD_CMD_INVON  (0x21U)

-LcdSt7789_WriteCommand(LCD_CMD_INVOFF);
+LcdSt7789_WriteCommand(LCD_CMD_INVON);
```

重新编译烧录后，实机上电三色测试依次正常显示红、蓝、绿。

## 交互式在线排障实验室：RGB565 颜色反相、通道对调与字节错序仿真

遇到屏幕颜色异样时，常常难以直接断定是初始化命令发反、寄存器位域对调，还是字节序错误。下方提供了一个可交互的纯前端 RGB565 硬件色彩排障实验室。你可以选择不同的基准测试颜色，自由勾选开启或关闭各项硬件故障开关，实时对照**理论预期颜色**、**SPI 总线实际传输的两个字节**与**屏幕 GRAM 最终呈现的成像视觉**，并查看自动输出的诊断分析：

<div class="article-interactive-widget" id="rgb-demo-app" aria-label="RGB565 颜色排障交互实验室">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE LAB · 颜色故障仿真</span>
    <h3 class="aiw-title">RGB565 LCD 颜色反相、通道对调与字节错序交互实验室</h3>
    <p class="aiw-desc">仿真 ST7789 驱动关键配置：常黑反相控制（<code>INVON 0x21</code> / <code>INVOFF 0x20</code> 取反 <code>~color</code>）、<code>MADCTL</code> Bit 3（RGB/BGR 互换）与 SPI DMA 高低字节传输错位。</p>
  </div>
  <div class="aiw-body">
    <div>
      <div class="aiw-section-title">
        <span>1. 选择基准测试颜色 (Target Color Preset)</span>
        <span class="aiw-hint">依次点击纯红、纯绿、纯蓝复现真实故障</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn" data-rgb-preset="red" style="border-left: 3px solid #d63031;">纯红 (0xF800)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="green" style="border-left: 3px solid #27ae60;">纯绿 (0x07E0)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="blue" style="border-left: 3px solid #0984e3;">纯蓝 (0x001F)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="yellow" style="border-left: 3px solid #f1c40f;">明黄 (0xFFE0)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="cyan" style="border-left: 3px solid #00cec9;">青色 (0x07FF)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="magenta" style="border-left: 3px solid #e056fd;">品红 (0xF81F)</button>
        <button type="button" class="aiw-btn" data-rgb-preset="white" style="border-left: 3px solid #636e72;">纯白 (0xFFFF)</button>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>2. 硬件故障注入开关 (Fault Injection Switches)</span>
        <span class="aiw-hint">勾选下列复选框模拟寄存器配置失误</span>
      </div>
      <div class="rgb-fault-toggles">
        <label class="rgb-toggle-label">
          <input type="checkbox" id="rgb-chk-invert">
          <span><strong>显示反相配置错误 (INVON/INVOFF 互斥命令发反)</strong>：驱动发送 0x20 而非 0x21，光学成像按位取反 <code>~color</code></span>
        </label>
        <label class="rgb-toggle-label">
          <input type="checkbox" id="rgb-chk-swap-channels">
          <span><strong>MADCTL 寄存器 Bit 3 翻转 (RGB / BGR 通道互换)</strong>：红蓝通道对调，绿色通道保持不变</span>
        </label>
        <label class="rgb-toggle-label">
          <input type="checkbox" id="rgb-chk-byte-swap">
          <span><strong>高低字节错序 (SPI DMA 传输缺少 <code>__REV16</code> 字节翻转)</strong>：高 8 位与低 8 位颠倒发送</span>
        </label>
      </div>
    </div>

    <div class="rgb-lab-grid">
      <div class="rgb-color-card">
        <span class="aiw-stat-label">理论预期颜色 (Expected Color)</span>
        <div class="rgb-swatch" id="rgb-swatch-expected"></div>
        <div class="aiw-stat-value" id="rgb-hex-expected">0xF800</div>
        <div class="rgb-bits-row" id="rgb-bits-expected"></div>
        <small style="color: var(--muted); font-size: 11px;">算法层预期的原始 RGB565 像素</small>
      </div>

      <div class="rgb-color-card">
        <span class="aiw-stat-label">屏幕实际成像 (Screen GRAM Display)</span>
        <div class="rgb-swatch" id="rgb-swatch-actual"></div>
        <div class="aiw-stat-value accent" id="rgb-hex-actual">0xF800</div>
        <div class="rgb-bits-row" id="rgb-bits-actual"></div>
        <small style="color: var(--muted); font-size: 11px;">经总线传输与面板解码后的物理视觉</small>
      </div>
    </div>

    <div class="aiw-stats" aria-label="总线字节流">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">SPI 总线先发字节 (Byte 0 · MSB)</span>
        <span class="aiw-stat-value accent" id="rgb-byte-0">0xF8</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">SPI 总线后发字节 (Byte 1 · LSB)</span>
        <span class="aiw-stat-value accent" id="rgb-byte-1">0x00</span>
      </div>
    </div>

    <div class="rgb-diag-box alert" id="rgb-diag-box">
      <div id="rgb-diag-text">
        <strong>当前状态正常</strong>：无任何硬件故障注入，屏幕成像与理论预期完全一致。
      </div>
    </div>

    <div class="aiw-controls">
      <button type="button" class="aiw-btn" id="rgb-btn-reset">清除全部故障注入并重置</button>
    </div>
  </div>
</div>

## 按现象快速定位根因

遇到 LCD 颜色或画面异常时，先对照下表区分是**初始化寄存器问题、字节/通道序问题，还是 DMA 与时序并发问题**：

| 观察到的现象 | 优先怀疑方向 | 关键判据 |
| --- | --- | --- |
| 红变青、蓝变黄、绿变紫，黑白互换 | `INVON (0x21)` / `INVOFF (0x20)` 不匹配 | 所有颜色稳定变成按位取反的互补色 |
| 红和蓝互换，绿色与黑白正常 | `MADCTL (0x36)` 的 RGB/BGR 位（bit3） | 仅红蓝通道对调，不是互补色 |
| 黑白正常，但三原色对应关系混乱 | RGB565 高低字节错序（Endianness） | 逻辑分析仪抓到红色为 `00 F8` 而非 `F8 00` |
| 色阶断裂、颜色偏淡或条纹化 | `COLMOD (0x3A)` 像素格式不匹配 | 检查是否实际发出 `0x3A, 0x55`（16-bit） |
| 固定位置错位、换行或边缘卷绕 | `CASET` / `RASET` 窗口端点或面板偏移 | 错误位置可重复，与矩形坐标边界一致 |
| 每隔 8 行或固定条带边界出现错色 | 异步 DMA 期间条带缓冲区被提前改写 | 静态纯色正常，动态 UI 错色且与 8 行条带对齐 |
| 切页或弹窗时偶发整块错色 | 同步接口与异步接口并发争用 SPI1 | 静态画面正常，按键切页瞬间触发 |
| 局部随机噪点、横向彩条，降频后消失 | 32 MHz SPI 信号完整性或屏幕时序余量不足 | 对排线长度、温度、个体样机敏感，16 MHz 稳定 |
| 首帧杂乱闪屏，随后恢复正常 | 背光开启过早或硬件复位延时不足 | 仅在冷启动首帧完成前短暂出现 |
| 刷新停滞且 RTT 报 DMA timeout | `DMA1_CH1` 中断丢失或主循环阻塞超 200 ms | 状态卡在 Busy，触发超时回收 |

## 标准分步排查流程

### 第一步：恢复最小八色与棋盘格测试

仅靠红、绿、蓝三色有时难以一眼区分反色与字节错位，建议在 `Iwdg_Init()` 之前运行八色纯色测试：

| 颜色 | RGB565 值 | 判据作用 |
| --- | ---: | --- |
| 黑（Black） | `0x0000` | 检验全 0 电平时是否纯黑（区分 `INVON/INVOFF`） |
| 白（White） | `0xFFFF` | 检验全 1 电平时是否纯白 |
| 红（Red） | `0xF800` | 检验高字节高 5 位与 RGB/BGR 顺序 |
| 绿（Green） | `0x07E0` | 跨高低字节边界（bit10..bit5），最易暴露高低字节颠倒 |
| 蓝（Blue） | `0x001F` | 检验低字节低 5 位与 RGB/BGR 顺序 |
| 黄（Yellow） | `0xFFE0` | 红+绿，蓝=0（若反色会显示纯蓝） |
| 青（Cyan） | `0x07FF` | 绿+蓝，红=0（若反色会显示纯红） |
| 紫（Magenta） | `0xF81F` | 红+蓝，绿=0（若反色会显示纯绿） |

若八色纯色正常而复杂界面异常，可进一步绘制 **1 像素黑白棋盘格**与**四象限色块**，用于暴露漏时钟、窗口右边界计算错误（`width - 1` 写成 `width`）或 DMA 计数减半问题。

### 第二步：用逻辑分析仪核对初始化序列与字节序

将逻辑分析仪连接到 `PA5 (SCK)`、`PA7 (MOSI)`、`PC5 (CS)`、`PC4 (RS/DC)`，采样率需显著高于 32 MHz（建议 ≥ 100 MS/s）：

1. **核对初始化命令阶段（8-bit，Mode 0，MSB first）**：
   ```text
   RS=0: 0x3A  →  RS=1: 0x55   (COLMOD = RGB565)
   RS=0: 0x36  →  RS=1: 0x00   (MADCTL = 正向 RGB)
   RS=0: 0x21                  (INVON)
   RS=0: 0x13                  (NORON)
   RS=0: 0x29                  (DISPON)
   ```
2. **核对 `RAMWR (0x2C)` 后的像素字节流（16-bit HalfWord，MSB first）**：
   ```text
   红：F8 00 F8 00 F8 00 ...
   绿：07 E0 07 E0 07 E0 ...
   蓝：00 1F 00 1F 00 1F ...
   ```
   若线上抓到红色为 `00 F8`，说明高低字节顺序颠倒，此时应检查 SPI1 是否切到了 16 bit、DMA 外设与内存宽度是否同为 `HalfWord`，切勿在未抓波确认前盲目对颜色常量做软件 `bswap16`。

### 第三步：SPI 降频对照实验

当前配置 `SPI_BR_PRESCALER_2` 对应 `SCK = 64 MHz / 2 = 32 MHz`。怀疑随机噪点、花屏与时序裕量有关时，可临时改为 4 分频（16 MHz）或 8 分频（8 MHz）做对照：

```c
/* 临时将 32 MHz 降至 16 MHz 对照信号完整性 */
spiInit.BaudRatePres = SPI_BR_PRESCALER_4;
```

| 对照表现 | 结论与处理方向 |
| --- | --- |
| 32 MHz 偶发花屏，16 MHz 完全稳定 | 屏幕控制器写入时序上限或 FPC 排线过冲/建立时间不足，需结合示波器与多板高低温测试选定量产分频 |
| 16 MHz 下依然固定错色 | 排除高频信号完整性问题，聚焦初始化寄存器（`INVON`/`MADCTL`/`COLMOD`）或烧录镜像版本 |
| 降频后仍随机出现 8 行条带错色 | 属于软件异步缓冲区生命周期或主循环并发问题，继续排查第四、五步 |

### 第四步：检查异步 DMA 缓冲区生命周期与互斥

`LcdSt7789_DrawPixelsAsync()` 启动 DMA 后立即返回，并不复制像素内存。必须确保：

1. **繁忙期间严禁改写缓冲**：在 `LcdSt7789_IsBusy()` 返回 `false` 前，调用方不能向同一个 `pixels[240 * 8]` 写入下一条带数据；
2. **严禁传递栈上局部数组**：传给异步接口的像素缓冲区必须是静态或全局生命周期；
3. **同步与异步接口严禁并发**：当异步条带正在传输时，不得穿插调用阻塞式 `LcdSt7789_FillRect()`、直接写命令或改写 `MADCTL`，否则会同时破坏 SPI 8/16 位状态、`CS/RS` 电平与 DMA 通道计数；
4. **核对 DMA `BufSize` 单位**：在 16-bit HalfWord 模式下，DMA 的 `BufSize` 是**像素个数（1,920）**而非字节数（3,840）。

## 板级验收清单

修改 LCD 驱动或升级 SPI 频率后，检查以下项目：

- [ ] Keil Rebuild 零错误、零新增警告，确认烧录 HEX 为当前最新产物。
- [ ] 多次冷启动、复位与热重启后，黑、白、红、绿、蓝、黄、青、紫八色显示一致且无首帧闪屏。
- [ ] 1 像素黑白棋盘格与四边 1 像素边框无漏点、无行列偏移。
- [ ] 逻辑分析仪确认 `COLMOD=0x55`、`INVON=0x21`、像素期 `CS` 在 `SPI BUSY = 0` 后才拉高。
- [ ] 开启 AD7190 连续采样并快速切换 UI 页面、滚动历史记录，RTT 无 `ST7789 asynchronous DMA timeout or transfer error` 日志，页面无条带错色。
