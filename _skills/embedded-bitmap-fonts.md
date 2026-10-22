---
layout: skill
title: 嵌入式 LCD/OLED 点阵字库诊断、子集裁剪与生成 (embedded-bitmap-fonts)
skill_id: embedded-bitmap-fonts
description: 生成和裁剪嵌入式点阵字库，排查中文笔画粘连、基线偏移、裁切和 ARMCC 5 字符串编码问题。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: global
target: All MCU (ARMCC / Keil / GCC) + LCD/OLED/TFT
order: 6
tags:
  - 点阵字库
  - BDF
  - RGB565
  - ARMCC5
related_demo: /projects/n32g455-tensile/
---

## SKILL.md 元数据

```yaml
---
name: embedded-bitmap-fonts
description: "[Scope: global] Diagnose, generate, subset, and integrate bitmap fonts for embedded LCD/OLED/TFT UIs, especially Chinese text, blurry or merged strokes, baseline clipping, limited Flash, RGB565 strip rendering, and legacy ARMCC/Keil toolchains. Do not use for desktop typography or general image editing."
---
```

## 1. Establish the display contract first

Use this skill when an embedded display needs new text, Chinese localization, a smaller font image, or font-rendering diagnosis. Preserve the existing display driver, framebuffer model, and UI navigation unless the request explicitly includes changing them.

Before editing, inspect the screen resolution, orientation, color format, framebuffer or strip-buffer lifetime, glyph bit packing, current text encoding, and compiler/toolchain. Extract the actual on-screen strings from source and UI specification; do not compile prose from whole requirements documents into the firmware font.

Check every intended string has a glyph before integration. Treat a missing glyph as a build-time or review failure while developing; do not silently turn it into blank space in a released UI.

## 2. Choose and subset fonts

- Prefer an existing project font and existing glyph format. Keep separate sizes only when they have a clear role, such as 16 px body text, 24 px titles, and a fixed-width numeric readout.
- For small CJK text, prefer a native bitmap/BDF source when visual quality is critical. Read [references/native-bdf.md](#ref-native-bdf) when selecting or integrating BDF glyphs, diagnosing clipped baselines, or considering a bitmap size conversion.
- Treat a native bitmap size as intrinsic. Do not present a 16 px bitmap scaled by a non-integer factor as an equivalent native 24 px font: nearest-neighbor scaling makes stroke widths uneven, while interpolation followed by thresholding can merge or erase strokes. Prefer a native font at each target size, or keep the original size and preserve hierarchy through layout.
- If rasterizing a vector source is necessary, record source font, licence, pixel size, thresholding method, and the source file hash or version.
- Before tuning a monochrome threshold, generate several representative outputs and compare their bitmap bytes or hashes. Identical outputs mean the rasterizer is already producing binary coverage or the threshold is not on the effective path; stop tuning it and change the source or rasterization method instead.
- Keep the generator, generated C/H files, character manifest, and preview in sync. The generator must use repository-relative output paths and accept explicit source-font paths rather than relying solely on machine-local paths.
- Recalculate table offsets, bitmap size, glyph count, row stride, and the capacity of all index and offset types after subsetting.

## 3. Integrate with the renderer

Honor the font's bit order, row stride, variable width, and baseline. Decode UTF-8 defensively and use a sorted Unicode lookup table or another bounded, deterministic lookup suitable for the target.

Distinguish true clipping from a low-looking baseline. Inspect each glyph's ink bounds and source metrics, rasterize on a padded temporary canvas when needed, then place it into the fixed cell with an explicit baseline. Reject or report out-of-cell pixels instead of silently cropping them. Avoid solving mixed glyph extents with one unexplained global vertical shift.

For an RGB565 partial-refresh renderer, write only pixels in the active strip to its existing canvas. Clip glyph rows against the strip before iterating pixels; do not allocate a full-screen 1-bit framebuffer merely to draw text. Check title, list columns, status bar, footer hints, units, and highlighted states for clipping and overlap at their real pixel coordinates.

When adding static menu pages, keep navigation and rendering separate from settings, persistence, calibration, and communication logic unless those features are explicitly requested.

## 4. Legacy ARMCC / Keil source encoding

ARMCC5 can parse a UTF-8 source file using the active code page, even when comments display correctly. If non-ASCII narrow string literals cause invalid multibyte or missing-quote errors, encode their UTF-8 bytes as C escapes, for example `"\xE7\x94\xB5\xE9\x87\x8F"` for `电量`.

Encode all bytes in such a literal, or split adjacent literals safely: `\xNN` escapes consume following hexadecimal characters. Keep human-readable Chinese in comments, UI specifications, manifests, and generator input; the runtime string must still be UTF-8 for the decoder.

## 5. Keil and delivery checks

Add only the required font source files and include directory to the existing target; do not switch compiler version, device pack, startup code, or display driver. Build the target with its established Keil/ARMCC version and report errors and warnings separately.

Before handoff, run `git diff --check`, inspect the diff and status, verify glyph coverage, and report Flash/RAM changes when available. A successful build does not replace target-hardware checks: verify Chinese strokes, inverse/highlight states, strip boundaries, and the actual screen layout on the device. Review previews at 1:1 pixels with representative dense glyphs and real UI strings; zoomed previews are diagnostic aids, not substitutes for the target panel.

<h2 id="ref-native-bdf">参考文档：原生 BDF 点阵字库参考 (references/native-bdf.md)</h2>

### 1. 适用场景

对于 1 bit 的 LCD/OLED/TFT 文本绘制，16 px 及以下的中文字形和小号拉丁字形优先使用原生点阵。矢量字体在缩小、抗锯齿再阈值化时，细笔画与边缘像素容易消失。

原生点阵的像素尺寸属于字形设计的一部分，不等同于可任意缩放的矢量字号。希望不同字号保持风格一致时，优先寻找同一家族分别设计的原生尺寸，而不是从一个尺寸派生所有尺寸。

### 2. 实用组合

| 目标 | 可选来源 | 说明 |
| :--- | :--- | :--- |
| 16 px 中文 | GB16ST | 原生 16×16 GB2312 点阵宋体。 |
| 24 px 中文 | GB24ST | 原生 24×24 GB2312 点阵宋体。 |
| 16 px 拉丁 | Spleen 8×16 | 清晰的等宽原生点阵字形。 |
| 24 px 拉丁 | Spleen 12×24 | 与 8×16 配套的等宽原生点阵字形。 |
| 12～16 px 中文、覆盖更广 | WenQuanYi Bitmap Song | 有多种原生尺寸；先核对 GPL v2 与字体嵌入例外及项目分发要求。 |

GB16ST/GB24ST 的 BDF 使用 GB2312 GL 编码。对 Unicode 汉字先以 `gb2312` 编码为两个字节，再清除两个字节的最高位并拼成 BDF `ENCODING`：`((byte0 & 0x7F) << 8) | (byte1 & 0x7F)`。不支持的字符必须显式报告。

繁体中文还应核对地区字形。字体“覆盖某个 Unicode 码位”不代表字形适合台湾、香港或其他目标地区；优先选择明确标注地区来源的字形，并使用实际 UI 字符集验证覆盖。缺字时采用明确且一致的整串回退、替代字形或构建失败策略，不要在同一字符串中静默混用不协调的字体。

### 3. 尺寸转换

- `16→24` 是 1.5 倍非整数缩放。最近邻缩放虽然保持硬边缘，但源像素会不均匀地映射为 1 或 2 像素宽，横竖笔画容易忽粗忽细。
- 插值缩放后再二值化会产生新的灰度边缘；阈值过低容易粘连，过高容易断笔或丢失细节。
- 整数倍最近邻缩放可以保持像素拓扑，但会呈现明显的大颗粒像素风格，并占用更大的布局空间；它仍不等同于目标尺寸的原生设计。
- 需要真正的 24 px 字体时，优先使用原生 24×24 点阵，或从适合该尺寸的矢量字体直接栅格化。若一致性比标题大小更重要，可保留原生 16 px，通过颜色、留白、分隔线或背景建立层级。

在替换工程字库之前，先生成独立预览并比较原生目标尺寸、最近邻缩放和矢量栅格化版本。不要只看放大截图；同时查看 1:1 像素预览和实际屏幕。

### 4. BDF 放置规则

不要假定 BDF 位图始终从固定单元格左上角开始。对一个 `BBX width height x_offset y_offset` 的字形，固定画布以左上为原点、基线位于 `ascent` 时：

```text
left = x_offset
top  = ascent - (y_offset + bitmap_height)
```

位图行宽按 `ceil(bitmap_width / 8)` 字节读取，最高有效位通常表示最左像素；仍须以当前字体格式和既有绘制函数为准。放置后检查是否超出目标单元格，不要通过静默裁切掩盖问题。

### 5. 基线、裁切与笔画诊断

“文字偏下”和“底部被截断”需要分开确认：

1. 在带外扩区的临时画布中栅格化，记录实际墨迹边界，不要一开始就在目标单元格中裁切。
2. 使用字体 ascent、descent、基线和字形 `BBX` 计算位置，再检查顶部和底部是否存在越界像素。
3. 使用一组上下边界差异明显的实际字符验证。单个全包围结构汉字正常，不能证明所有字形都不会越界。
4. 若部分字符完整但视觉上整体偏低，检查基线和上下留白；若最底行存在墨迹且被单元格截去，才属于真实裁切。
5. 不要仅靠统一上移或下移掩盖不同字形的边界差异。确需全局偏移时，应记录来源字体、目标单元格和偏移依据，并对全部字符做越界检查。

对“相近笔画糊成一块”的问题，先确认位图是否真的随阈值变化。以多个阈值生成同一字符集并比较输出字节或 SHA-256；若完全相同，说明阈值没有进入有效栅格路径，继续调阈值没有意义。此时应改用原生点阵、关闭不合适的抗锯齿/提示方式，或更换源字体。

预览至少包含笔画密集、横画较多、底部结构复杂以及目标地区特有字形，并应额外渲染真实 UI 字符串、基线参考线和单元格边界。

### 6. 可复现性

下载的字体源应固定提交版本并记录 SHA-256。生成脚本首次下载后可缓存到临时目录；离线构建应能通过环境变量或参数指定已验证的本地 BDF 文件。最终固件只保留所需子集和许可证声明。

字符串源、字符清单、BDF 子集、生成的 C/H 文件和预览图应由同一生成入口维护。UI 字符顺序变化时，即使字符集合未变、固件字模 C 文件也未变，字符清单和预览排布仍可能变化；应明确这是排序同步，而不是字形内容变化。比较生成结果时同时检查规范化换行后的文本内容、字形集合、位图哈希和预览，不要只依赖文件原始哈希。
