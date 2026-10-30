# single5240 设计系统规范 (Design System Canon)

> 本规范基于 **VoltAgent/awesome-design-md** 架构与 **taste-skill** 高阶审美标准制定，定义 single5240 工程笔记与实验室的全局视觉语言、设计 Token、布局节奏与反劣质模板（Anti-Slop）准则。

---

## 1. 品牌气质与审美定位 (Design Philosophy)

**定位**：精密工业仪器、现代工程师工作台与交互实验平台（Industrial Precision meets Modern Software Studio）。

- **克制理性**：借鉴 Linear、Vercel 与高端硬件仪表面板（如 Keysight / Tektronix 示波器），追求极高的信息密度、清晰的视觉层级和经得起推敲的像素级细节。
- **真实工程质感**：提供 4 种硬件皮肤（工程坐标网格、洞洞板覆铜阵列、复古仪器前面板、清爽素雅）与 5 种色彩主题（浅色纸感、深邃黑曜石、瑞士网格、深空终端、极简单色）。
- **拒绝 AI 劣质模板（Anti-Slop）**：坚决摒弃千篇一律的大圆角、空洞大留白、滥用蓝紫渐变和无脑白底重阴影。

---

## 2. Taste-Skill 三大调节拨杆配置 (Aesthetic Levers)

| 拨杆参数 | 设定值 | 实施规范 |
| :--- | :--- | :--- |
| **`DESIGN_VARIANCE`** (视觉多样性与节奏) | **High (0.85)** | 采用非对称 Bento-Grid 仪表台布局，打破单调平铺。核心控制台、示波器显示舱、工程实战流与侧栏遥测形成错落有致的视觉韵律。 |
| **`MOTION_INTENSITY`** (动效克制感) | **Restrained (0.35)** | 全局禁用生硬线性动画或浮夸旋转。所有过渡统一采用物理阻尼曲线 `cubic-bezier(0.16, 1, 0.3, 1)`，Hover 位移控制在 1.5~2.5px，Active 按压设置 `scale(0.985)` 触感反馈。 |
| **`VISUAL_DENSITY`** (工艺密度与留白) | **Dense & Breathable (0.78)** | 紧凑而舒适的工程信息密度，严格遵循 8px 栅格与 4px 微调步进，绝无空洞无意义的大面积纯白空白。 |

---

## 3. 色彩系统与层次 (Color System & Contrast)

遵循 **60-30-10** 配色法则（60% 基底背景、30% 结构次级、10% 点睛高对比色），严禁任何主题下使用刺眼的纯黑 `#000000`。

### 3.1 默认浅色主题（Modern Clean Paper）
```css
--paper: #f8fafc;          /* 60% 现代温润纸感基底 (Slate-50) */
--panel: #ffffff;          /* 纯净卡片表面 */
--ink: #0f172a;            /* 30% 高对比深邃主文字 (Slate-900) */
--body-copy: #334155;      /* 正文次级灰 (Slate-700) */
--muted: #64748b;          /* 辅助说明/等宽时间戳 (Slate-500) */
--line: #e2e8f0;           /* 精细发丝边框 1px */
--accent: #0d9488;         /* 10% 核心点睛工程青 (Teal-600) */
--accent-dark: #0f766e;    /* 核心点睛深青 (Teal-700) */
--warm: #d97706;           /* 暖色指示/硬件警告 (Amber-600) */
--alt-bg: #f1f5f9;         /* 浅色嵌套背景块 */
--subtle-bg: #f8fafc;      /* 悬浮轻量高亮 */
```

### 3.2 默认深色主题（Obsidian Navy Slate）
```css
--paper: #0b0f17;          /* 60% 深邃黑曜石冷黑，杜绝纯黑或发绿死黑 */
--panel: #111827;          /* 卡片表面深灰 (Gray-900) */
--ink: #f8fafc;            /* 30% 亮白主文本 */
--body-copy: #cbd5e1;      /* 舒适阅读次级文字 (Slate-300) */
--muted: #94a3b8;          /* 辅助灰阶 (Slate-400) */
--line: #1e293b;           /* 深色精密边框 */
--accent: #14b8a6;         /* 10% 霓虹微发光青 (Teal-500) */
--accent-dark: #2dd4bf;    /* 高亮荧光青 (Teal-400) */
--warm: #fbbf24;           /* 暖色信号 */
--alt-bg: #151d2c;         /* 嵌套代码与 HUD 背景 */
--subtle-bg: #1a2334;      /* 列表悬浮高亮 */
```

---

## 4. 栅格与排版系统 (Grid & Typography)

### 4.1 8px 网格规范
- **微间距**：`4px` (小 Tag 内部 padding、状态灯间隙)
- **标准间距**：`8px` (组件内元素间隙、Meta 间隙)
- **卡片内衬**：`12px` / `16px` / `20px` / `24px`
- **区块与栅格 Gap**：`16px` / `24px` / `32px` / `48px`

### 4.2 字体排印法则
- **字体栈**：
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace;
  ```
- **字阶与字距（Tracking）**：
  - **Hero 主标题**：`font-size: clamp(28px, 3.4vw, 38px); letter-spacing: -0.03em; font-weight: 800; line-height: 1.25;`
  - **H2 章节标题**：`font-size: 24px; letter-spacing: -0.025em; font-weight: 750;`
  - **H3 卡片标题**：`font-size: 18px; letter-spacing: -0.015em; font-weight: 700;`
  - **Eyebrow / 标签**：`font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;`
  - **正文阅读**：`font-size: 16px; line-height: 1.8; -webkit-font-smoothing: antialiased;`

---

## 5. 卡片表面与微立体层次 (Surfaces & Elevation)

淘汰生硬、单一的粗黑阴影，采用 Linear / Vercel 标准的多层漫反射分层投影与上边缘 1px 细微高光：

```css
/* 浅色模式立体层次 */
--panel-bevel: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(0, 0, 0, 0.03);
--shadow-small: 0 1px 2px rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.06);
--shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 8px 24px -4px rgba(15, 23, 42, 0.08);
--shadow-hover: 0 4px 6px -1px rgba(15, 23, 42, 0.05), 0 16px 36px -6px rgba(13, 148, 136, 0.16);

/* 深色模式立体层次 */
--panel-bevel: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.5);
--shadow-small: 0 1px 3px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.35);
--shadow: 0 2px 5px rgba(0, 0, 0, 0.45), 0 12px 32px -4px rgba(0, 0, 0, 0.6);
--shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.5), 0 20px 48px -6px rgba(20, 184, 166, 0.22);
```

---

## 6. 交互状态完备性 (Tactile States)

每个可交互组件（按钮、卡片、导航项、列表项）必须具备完整五态反馈：

1. **Normal**：精致 1px 细线、柔和内反光与基础层次投影。
2. **Hover**：
   - 边框轻微提亮并染上 `--accent`（`border-color: var(--accent)`）。
   - 卡片向上平滑位移 `translateY(-2px)`，投影延展为 `--shadow-hover`。
   - 箭头指示符微位移 `transform: translate(2px, -2px)`。
3. **Active (按压)**：
   - 产生真实的硬件阻尼触感：`transform: scale(0.985) translateY(1px);`。
4. **Focus-Visible**：
   - 无障碍高对比对齐：`outline: 2px solid var(--accent); outline-offset: 2px;`。
5. **Loading / Disabled**：
   - 不透明度衰减至 `0.6`，鼠标指示 `not-allowed`，关闭位移动画。

---

## 7. 反 AI 模板味检查清单 (Anti-Slop Checklist)

在任何新页面、组件或样式修改时，检查是否违反以下反模式：

- [x] **无纯黑背景**：深色模式背景不是 `#000`，而是深邃有质感的冷灰 `#0b0f17`。
- [x] **无泛滥渐变**：渐变仅用于 1px 发丝边线或文字局部高光，绝不大面积铺设无意义蓝紫渐变底色。
- [x] **无生硬跳变**：所有过渡均挂载 `cubic-bezier(0.16, 1, 0.3, 1)`，避免线性拖沓。
- [x] **等宽字体秩序**：时间、版本号、代码、HUD 频率、指示状态必须使用统一的 monospace 栈。
- [x] **状态反馈闭环**：所有 hover 必须配合 active 按压缩放与 focus-visible 环。
