---
layout: article
title: 嵌入式 1-bit 中英繁点阵字库子集化生成与集成
description: 面向小内存 MCU 的多语言（简体中文、台湾繁体、英文）1-bit 点阵字库生成流水线，涵盖字号规划、原生点阵防粘连、Unicode 二分查找表与零缓冲条带光栅化。
date: 2026-10-15
category: 嵌入式
tags:
  - 点阵字库
  - 多语言UI
  - N32G455
  - LCD
  - Python脚本
---

在小内存嵌入式 MCU（如片内 Flash 512 KB、RAM 144 KB）的多语言界面中，直接嵌入完整中文字库会迅速耗尽 Flash 空间。本文介绍一套按需提取 UI 字符子集的 1-bit 点阵字库生成与光栅化流水线，使用 16 px 原生点阵和 24 px/40 px 定制字形，五套字库仅占约 19.2 KB Flash，即可实现高清晰度多语言显示。页面条带渲染原理见 [N32G455 LCD 条带渲染与异步刷新实现分析]({{ '/articles/n32g455-lcd-strip-rendering.html' | relative_url }})。

## 字号规划与 Flash 体积预算

在 512 KB Flash 的 MCU 上，如果直接嵌入完整 GB2312 或 Big5 字库，仅单个字号就会消耗数百 KB 空间。因此工程按 UI 视觉层级定义了 5 套按需子集化的 1-bit 点阵字库：

| 字库模块 | 像素尺寸 | 界面用途 | 收录字符范围 | 字形数量 | 点阵体积 |
| --- | --- | --- | --- | ---: | ---: |
| `font_16` | 汉字 `16×16`，ASCII `8×16` 等宽 | 简中/英文菜单正文、底栏、状态标签 | 可打印 ASCII + 简中 UI 汉字 + `±` | 278 | 7,360 B |
| `font_16_tw` | 汉字 `16×16` | 台湾繁体菜单正文、底栏、状态标签 | 当前繁体 UI 使用的全部汉字 | 182 | 5,824 B |
| `font_24` | 汉字 `24×24`，ASCII `12×24` 等宽 | 简中页面标题 | 简中菜单及常用小节标题字 | 47 | 2,952 B |
| `font_24_tw` | 汉字 `24×24` | 台湾繁体页面标题 | 当前繁体标题使用的全部汉字 | 29 | 2,088 B |
| `font_num_40` | `24×40` 等宽 | 首页主读数大数字 | 仅 `0123456789.-` | 12 | 1,440 B |

五套字库点阵数据合计仅 **19,664 字节（约 19.2 KiB）**，全部以 `const uint8_t` 存入片内 Flash，运行期零 RAM 占用。

## 1-bit 点阵二进制格式

所有字库统一采用 **1 bit/pixel、行优先（Row-major）、高位在左（MSB leftmost）** 的紧凑编码格式：

- 每个字节的最高位（`bit7`）对应该行最左侧像素，`bit0` 对应右侧第 8 个像素；
- 单行像素宽度不足 8 的整数倍时，行末低位补 `0`；
- 每行字节数计算公式：`stride = (width + 7) / 8`；
- 单个字形总字节数：`size = stride × height`。

典型字形尺寸计算示例：

```text
16×16 汉字：stride = (16 + 7) / 8 = 2 B/行  →  单个字形 = 2 × 16 = 32 B
 8×16 ASCII：stride = (8 + 7) / 8 = 1 B/行  →  单个字形 = 1 × 16 = 16 B
24×24 汉字：stride = (24 + 7) / 8 = 3 B/行  →  单个字形 = 3 × 24 = 72 B
24×40 数字：stride = (24 + 7) / 8 = 3 B/行  →  单个字形 = 3 × 40 = 120 B
```

## 为什么 16 px 繁体汉字必须用原生点阵而非矢量缩放

在 16×16 的极低分辨率下，台湾繁体字（如“歸”“斷”“輸”“壓”“籤”）笔画极其密集。如果直接将桌面端 TrueType/OpenType 矢量字体缩放到 16 px 再做二值化阈值裁剪，相邻横画与撇捺会严重粘连成实心黑块，导致小屏幕完全无法辨认。

为此，字库生成流水线采用了**按字号分源**的策略：

| 字库类别 | 字形上游来源 | 选择原因与质量控制 |
| --- | --- | --- |
| 简体汉字 `16×16` / `24×24` | U8g2 收录的 `GB16ST` / `GB24ST` 点阵宋体 | 经典手工修整点阵，横平竖直、笔画清晰 |
| 拉丁字母与符号 `8×16` / `12×24` | Spleen 等宽点阵字库 | 专为低分屏设计的像素等宽西文字体 |
| 台湾繁体汉字 `16×16` | **GNU Unifont 18.0.01（T-source Chinese）原生点阵** | 直接提取原生 16×16 像素手工点阵，不做任何缩放、抗锯齿或二值化，避免缩放、二值化造成的繁体字笔画粘连 |
| 台湾繁体标题汉字 `24×24` | Noto Serif TC Regular（23 px 栅格化） | 24 px 空间充足；先在带 8 px 外扩安全区的画布中完整绘制再裁入 `24×24` 字框，若任一有效像素越界则脚本直接报错中断 |
| 主读数大数字 `24×40` | JetBrains Mono Bold 定制点阵 | 等宽数字与小数点/负号，保证力值快速跳变时数字列绝不左右晃动 |

此外，构建脚本对上游标准字库文件执行 **SHA-256 哈希强校验**，确保在不同开发环境或 CI 中重新生成都能得到逐字节完全一致的 C 源码数组。

<div id="font-demo-app" class="font-demo-root">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h3 style="margin:0; font-size:16px;">1-bit 点阵字库生成与光栅化排障实验室</h3>
    <span style="font-size:12px; color:var(--muted);">纯前端交互演示</span>
  </div>

  <div class="font-tabs">
    <button class="font-tab-btn active" data-tab="editor">16×16 点阵画板与 C99 生成</button>
    <button class="font-tab-btn" data-tab="compare">矢量缩放粘连 vs 原生点阵</button>
    <button class="font-tab-btn" data-tab="bsearch">Unicode 升序二分查找模拟</button>
  </div>

  <!-- Tab 1: Editor -->
  <div id="font-panel-editor" class="font-tab-panel active">
    <div class="font-editor-grid">
      <div class="font-grid-wrap">
        <div id="font-grid-16" class="font-grid-16"></div>
        <div class="font-palette-bar">
          <button class="font-palette-btn" id="font-preset-gui">預設: 歸</button>
          <button class="font-palette-btn" id="font-preset-duan">預設: 斷</button>
          <button class="font-palette-btn" id="font-preset-he">预设: 荷</button>
          <button class="font-palette-btn" id="font-preset-a">ASCII: A</button>
          <button class="font-palette-btn" id="font-preset-0">ASCII: 0</button>
          <button class="font-palette-btn" id="font-btn-invert">反相</button>
          <button class="font-palette-btn" id="font-btn-clear" style="color:#ef4444;">清空</button>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <div class="font-preview-wrap">
          <canvas id="font-preview-canvas" class="font-preview-canvas" width="32" height="32"></canvas>
          <div class="font-preview-info">
            <div>字形规格：<span id="font-dim-label">16 × 16 (汉字)</span></div>
            <div>内存占用：<span id="font-byte-count">32 字节 (stride=2 B/行)</span></div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">编码标准：Row-major MSB leftmost (bit7 为行首最左像素)</div>
          </div>
        </div>

        <div class="font-c-export">
          <pre id="font-c-code">/* 正在生成 C99 const uint8_t 数组... */</pre>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 2: Compare -->
  <div id="font-panel-compare" class="font-tab-panel">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; gap:6px;">
        <span style="font-size:13px; font-weight:600; line-height:26px;">测试繁体字：</span>
        <button class="font-palette-btn font-compare-preset-btn active" data-char="歸">歸 (18画)</button>
        <button class="font-palette-btn font-compare-preset-btn" data-char="斷">斷 (18画)</button>
      </div>
      <div style="display:flex; align-items:center; gap:8px; font-size:12px;">
        <label for="font-thresh-slider">二值化阈值 (Threshold): <strong id="font-thresh-val">128</strong></label>
        <input type="range" id="font-thresh-slider" min="40" max="220" value="128" style="width:110px;">
      </div>
    </div>

    <div class="font-compare-grid">
      <div class="font-compare-card bad">
        <div class="font-compare-title">
          <span>矢量字体缩放到 16 px + 阈值二值化</span>
          <span class="font-compare-badge bad">粘连失真</span>
        </div>
        <canvas id="font-zoom-vector" class="font-zoom-canvas" width="128" height="128"></canvas>
        <div class="font-compare-desc">
          桌面级矢量字库在 16 px 极低网格下做灰度抗锯齿二值化裁剪时，繁体字密集横撇（如“歸”中间“𠂤”与“止”）像素间距不足 1 像素，强制二值化导致笔画粘连成黑色实心方块，完全失去可读性。
        </div>
      </div>

      <div class="font-compare-card good">
        <div class="font-compare-title">
          <span>GNU Unifont 原生 16×16 点阵</span>
          <span class="font-compare-badge good">像素级手工优化</span>
        </div>
        <canvas id="font-zoom-native" class="font-zoom-canvas" width="128" height="128"></canvas>
        <div class="font-compare-desc">
          上游源自手工修整的 16×16 原生点阵，在保证汉字骨架的同时对密集笔画做合理避让，严格保留单像素留白缝隙。不做任何插值缩放，在嵌入式小彩屏上边缘锐利、清晰辨识。
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 3: Binary Search -->
  <div id="font-panel-bsearch" class="font-tab-panel">
    <div class="font-bsearch-box">
      <div class="font-bsearch-controls">
        <label style="font-size:13px; font-weight:600;">输入查找字符或 Unicode 码点：</label>
        <input type="text" id="font-bsearch-input" class="font-bsearch-input" value="荷" maxlength="4">
        <button class="ecat-btn" id="font-bsearch-step-btn" style="background:var(--accent); color:#fff; border-color:var(--accent);">单步探测 (Step)</button>
        <button class="ecat-btn" id="font-bsearch-reset-btn">重置探测</button>
        <span style="font-size:12px; color:var(--muted); margin-left:auto;">
          表中收录 28 个典型字形（已升序排列），最多只需要 ⌈log₂(28)⌉ = 5 次比较
        </span>
      </div>

      <div class="font-bsearch-bar-wrap">
        <div id="font-bsearch-bar" class="font-bsearch-bar"></div>
      </div>

      <div id="font-bsearch-log" class="font-bsearch-log">
        准备就绪：输入目标字符后点击“单步探测”观察 low / mid / high 指针折半收敛过程。
      </div>
    </div>
  </div>
</div>

## Unicode 升序索引表与二分查找

为了在 ARMCC 5 下避免 GBK/UTF-8 源文件编码混用问题，所有字库检索表统一按 **Unicode 码点（`uint16_t codepoint`）升序排列**：

```c
typedef struct
{
    uint16_t codepoint; /* Unicode 码点，如 '荷' = 0x8377 */
    uint8_t  width;     /* 字形像素宽度：ASCII 为 8/12，汉字为 16/24 */
    uint8_t  size;      /* 字形点阵字节数 */
    uint16_t offset;    /* 在 font_xx_bitmap[] 数组中的起始字节偏移 */
} font_16_glyph_t;
```

查找单个字符时，`font_16_find(uint16_t codepoint)` 对升序表执行 `O(log N)` 二分查找（278 个字形最多比较 9 次即可命中）：

```c
const font_16_glyph_t *g = font_16_find(0x8377U); /* 查找 '荷' */
if (g != NULL)
{
    const uint8_t *bits = font_16_bitmap + g->offset;
    /* 使用 g->width, FONT_16_HEIGHT (16), g->size 进行光栅化 */
}
```

对于仅含 12 个字符（`0123456789.-`）的主读数字库 `font_num_40`，则直接通过 `font_num_40_index(char ch)` 映射为 `0..11` 的常数下标，实现 `O(1)` 零开销寻址。

## 多语言运行时切换与缺字安全回退

固件支持**简体中文（0）、英文（1）、台湾繁体中文（2）**三语实时切换：

1. **ASCII 与 `±` 共享主字库**：繁体字库 `font_16_tw` 和 `font_24_tw` 仅存储繁体汉字点阵；绘制繁体字符串遇到 ASCII 字母、数字或 `±` 时，自动回落到 `font_16` / `font_24` 查找，避免重复存储西文字形。
2. **整句缺字检查与回退保护**：返回繁体 UI 文案前，渲染层会先扫描该 UTF-8 字符串中的每个汉字是否均存在于对应繁体字库中；一旦发现任一字符未收录，整条文案自动回退为对应的简体中文字符串，避免屏幕上出现空白方框或乱码。
3. **固定边界防溢出**：英文标签使用紧凑缩写（如 `PEAK`、`TRACK`），与中繁文案共用同一套行高和列边界，切换语言时无需重算菜单布局坐标。

## 在 RGB565 条带画布中光栅化 1-bit 字形

在 `240×8` 的条带渲染架构下，字形绘制函数 `AppUi_DrawGlyphBits()` 只光栅化当前条带 `[stripY, stripY + 7]` 与字形外框 `[glyphY, glyphY + glyphH - 1]` 相交的那几行：

```c
static void AppUi_DrawGlyphBits(int16_t x, int16_t y,
                                uint8_t width, uint8_t height,
                                const uint8_t *bits, uint16_t color)
{
    uint8_t stride = (uint8_t)((width + 7U) >> 3U);
    uint8_t row;
    uint8_t col;

    for (row = 0U; row < height; row++)
    {
        int16_t drawY = (int16_t)(y + (int16_t)row);

        /* 仅处理落在当前 8 行条带内的扫描行 */
        if ((drawY < (int16_t)appUiCanvas.y) ||
            (drawY >= (int16_t)(appUiCanvas.y + appUiCanvas.height)))
        {
            continue;
        }

        const uint8_t *rowBits = bits + ((uint16_t)row * stride);
        uint16_t *dstRow = &appUiCanvas.pixels[(uint16_t)(drawY - (int16_t)appUiCanvas.y) * 240U];

        for (col = 0U; col < width; col++)
        {
            int16_t drawX = (int16_t)(x + (int16_t)col);
            if ((drawX >= 0) && (drawX < 240))
            {
                if ((rowBits[col >> 3U] & (uint8_t)(0x80U >> (col & 7U))) != 0U)
                {
                    dstRow[drawX] = color;
                }
            }
        }
    }
}
```

## Unicode 二分查找与字形索引检索

子集化字库按 Unicode 码点升序存储。在嵌入式 C 端，使用二分查找在 `O(log N)` 时间内完成字形定位：

```c
/* Unicode 升序索引表二分查找字形偏移 */
int32_t Font_FindGlyphIndex(const uint16_t *unicodeTable, uint16_t count, uint16_t codePoint)
{
    int32_t low = 0;
    int32_t high = (int32_t)count - 1;

    while (low <= high)
    {
        int32_t mid = low + ((high - low) >> 1);
        if (unicodeTable[mid] == codePoint)
        {
            return mid; /* 命中字形偏移索引 */
        }
        else if (unicodeTable[mid] < codePoint)
        {
            low = mid + 1;
        }
        else
        {
            high = mid - 1;
        }
    }
    return -1; /* 未收录字符，触发缺字回退 */
}
```

## 自动化字库提取与代码生成脚本

通过标准 Python 脚本解析 BDF/TTF 字体，提取文案涉及的字符并生成 C99 数组：

```python
# bdf_subset_generator.py (轻量生成流水线核心实现)
def bdf_glyph_to_c_bytes(hex_lines, width, height):
    stride = (width + 7) // 8
    c_bytes = []
    for line in hex_lines:
        row_val = int(line, 16)
        # 按 stride 拆分字节，高位在左 (MSB leftmost)
        for i in range(stride - 1, -1, -1):
            c_bytes.append((row_val >> (i * 8)) & 0xFF)
    return c_bytes

def generate_font_c_file(chars, bdf_dict, font_name, width, height):
    # 1. 按 Unicode 码点严格升序排序
    sorted_chars = sorted(list(set(chars)), key=lambda c: ord(c))
    stride = (width + 7) // 8
    print(f"/* 自动生成的 {font_name} 1-bit 点阵字库 */")
    print(f"const uint16_t {font_name}_Index[{len(sorted_chars)}] = {{")
    print("    " + ", ".join(f"0x{ord(c):04X}" for c in sorted_chars))
    print("};
")
    print(f"const uint8_t {font_name}_Bitmaps[{len(sorted_chars)} * {stride * height}] = {")
    for c in sorted_chars:
        bytes_list = bdf_glyph_to_c_bytes(bdf_dict[c], width, height)
        hex_str = ", ".join(f"0x{b:02X}" for b in bytes_list)
        print(f"    /* '{c}' U+{ord(c):04X} */ {hex_str},")
    print("};")
```

生成后的工程核查要点：

- [ ] 确认新增字符已全部收录在升序索引表中，且生成器无字符越界或缺字报警。
- [ ] 检查字模预览图，确认极小字号繁体字无笔画重叠粘连，且西文与中文字符基线对齐一致。
- [ ] 固件支持整句缺字回退保护机制，当目标语言字库缺失任一汉字时安全降级，避免屏幕显示乱码或空白块。
