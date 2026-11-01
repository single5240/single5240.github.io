# single5240 设计系统规范 (iOS 18 Design Canon)

> 本规范基于 **Apple Human Interface Guidelines (iOS 18 & macOS Sequoia)** 与 **taste-skill** 高阶审美标准制定，定义 single5240 的全局视觉语言、毛玻璃材料系统、连续曲率（Squircle）、灵动胶囊组件与高保真交互准则。

---

## 1. 审美定位与设计原则 (Design Philosophy)

**定位**：极简高级的苹果原生工程美学（Apple-grade Engineering Aesthetics）。

- **iOS 18 层次与材料**：采用多层半透明磨砂毛玻璃材料（`backdrop-filter: blur(24px) saturate(190%)`）搭配 1px 细微发丝高光边线（Inner Hairline Bevel），呈现通透且纯净的物理纵深。
- **连续曲率超椭圆（Squircle）**：摒弃生硬的工业直角或廉价圆角，全面使用 Apple 经典的连续曲率超椭圆（容器 20px–28px，按键与状态徽标采用 9999px 极致胶囊 Pill）。
- **灵动微交互与弹性触感**：全局配备 iOS 弹性弹簧曲线（`--ease-spring: cubic-bezier(0.25, 1, 0.5, 1)`）与物理触感反馈（按压 `scale(0.96)`），拒绝生硬跳变。
- **主题与皮肤兼容**：在升级 iOS 18 设计底座的同时，完整向下兼容 5 种色彩主题（iOS 18 Light、OLED Dark、Swiss 瑞士网格、HUD 深空终端、Mono 单色）与 4 种硬件皮肤（Default、Grid、Matrix、Chassis）。

---

## 2. Taste-Skill 三大调节拨杆配置 (Aesthetic Levers)

| 拨杆参数 | 设定值 | 实施规范 |
| :--- | :--- | :--- |
| **`DESIGN_VARIANCE`** (视觉多样性与节奏) | **High (0.85)** | 采用 iOS 18 控制中心 / Bento Studio 非对称仪表盘布局。核心工作台、示波器显示舱、Inset Grouped 文章列表与侧栏 Smart Stack 小组件错落有致。 |
| **`MOTION_INTENSITY`** (动效克制与弹性) | **Fluid Spring (0.42)** | 采用苹果物理弹簧曲线 `cubic-bezier(0.25, 1, 0.5, 1)` 与轻微触觉反馈 `scale(0.96)`。Hover 位移控制在 1.5~2.5px，完全遵从 `prefers-reduced-motion` 降级策略。 |
| **`VISUAL_DENSITY`** (工艺密度与留白) | **Refined & Breathable (0.75)** | 遵循 iOS 18 层次与内嵌分组（Inset Grouped）间距体系，容器间距清晰，正文字体行高 1.85，兼顾高信息密度与极致舒适的阅读视野。 |

---

## 3. iOS 18 色彩系统与层次 (Color System & Tokens)

### 3.1 iOS 18 默认浅色主题 (iOS 18 Light — Inset Grouped 灰底托白盘)
```css
--paper: #e8e8ee;          /* 60% 苹果原生分组底色冷调中性灰 (Inset Grouped Canvas) */
--panel: #fbfbfd;          /* 苹果珍珠软白卡片表面，避免 100% 激光纯白刺眼 */
--raised-bg: rgba(252, 252, 255, 0.85); /* 厚磨砂毛玻璃材质 */
--glass-edge: rgba(60, 60, 67, 0.13);   /* 浅色卡片外轮廓精密收束线（配合内侧白高光） */
--alt-bg: #eff0f5;         /* 卡片内部次级凹槽底色 (Recessed Well) */
--subtle-bg: #ffffff;      /* 悬浮激活抬升高亮 (Pure Lift) */
--ink: #1d1d1f;            /* Apple 核心深色主字 (Charcoal Label) */
--body-copy: #333336;      /* 正文次级舒适灰 (Secondary Label) */
--muted: #6e6e73;          /* 辅助文字与微标注 (System Gray 2) */
--line: rgba(60, 60, 67, 0.14); /* 苹果发丝分割线 (Separator) */
--accent: #007aff;         /* 10% 苹果系统亮蓝 (System Blue) */
--accent-dark: #0062cc;    /* 交互深蓝 */
--warm: #ff9500;           /* 系统暖橙 (System Orange) */
--note: #ff3b30;           /* 系统警示红 (System Red) */
--success: #34c759;        /* 动态绿 (System Green) */
```

### 3.2 iOS 18 OLED 深色主题 (iOS 18 Dark)
```css
--paper: #000000;          /* 60% iOS 18 OLED 纯黑基底 */
--panel: #1c1c1e;          /* 卡片表面深灰 (System Gray 6 Dark) */
--raised-bg: rgba(28, 28, 30, 0.75); /* 深色磨砂毛玻璃 */
--glass-edge: rgba(255, 255, 255, 0.14); /* 深色发丝高光 */
--ink: #f2f2f7;            /* 纯净高亮文字 (Label Light) */
--body-copy: #aeaeb2;      /* 正文阅读次级灰 */
--muted: #8e8e93;          /* 辅助灰阶 */
--line: rgba(84, 84, 88, 0.36); /* 深色精密边线 */
--accent: #0a84ff;         /* 10% 苹果深色荧光蓝 (Neon System Blue) */
--accent-dark: #409cff;    /* 高亮荧光蓝 */
--warm: #ff9f0a;           /* 深色暖橙 */
--note: #ff453a;           /* 深色警示红 */
--success: #32d74b;        /* 动态荧光绿 */
```

---

## 4. 排版系统与 Apple 字体栈 (Grid & Typography)

### 4.1 字体家族
```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", sans-serif;
--font-mono: "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
```

### 4.2 字阶规范
- **Hero 大标题**：`font-size: clamp(28px, 3.8vw, 42px); letter-spacing: -0.03em; font-weight: 750; line-height: 1.25;`
- **H2 章节标题**：`font-size: 24px; letter-spacing: -0.025em; font-weight: 750;`
- **H3 小组标题**：`font-size: 18px; letter-spacing: -0.015em; font-weight: 700;`
- **胶囊标签 (Pill Tag)**：`font-size: 11.5px; font-weight: 600; border-radius: 9999px;`
- **正文阅读**：`font-size: 17px; line-height: 1.85; -webkit-font-smoothing: antialiased;`

---

## 5. 毛玻璃与微立体表面 (Glass Materials & Elevation)

```css
/* iOS 18 浅色毛玻璃与漫反射投影 */
--panel-bevel: inset 0 1px 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 0 rgba(0, 0, 0, 0.03);
--shadow-small: 0 2px 8px -2px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
--shadow: 0 8px 28px -6px rgba(0, 0, 0, 0.06), 0 2px 8px -2px rgba(0, 0, 0, 0.03);
--shadow-heavy: 0 20px 48px -10px rgba(0, 0, 0, 0.12), 0 4px 16px -2px rgba(0, 0, 0, 0.04);
--glass: blur(24px) saturate(190%);

/* iOS 18 深色毛玻璃与多层深邃投影 */
--panel-bevel: inset 0 1px 0 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 0 rgba(0, 0, 0, 0.6);
--shadow-small: 0 2px 8px -1px rgba(0, 0, 0, 0.45);
--shadow: 0 12px 36px -8px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.35);
--shadow-heavy: 0 24px 64px -12px rgba(0, 0, 0, 0.85);
--glass: blur(28px) saturate(180%);
```

---

## 6. iOS 18 标志性组件形态 (Signature Components)

1. **灵动岛胶囊状态栏 (Dynamic Island Capsule)**：
   - 顶部右上角系统状态芯片采用极小 `height: 28px` 的悬浮药丸胶囊，包含呼吸脉冲状态绿灯与等宽时间表。
2. **分段胶囊导航栏 (Segmented Pill Nav)**：
   - 导航链接采用 iOS 原生 Segmented Control 设计，激活项呈现微投影白色悬浮胶囊，切换带平滑弹性阻尼。
3. **App 图标圆角微光 (Squircle App Brand)**：
   - 站点 Logo 采用 14px 连续曲率超椭圆图标，配以温润渐变与发光微倒角。
4. **macOS Sequoia 代码窗口 (Code Window)**：
   - 代码块顶端内置真实的三色交通灯红黄绿微光圆点（`#ff5f56`, `#ffbd2e`, `#27c93f`），并配备胶囊复制按钮。
5. **Inset Grouped 设置列表与 Smart Stack 侧栏**：
   - 文章列表采用类似 iOS 设置的 Inset Grouped 扁平化内嵌卡片设计，带有触感高亮与悬浮位移。
6. **iOS 18 动态壁纸光晕 (Ambient Aura Mesh)**：
   - 背景层融入多点径向弥散光晕（Apple Blue, Indigo, Amber, Emerald），呈现细腻柔和的壁纸通透感。

---

## 7. 反 AI 模板味与质量准则 (Anti-Slop Checklist)

- [x] **杜绝千篇一律的生硬大圆角**：采用 Apple 标准连续曲率超椭圆（20px–28px）与 9999px 药丸胶囊，严禁随意出现无规律的各种突兀圆角。
- [x] **杜绝死白与无脑粗黑阴影**：背景使用 `#f2f2f7`，投影采用多层低不透明度漫反射与 1px 细微发丝高光。
- [x] **杜绝机械生硬动画**：所有交互必须基于 `--ease-spring` 弹簧曲线并配合 `:active` 触感缩放。
- [x] **无障碍与多主题兼容**：严格保留 `prefers-reduced-motion` 降级、清晰的 `:focus-visible` 焦点环以及所有 5 种预置色彩主题与硬件皮肤。
