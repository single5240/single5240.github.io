---
layout: article
title: N32G455 LCD 条带渲染与异步刷新实现分析
description: 针对小内存 Cortex-M MCU，解析从数据变化到 240×8 局部条带画布、不可变帧快照防撕裂、SPI 全双工 DMA 与主循环非阻塞刷屏的完整链路。
date: 2026-10-15
category: 嵌入式
tags:
  - N32G455
  - ST7789
  - LCD
  - DMA
  - 裸机UI
---

在 SRAM 极度受限的嵌入式系统（如仅 144 KB RAM）中驱动 240×320 彩屏时，整屏显存高达 153.6 KB，无法开辟整帧缓冲区。本文系统解析用一块 8 行缓冲区分批刷新 LCD 的架构链路，深入剖析条带画布裁剪、不可变帧快照防撕裂与 SPI DMA 异步收尾机制。控制器底层命令可参考 [ST7789 命令时序、窗口配置与像素 DMA 传输参考]({{ '/articles/st7789-command-and-pixel-dma.html' | relative_url }})，多外设 SPI 与 DMA 调度参考见 [N32G455 SPI 与 DMA 配置参考]({{ '/articles/n32g455-spi-dma-guide.html' | relative_url }})。

## 阅读目标与相关文件

阅读时可以对照这几个问题：

- UI 数据、页面状态和 LCD 驱动之间如何分层；
- 为什么没有使用整屏帧缓冲，而是使用 8 行高的渲染条带；
- RGB565 像素如何通过全屏坐标裁剪写入条带缓冲；
- SPI1 为什么同时启用 TX DMA 和 RX DMA；
- DMA 完成为什么不等于 SPI 已经发送完毕；
- 中断、主循环和 DMA 如何协同，又如何避免缓冲区被提前改写；
- 屏幕方向切换、背光、超时恢复分别在什么时机执行；
- 当前实现的性能、边界和仍需硬件确认的事项。

核心显示链路分为四个解耦的子系统：

| 子系统模块 | 核心职责 | 依赖与设计约束 |
| --- | --- | --- |
| `StripCanvas` | 240×8 局部条带像素缓冲（3,840 字节）、全屏到局部坐标动态裁剪 | 零整屏显存分配，仅管理当前 8 行 RGB565 像素 |
| `FrameSnapshot` | 逻辑帧不可变快照抓取、重绘请求合并（脏标记） | 解决 40 次主循环分批渲染期间数据跳变撕裂 |
| `LcdDriver` | 窗口命令下发、SPI 全双工 DMA 异步传输与三态状态机 | 极简中断服务程序，主循环等待 SPI BUSY 清零 |
| `PageRenderer` | 业务页面布局、1-bit 字库光栅化与基础图元绘制 | 绘制逻辑使用全屏坐标，由 Canvas 自动裁剪 |

## 整体显示分层模型

显示链路自顶向下分为 6 个阶段：

```text
传感器与设置数据
  → AppRuntimeData（运行数据快照）
  → AppUiContext（页面状态和待显示值）
  → AppUiRenderer（一帧不可变快照）
  → AppUiCanvas（240 × 8 RGB565 条带缓冲）
  → AppUiDisplay（显示适配层）
  → LcdSt7789（窗口命令与 SPI1 DMA）
  → LCD GRAM（屏内显存）
```

每层只负责一类职责：

| 层 | 解决的问题 | 不应该负责的事情 |
| --- | --- | --- |
| `AppRuntimeData` | 收集力值、电量、方向 | 不画像素，不操作 SPI |
| `AppUiContext` | 当前页面、选中项、显示文本、UI 事件 | 不感知 DMA 通道 |
| `AppUiRenderer` | 固定一整帧要使用的数据快照 | 不直接控制 LCD 引脚 |
| `AppUiCanvas` | 保存当前 8 行的 RGB565 像素 | 不保存完整 320 行画面 |
| `AppUiDisplay` | 隔离 UI 与 ST7789 具体实现 | 不实现页面布局 |
| `LcdSt7789` | 配置 LCD 窗口，启动 SPI/DMA，处理完成与超时 | 不理解“力值”“菜单”等业务含义 |

最核心的设计边界是：**LCD 驱动模块不保存整屏画面，它只把 UI 交给它的一块像素内存传送到屏幕。** 页面怎么画、画什么内容，完全由 UI 层决定。

## 硬件连接与信号含义

在典型的 4 线 SPI 彩屏接口中，包含以下硬件引脚定义：

| MCU 引脚 | 驱动名称 | 作用 |
| --- | --- | --- |
| PA5 | `LCD_SCL` | SPI1 SCK，串行时钟 |
| PA7 | `LCD_SDA` | SPI1 MOSI，MCU 向屏幕发送命令和像素 |
| PA6 | `LCD_DOUT` | SPI1 MISO，屏幕向 MCU 返回数据；初始化时读取 ID |
| PC4 | `LCD_RS` | 命令/数据选择（D/C）：`0`=控制命令，`1`=参数或像素数据 |
| PC5 | `LCD_CS` | 屏幕片选，低电平有效：`0`=选中屏幕，`1`=事务结束 |
| PB0 | `LCD_RST` | 屏幕硬件复位，低电平有效 |
| PC2 | `LCD_BL` | 背光控制，当前板级定义为高电平点亮 |

代码按 ST7789、SPI Mode 0、32 MHz 工作，这属于**当前软件配置与现有实现**，移植或更换屏幕批次时仍须结合屏幕规格书与逻辑分析仪实测确认。

## SPI1 时钟与模式配置

LCD 初始化通过 `LcdSt7789_ConfigGpio()` 完成 GPIO、SPI1、DMA1 时钟和 DMA 中断配置。

### 时钟来源

系统时钟与 SPI1 分频关系如下：

```text
SYSCLK = 128 MHz
HCLK   = 128 MHz
PCLK2  =  64 MHz（HCLK / 2）
SPI1   = PCLK2 / 2 = 32 MHz
```

### SPI1 工作模式

| 配置项 | 当前值 | 含义 |
| --- | --- | --- |
| 主从模式 | Master | MCU 产生 SCK |
| 总线方向 | 双线全双工 | MOSI 发送的同时，MISO 也会移入一个值 |
| 初始数据宽度 | 8 bit | 适合发送 LCD 命令和单字节参数 |
| CPOL / CPHA | Low / First edge | SPI Mode 0，空闲时 SCK 为低，第一边沿采样 |
| NSS | Software | CS 不交给 SPI 硬件，由 PC5 手动控制 |
| 位序 | MSB first | 高位先发送 |
| 波特率 | PCLK2 / 2 | 当前 32 MHz |

手动控制 CS 和 RS 的原因是 LCD 协议不只是连续字节流。在一次刷新前，软件要依次完成“发命令、发参数、切换为像素数据、保持 CS 有效”等步骤。

### 初始化 GPIO 时先写安全电平

`drv_lcd_st7789.c` 先写输出数据寄存器，再把引脚切成推挽输出模式：

- `CS` 先置高，避免误选中屏幕；
- `RS` 先置高，保持普通数据态；
- `RST` 先置低，屏幕保持复位；
- `BL` 先关闭，避免屏幕显存未初始化时闪出随机内容；
- `SCK` 先置低，匹配 SPI Mode 0 空闲电平。

这样可以避免 GPIO 模式切换瞬间产生肉眼可见的背光闪烁或被屏幕误识别为命令的毛刺。

## LCD 上电初始化与背光时机

`LcdSt7789_Init()` 的执行顺序如下：

1. 配置 GPIO、SPI1、DMA1 和 NVIC；
2. 关闭背光（PC2 置低）；
3. `RST` 拉低 20 ms，再拉高并等待 120 ms；
4. 发送 `SWRESET (0x01)` 软件复位，等待 150 ms；
5. 发送 `SLPOUT (0x11)` 退出睡眠，等待 120 ms；
6. 发送 `RDDID (0x04)`，经过一个 dummy byte 后读取 3 个 ID 字节；
7. 发送 `COLMOD (0x3A) = 0x55`，选择 16 bit/pixel 的 RGB565 像素格式；
8. 发送 `MADCTL (0x36) = 0x00`，选择默认正向扫描；
9. 依次发送 `INVON (0x21)`、`NORON (0x13)` 和 `DISPON (0x29)`；
10. 等待 UI 把第一整帧（40 个条带）画完后再开启背光。

需要注意两点：

1. 当前 `RDDID` 只判断 SPI 传输是否超时，未将读回的 3 字节与固定 ID 强校验。因此 `LcdSt7789_Init()` 返回 `true` 代表“ID 读取事务完成”。
2. 初始化期间 LCD GRAM 的内容不保证是有效页面。如果复位后立即开背光，用户可能看到随机花屏。因此固件坚持在 UI 完成首帧全部 40 个条带（`nextY >= 320`）后才调用 `AppUiDisplay_BacklightOn()` 打开背光（100% 档位为持续高电平，40%～88% 档位为 TIM4 软件 PWM）。

## RGB565 格式与 LCD 地址窗口

### RGB565 16 位像素表示

`COLMOD = 0x55` 将像素格式配置为 RGB565：

```text
Bit:  15          11 10               5 4            0
     +--------------+------------------+--------------+
     | Red: 5 bits  | Green: 6 bits    | Blue: 5 bits |
     +--------------+------------------+--------------+
```

常见纯色值：红色 `0xF800`、绿色 `0x07E0`、蓝色 `0x001F`、白色 `0xFFFF`、黑色 `0x0000`。

UI 的像素缓冲类型是 `uint16_t`。发送像素前，SPI1 从 8 位模式切换到 16 位模式并保持 MSB first，每个半字按高位到低位发出，正好对应 RGB565 的线上顺序；像素传输完成后，驱动再把 SPI1 恢复为 8 位，以便发送下一组 LCD 命令。

### 矩形窗口设置

屏幕内部有独立 GRAM。MCU 在发送像素之前，先用 `LcdSt7789_SetWindow()` 设定目标矩形窗口：

1. `CASET (0x2A)`：设置起始列 `x0` 和结束列 `x1`；
2. `RASET (0x2B)`：设置起始行 `y0` 和结束行 `y1`；
3. `RAMWR (0x2C)`：通知屏幕后续数据是 GRAM 像素；
4. `RS` 拉高、`CS` 拉低；
5. 连续发送 `width × height` 个 RGB565 像素。

结束坐标包含端点，计算关系为 `x1 = x + width - 1`、`y1 = y + height - 1`。条带缓冲按行优先排列，LCD 内部地址自动递增，将线性像素流依次填入矩形窗口。

## 渲染条带（Strip Rendering）与帧快照机制

### 为什么用 8 行条带代替整屏缓冲

240 × 320 分辨率下，每像素 2 字节，完整 RGB565 帧缓冲需要：

```text
240 × 320 × 2 = 153,600 bytes (150 KiB)
```

这已超过 N32G455REL7 的 144 KiB 总 SRAM。因此固件只分配 8 行高度的条带缓冲：

```c
#define UI_RENDER_STRIP_ROWS (8U)
uint16_t pixels[240 * 8];
```

条带缓冲大小仅为 `240 × 8 × 2 = 3,840 bytes`，是整屏缓冲的 1/40；完整一帧被拆成 `320 / 8 = 40` 个条带，用分次绘制和 DMA 调度换取极低的 RAM 占用。

### 单条带生成流程与坐标裁剪

`AppUi_RenderProcess()` 在每轮主循环中每次只推进一条带：

```text
if LCD still busy:
    return

if a new frame starts:
    capture an immutable frame snapshot

if all 320 rows are complete:
    end frame and turn on backlight
    return

prepare canvas for rows nextY .. nextY + 7
draw current page, clipped to those rows
start asynchronous DMA for that strip
nextY += stripHeight
```

为什么调用完整页面绘制函数却只改写 8 行？关键在 `AppUiCanvas_FillRect()` 和 `AppUi_DrawGlyphBits()` 的裁剪逻辑：

- 页面绘制代码继续使用 `(0..239, 0..319)` 的全屏坐标；
- 基础绘图原语先判断图形矩形与当前条带 `[appUiCanvas.y, appUiCanvas.y + 7]` 是否相交；
- 不相交则立即跳过；相交时把全局纵坐标转换为条带内偏移 `drawY - appUiCanvas.y`，只改写条带缓冲中的第 `0..7` 行。

这种“用 CPU 换 RAM”的架构使业务页面无需为条带编写复杂的分段布局代码，代价是同一页面的布局函数在一帧内会执行 40 次。

#### 条带画布上下文与全屏矩形裁剪实现

```c
typedef struct
{
    uint16_t stripY;          /* 当前条带在全屏中的起始 Y 坐标 (0..312, 步进 8) */
    uint16_t stripHeight;     /* 当前条带高度 (固定为 8) */
    uint16_t pixels[240 * 8]; /* 8 行 RGB565 像素缓冲 (3,840 字节) */
} StripCanvas;

static StripCanvas s_canvas;

/* 全屏矩形填充在当前条带上的动态裁剪算法 */
void Canvas_FillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color)
{
    int16_t stripTop = (int16_t)s_canvas.stripY;
    int16_t stripBottom = (int16_t)(stripTop + s_canvas.stripHeight);

    /* 1. 垂直方向快速剔除：若目标矩形完全在当前条带上方或下方，直接跳过 */
    if ((y + h <= stripTop) || (y >= stripBottom))
    {
        return;
    }

    /* 2. 计算在条带局部的有效扫描行范围 [localY0, localY1) */
    int16_t localY0 = (y < stripTop) ? 0 : (int16_t)(y - stripTop);
    int16_t localY1 = (y + h > stripBottom) ? (int16_t)s_canvas.stripHeight : (int16_t)(y + h - stripTop);

    /* 3. 水平方向边界夹紧 [clipX0, clipX1) */
    int16_t clipX0 = (x < 0) ? 0 : x;
    int16_t clipX1 = (x + w > 240) ? 240 : (int16_t)(x + w);
    if (clipX0 >= clipX1) return;

    /* 4. 仅改写落在当前 8 行内的局部缓冲区 */
    for (int16_t ly = localY0; ly < localY1; ly++)
    {
        uint16_t *row = &s_canvas.pixels[ly * 240];
        for (int16_t lx = clipX0; lx < clipX1; lx++)
        {
            row[lx] = color;
        }
    }
}
```

### 帧快照与重绘请求合并

一帧由 40 次主循环、40 次绘制和 40 次 DMA 组成。如果每条带都直接读取实时力值或菜单焦点，上半屏可能画旧值、下半屏画新值，造成同一帧内部自相矛盾。

因此一帧开始时，渲染器将当前页面、菜单焦点、已格式化力值、电池百分比、波形快照及预计算的曲线纵坐标、设置页文本统一复制到 `AppUiRenderer` 快照中，在 40 个条带全部发完前保持不变，从而保证**逻辑上的帧一致性**。

同时，`AppUi_RequestRedraw()` 不会堆积刷新队列，只将 `appUiRenderer.pending` 置 1：

- 同一时刻连续发生多次数据变化，只合并为“需要再画一帧”；
- 当前帧传输期间若有新变化，`pending` 标志保留，待当前帧第 40 条带结束后抓取最新快照开始下一帧。

### 交互式在线演示：240×8 条带渲染与帧快照防撕裂模拟

下面的演示每次绘制 8 行，从第 0 条带（`y=0..7`）推进到第 39 条带（`y=312..319`）。关闭“帧快照”后，可以观察数据在一帧中途变化时，数字上下部分不一致的现象。整屏缓冲区需要 153.6 KB，条带缓冲区为 3.84 KB。

<div class="article-interactive-widget" id="strip-demo-app" aria-label="LCD 条带渲染与帧快照防撕裂交互演示">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE WIDGET · 渲染管线仿真</span>
    <h3 class="aiw-title">240×8 像素条带渲染与帧快照防撕裂模拟器</h3>
    <p class="aiw-desc">仿真极低内存 MCU（SRAM 144 KB）驱动 240×320 彩屏方案：8 行局部条带画布（仅 3.84 KB，节省 97.5% 显存）、全屏坐标动态裁剪与 <code>AppUiRenderer</code> 帧快照一致性保证。</p>
  </div>
  <div class="aiw-body">
    <div class="strip-memory-compare">
      <div class="strip-mem-card bad">
        <span class="aiw-stat-label">方案一：传统整屏全帧缓冲 (Full Framebuffer)</span>
        <div class="strip-mem-val">153.60 KiB</div>
        <small style="color: #d32f2f; font-size: 11px;">240×320×2 字节，超过 N32G455 144 KiB 总 SRAM 上限。</small>
      </div>

      <div class="strip-mem-card good">
        <span class="aiw-stat-label">方案二：8 行局部条带画布 (Strip Canvas)</span>
        <div class="strip-mem-val">3.84 KiB</div>
        <small style="color: var(--accent-dark); font-size: 11px;">240×8×2 字节，约占 SRAM 2.67%，为采集队列与协议栈预留内存。</small>
      </div>
    </div>

    <div class="aiw-stats" aria-label="当前条带状态">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">当前渲染条带 (Strip Index)</span>
        <span class="aiw-stat-value accent" id="strip-stat-strip">条带 0 / 39 (总计 40 条带)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">条带物理行坐标跨度</span>
        <span class="aiw-stat-value" id="strip-stat-y">y = 0 .. 7 px</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">逻辑画面完整性判定</span>
        <span class="aiw-stat-value accent" id="strip-stat-tear">画面原子一致 (无撕裂)</span>
      </div>
    </div>

    <div class="strip-sim-container">
      <div>
        <div class="strip-screen" id="strip-screen">
          <div class="strip-band" id="strip-band" style="top: 0px;"></div>
          <div class="strip-screen-ui">
            <div class="strip-screen-top">
              <span>BAT: 88%</span>
              <span>240×320 ST7789</span>
              <span>PEAK: 92.4N</span>
            </div>
            <div class="strip-screen-main">
              <div>
                <span class="strip-screen-val" id="strip-screen-val">45.20</span>
                <span class="strip-screen-unit">N</span>
              </div>
              <small style="color: var(--muted); font-size: 9px; margin-top: 2px;">实时拉力测量读数</small>
            </div>
            <canvas class="strip-screen-waveform" id="strip-canvas" width="220" height="70"></canvas>
            <div class="strip-screen-bot">
              <span>[F1: 清零]</span>
              <span>[F2: 峰值]</span>
              <span>[F3: 存盘]</span>
            </div>
          </div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <div class="aiw-section-title">
            <span>帧快照机制开关 (AppUiRenderer Snapshot)</span>
            <span class="aiw-hint">对比有无快照时的画面防撕裂效果</span>
          </div>
          <label class="rgb-toggle-label">
            <input type="checkbox" id="strip-chk-snapshot" checked>
            <span><strong>开启帧快照机制</strong>：条带 0 开始时锁定当前数据快照，整帧 40 个条带绘制完成前保持快照不变，避免上下半屏数据不一致。</span>
          </label>
        </div>

        <div>
          <div class="aiw-section-title">
            <span>渲染与故障测试控制台</span>
            <span class="aiw-hint">测试在刷屏中途注入突发力值跳变</span>
          </div>
          <div class="aiw-controls">
            <button type="button" class="aiw-btn primary" id="strip-btn-step">单步推进 1 条带 (8 行)</button>
            <button type="button" class="aiw-btn" id="strip-btn-run">连续刷屏</button>
            <button type="button" class="aiw-btn warn" id="strip-btn-jump">模拟传感器力值跳变 (45.20N ➔ 89.60N)</button>
            <button type="button" class="aiw-btn" id="strip-btn-reset">复位重置</button>
          </div>
        </div>

        <div class="aiw-log-panel">
          <div class="aiw-section-title">
            <span>渲染条带流转与裁剪日志</span>
            <span class="aiw-hint">观察 Strip 0 快照锁定与撕裂捕获</span>
          </div>
          <div class="aiw-log" id="strip-log" aria-live="polite"></div>
        </div>
      </div>
    </div>
  </div>
</div>

## SPI1 全双工 DMA 与三态异步状态机

### TX DMA 与 RX DMA 协同配置

一个 8 行条带包含 1,920 个像素（30,720 bits）。`LcdSt7789_DrawPixelsAsync()` 使用 DMA1_CH2 发送像素，同时启用 DMA1_CH1 接收丢弃：

| 配置项 | RX 通道（DMA1_CH1） | TX 通道（DMA1_CH2） |
| --- | --- | --- |
| 外设地址 | `&SPI1->DAT` | `&SPI1->DAT` |
| 内存地址 | 静态变量 `&lcdAsyncRxDiscard` | 条带像素缓冲 `pixels` |
| 传输方向 | 外设 → 内存 | 内存 → 外设 |
| 内存地址递增 | 关闭（始终覆盖同一丢弃变量） | 开启（顺序扫描每个像素） |
| 数据宽度 | HalfWord（16 bit） | HalfWord（16 bit） |
| 模式 / 优先级 | Normal / Medium | Normal / Medium |
| 中断配置 | 开启完成（TC）与错误（TE）中断 | 不开启独立中断 |

为什么只写屏幕还必须配置 RX DMA？因为 SPI 是全双工移位结构，MOSI 每发出 16 位像素，MISO 也会移入 16 位数据。若不取走接收数据，接收寄存器会产生未读数据并触发 `OVR`（Overrun）标志。用内存不递增的 RX DMA 将无用数据排空到静态变量 `lcdAsyncRxDiscard`，既无需分配 3,840 字节接收缓冲，又能以“最后一个接收半字取走”作为全双工传输完成的可靠基准。

### 为什么 DMA 完成不等于 SPI 传输结束

必须区分三个硬件阶段：

1. TX DMA 把最后一个像素写入 `SPI1->DAT`；
2. SPI 将该数据装入内部移位寄存器，RX DMA 收完倒数第二个字并在最后一个字移入后触发 RX TC 中断；
3. SPI 硬件确保总线上最后一位真正移出并令 `SPI_I2S_BUSY_FLAG` 清零。

如果收到 DMA 中断就立刻拉高 `CS`，最后一个像素可能仍在移位或刚离开移位器，导致屏幕尾像素截断。因此驱动采用三态状态机：

```text
LCD_ASYNC_IDLE（空闲，可接受新条带）
  │
  ├─ 配置窗口并启动 RX/TX DMA
  ▼
LCD_ASYNC_TRANSFER（DMA 搬运中）
  │
  ├─ RX DMA 完成中断置位 lcdAsyncDmaDone = 1
  ▼
LCD_ASYNC_WAIT_SPI（主循环等待 SPI BUSY 清零）
  │
  ├─ SPI BUSY == 0（或 200 ms 超时恢复）
  ▼
关闭 DMA 与中断 → 拉高 CS → SPI 恢复 8 bit → 回到 LCD_ASYNC_IDLE
```

#### 异步传输状态机与中断服务程序

```c
typedef enum {
    LCD_STATE_IDLE = 0,     /* 空闲，可接受新条带 */
    LCD_STATE_TRANSFERRING, /* DMA 搬运像素中 */
    LCD_STATE_WAIT_SPI_DONE /* DMA 完成，等待 SPI 硬件移位寄存器排空 */
} LcdAsyncState;

static volatile LcdAsyncState s_lcdState = LCD_STATE_IDLE;

/* DMA 接收完成中断服务程序 (仅更新状态与清除中断挂起，绝不阻塞) */
void DMA1_Channel1_IRQHandler(void)
{
    if (DMA_GetFlagStatus(DMA1_FLAG_TC1))
    {
        DMA_ClearFlag(DMA1_FLAG_TC1);
        s_lcdState = LCD_STATE_WAIT_SPI_DONE;
    }
}

/* 主循环非阻塞推进函数 */
void Lcd_Process(void)
{
    if (s_lcdState == LCD_STATE_WAIT_SPI_DONE)
    {
        /* 严禁在 DMA ISR 中拉高 CS，必须等待 SPI 硬件 BUSY 清零 */
        if (!SPI_IsBusy(SPI1))
        {
            LCD_CS_HIGH();               /* 拉高片选，结束像素事务 */
            SPI_SetDataWidth8Bit(SPI1);  /* 恢复 8 位命令模式 */
            s_lcdState = LCD_STATE_IDLE; /* 释放条带所有权，允许 UI 绘制下一条带 */
        }
    }
}
```

### 极简 ISR 与主循环收尾

`DMA1_Channel1_IRQHandler` 转发给 `LcdSt7789_DmaRxIrqHandler()`，中断服务程序只做三件事：

- RX DMA 错误时置 `lcdAsyncDmaError = 1`；
- RX DMA 完成时置 `lcdAsyncDmaDone = 1`；
- 清除 DMA1_CH1 全局中断挂起位。

ISR 不等待 `SPI BUSY`、不切 SPI 位宽、不打日志，也不启动下一条带。LCD 中断的抢占优先级为 3，AD7190 采样中断为 1；这里只记录标志，收尾交给主循环中的 `LcdSt7789_Process()` 执行。

## 单条带完整时序与主循环串联

```text
AppUi_RenderProcess()
  1. 在 240×8 缓冲中裁剪绘制当前条带 (y .. y+7)
  2. 调用 LcdSt7789_DrawPixelsAsync(0, y, 240, 8, pixels)
       ├─ 8-bit 轮询发送 CASET + RASET + RAMWR
       ├─ RS=1, CS=0 保持，SPI1 切换为 16-bit
       ├─ 先使能 RX DMA (CH1)，再使能 TX DMA (CH2)
       └─ 状态置为 TRANSFER，立即返回 true
  3. UI 将 nextY += 8 并返回主循环，主循环继续处理采样/按键/看门狗
  ...
DMA1_Channel1_IRQHandler()
  4. 1,920 个像素搬运完毕，置 lcdAsyncDmaDone = 1 并清中断
  ...
下一轮主循环：
  5. AppRuntimeData_Process() 更新实时数据
  6. LcdSt7789_Process() 检测到 dmaDone，进入 WAIT_SPI
  7. 确认 SPI BUSY == 0，关 DMA、拉高 CS、恢复 8-bit、状态回 IDLE
  8. AppUi_Process() 见 IsBusy() == false，立即绘制并提交下一条带
```

需要注意的是：“释放条带缓冲”是所有权移交概念——在 `LcdSt7789_IsBusy()` 返回 `false` 之前，UI 绝不能修改或覆盖 `pixels` 数组。

## 性能估算与屏幕方向切换

### 理论与实际帧率

在 SPI1 32 MHz、16 bit RGB565 下，理论纯像素速率为 `32,000,000 / 16 = 2,000,000 pixel/s`：

- 单个 `240 × 8` 条带（1,920 像素）纯传输时间约 `0.96 ms`；
- 整屏 40 个条带（76,800 像素）纯传输时间约 `38.4 ms`（理论极限约 26 fps）。

计入每条带的 `CASET/RASET/RAMWR` 命令开销、40 次布局裁剪计算、主循环收尾间隔以及高优先级 AD7190 采样的穿插后，实际刷新率面向测量仪表式的 **10 Hz（100 ms 周期）内容更新**设计，兼顾视觉响应与采样实时性。

### 屏幕方向在帧边界切换

屏幕正向（`MADCTL = 0x00`）与 180° 反向（`MADCTL = 0xC0`）只能在两帧之间切换。`AppUi_ProcessOrientation()` 仅在满足以下全部条件时才写 `MADCTL`：

- 目标方向有效且与当前方向不同；
- 当前没有正在分条带生成的一帧；
- `LcdSt7789_IsBusy() == false`。

若在一帧中途修改 `MADCTL`，已发出的上半帧与后续条带会使用相反的扫描坐标系，导致画面上下割裂。方向切换成功后会立即触发一次整屏重绘。

## 常见误区与排查速查

### 常见认识误区

- **误区一：DMA 完成中断一到就可以立刻改写像素缓冲**——不可以，必须等主循环 `LcdSt7789_Process()` 确认 `SPI BUSY` 清零并将状态切回 `IDLE`。
- **误区二：启用 RX DMA 说明正在从屏幕读回图像**——不是，正常刷屏时 RX DMA 仅用于排空全双工移位器防止 `OVR`，并作为完成事件基准。
- **误区三：有帧快照就完全没有物理撕裂**——帧快照保证同一帧内的业务数值与曲线自洽，但屏幕仍按 40 个条带从上往下写入 GRAM，未使用双帧缓冲或 TE 同步信号。

### 典型故障排查方向

| 现象 | 优先检查项 |
| --- | --- |
| 全黑但背光亮 | `RST` 时序、`DISPON` 命令、SPI 模式、`CS/RS` 电平 |
| 背光不亮 | `PC2` 电平、首帧 40 个条带是否顺利走完、外围背光驱动电路 |
| 颜色变互补色或红蓝互换 | `INVON (0x21)` / `INVOFF (0x20)`、`MADCTL` 的 RGB/BGR 位，详见 [嵌入式 RGB565 LCD 颜色反转、字节错序与花屏排查指南]({{ '/articles/lcd-rgb565-color-troubleshooting.html' | relative_url }}) |
| 尾像素缺失或条带末尾异常 | `CS` 是否在 `SPI BUSY` 清零前被提前拉高 |
| 随机卡住约 200 ms 后恢复 | `DMA1_CH1` 中断配置、请求重映射、主循环是否有超长阻塞 |
| 横向彩条或条带边界错色 | 异步 DMA 期间是否提前改写了 `pixels` 缓冲、8/16 位模式切换是否成对 |
