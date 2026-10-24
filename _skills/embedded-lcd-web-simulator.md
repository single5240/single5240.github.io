---
layout: skill
title: 嵌入式点阵屏固件 1:1 网页交互模拟器 (embedded-lcd-web-simulator)
skill_id: embedded-lcd-web-simulator
description: 将固件中的点阵字库、界面和按键流程做成浏览器演示，用模拟输入替代传感器数据。
category: common
category_label: 通用与工程基建
scope: global
target: 带 LCD/OLED 屏幕与按键的单片机仪器工程
order: 4
tags:
  - 网页模拟器
  - 点阵字库
  - RGB565
  - 交互演示
related_demo: /projects/n32g455-tensile/
---

## SKILL.md 元数据

```yaml
---
name: embedded-lcd-web-simulator
description: >-
  [Scope: global] 将嵌入式 LCD/OLED 固件的 C 语言点阵字库、RGB565 界面布局、实体按键短/长按与测量状态机 1:1 复刻为免服务器纯前端互动演示网页。
  当用户需要为带屏幕的单片机仪器制作客户互动演示 Demo、在无硬件时快速对齐 UI 菜单与按键交互、或同步固件功能到网页模拟器时使用此技能。
---
```

## 1. 适用范围

- **技术方向**：`common`
- **使用范围 (Scope)**：`global`（全嵌入式通用，提炼自数显式拉力计 `html/` 互动演示工程）
- **交付形态**：纯静态 `html/` 目录（双击 `index.html` 直接以 `file://` 运行，零后端服务器依赖），独立于 Keil `.uvprojx` 编译目标。

## 2. 网页演示的实现边界

网页演示保留固件的界面布局、字库和按键流程。传感器输入、存储和时钟由浏览器提供替代实现，各部分的处理方式如下：

| 维度 | 需对齐固件的界面与交互 | 网页端替代实现 |
| :--- | :--- | :--- |
| **显示与字库** | 从固件 `font_*.c` 自动抽取点阵生成 `fonts.js`；Canvas 逻辑分辨率严格对齐屏幕（如 `240×320`）并整数倍放大显示；RGB565 配色与裁剪区域完全一致 | 不模拟 SPI 8 行条带 DMA 拆分传输；直接用 `ImageData` / Canvas 2D 整帧绘制 |
| **按键与传感器** | 复刻实体键（如 `ZERO / UNIT / DATA / MENU / PWR`）短按、2s/5s 长按释放逻辑；右侧提供**传感器竖向滑块 + 精确数值锁存输入框 + 外部接点/朝向开关** | 用浏览器 `requestAnimationFrame` + `performance.now()` 替代 `SysTick` 与 `IWDG` |
| **业务与测量状态机** | 1:1 对齐固件的峰值测试动作（拉伸/压缩/插拔/接点/破断/按键测试）、公差 `-NG/OK/+NG` 判定、多语言 (`zh-CN/en/zh-TW`)、单位换算与六点校准流程 | 校准页将滑块/输入框的毫牛反算为伪 ADC 码送入同一套六点状态机 |
| **存储与参数持久化** | 保留完全相同的保存准入、完成 1s 自动保存、单条删除、连续显示序号 `1~N`、每页 5 条列表与满容量拒绝提示 | **严禁把 W25Q128 扇区扫描/稀疏迁移或 M24C02 双槽 CRC 翻译进 JS**；直接用 JS 数组 + `localStorage` 持久化 |

> 模块依赖图、`font_*.c` 点阵自动抽取脚本与打包流程详见 [references/simulator-architecture-and-font-extract.md](#ref-simulator-arch)。

## 3. 操作步骤

1. **建立事实源映射**：
   - 先读取固件 UI 主文件（如 `app_ui_home.c`）、菜单设置（`app_settings.c`）、测量状态机（`app_test.c`）与字库文件（`font/*.c`）。源码与旧文档不一致时，画面和交互一律以当前参与编译的 C 源码为准。
2. **编写脚本自动提取固件点阵字 (`tools/extract_fonts.mjs`)**：
   - 解析固件 `font_16.c`、`font_24.c`、`font_num_40.c` 等文件中的字形元数据与位图数组，生成 `js/fonts.js`，**严禁手写篡改点阵或用浏览器系统矢量字体冒充嵌入式点阵字**。
3. **分层构建前端模块（对标固件 `APP` 分层）**：
   - `js/screen.js`：封装 RGB565 转 CSS/RGBA、矩形、裁剪折线与点阵字光栅化（支持 0° / 180° 屏幕翻转）。
   - `js/force.js` & `js/tests.js` & `js/waveform.js`：传感器输入合成、零点死区回滞、五种峰值动作状态机与 201 点滚动/固定波形窗口。
   - `js/settings.js` & `js/records.js` & `js/calibration.js`：与固件字段一一对应的设置、记录列表（`localStorage`）与双层六点校准状态机。
   - `js/ui.js`：**只读业务快照、只投递按键事件**，不直接篡改测量或校准模块的内部状态变量。
4. **避免 ES Module `file://` 跨域报错**：
   - 为保证客户双击 `index.html` 即可在 Chrome/Edge 直接运行，通过标准 `<script>` 标签按依赖顺序加载并挂载到单一全局命名空间，或提供一键打包单文件脚本（如 `package-demo.ps1`）。

## 4. 关键质量检查清单

- [ ] **点阵基线与三语裁剪一致**：切换简体中文、英文、台湾繁体时，长文字列（如底部动作名、存储提示、公差判定）与固件保持相同的像素边界裁剪，绝不重叠。
- [ ] **长按防连发与跨页松手重计时**：如从首页长按 `DATA` 2s 进入存储列表后，不松手继续按住不得直接触发列表页的“长按 5s 清空全部”，必须等待松手后重新计时。
- [ ] **固件同步机制**：当固件修改了菜单项位置（如将背光改为六档、传输速度移入通信设定）或新增按键测试模式时，同步更新 `html/js/` 对应模块。

## 5. 验证方法

1. **双击离线运行检查**：在无 Web Server 的本地文件夹中双击 `html/index.html`，打开浏览器控制台确认 `0 Error`、无 CORS 拦截。
2. **核心交互走查**：依次拖动滑块与锁定输入框验证五种峰值测量 → 手动/自动保存与列表单条删除 → 菜单各子页编辑与刷新保持 → 校正系统密码与六点采点流程。

<h2 id="ref-simulator-arch">参考文档：网页模拟器模块架构与点阵提取指南 (references/simulator-architecture-and-font-extract.md)</h2>

### 1. 目录结构与单向数据流

```text
html/
├── index.html              # 仪器机壳外观、240×320 Canvas 画布、5 个实体按键、右侧传感器滑块/力值输入框/接点与朝向开关
├── js/
│   ├── fonts.js            # 由 tools/extract_fonts.mjs 从固件 font_*.c 自动生成
│   ├── screen.js           # 240×320 逻辑帧缓冲、RGB565 颜色转换、点阵字绘制、矩形与裁剪折线、180° 翻转
│   ├── force.js            # 滑块/锁定输入合成、零点死区回滞、重力加速度与单位换算 (N / kgf / lbf / ozf)
│   ├── waveform.js         # 201 点滚动/固定窗口与动态量程缩放
│   ├── tests.js            # 实时 10s 峰值及压缩/拉伸/插拔/接点保持/破断/按键测试状态机
│   ├── settings.js         # 与固件 AppSettingsData 完全同构的配置项 + localStorage 持久化
│   ├── records.js          # 记录保存去重、列表 5 条分页、正反序、单条删除与清空 + localStorage
│   ├── calibration.js      # 密码校验、大小量程/拉压方向选择、六点稳定窗口采集与提交
│   └── ui.js               # 页面状态机与像素级绘制（只读快照、只投事件）
└── tools/
    └── extract_fonts.mjs   # 从 C 源码提取点阵字模的 Node.js 脚本
```

模块间单向数据流关系：

```text
[实体按键短/长按 + 传感器滑块/输入框 + 接点/朝向开关]
        │
        ▼
  force.js (毫牛合成与单位换算)
   ├──► tests.js (峰值动作状态机 & 完成快照) ──► records.js (保存/删除/分页 localStorage)
   ├──► waveform.js (201 点波形)
   └──► calibration.js (六点标定状态机)
        │
        ▼  (汇总快照 + settings.js 菜单配置)
     ui.js (页面路由与布局)
        │
        ▼
  screen.js + fonts.js (240×320 Canvas 点阵渲染)
```

### 2. 从固件 C 字库自动提取点阵 (`extract_fonts.mjs` 核心思路)

嵌入式字库通常包含 `glyphs[]` 描述表（含 Unicode 码点、`width`、`height`、`advance`、`dwidth`、`x_offset`、`y_offset`、`bitmap_offset`）和 `bitmaps[]` 字节数组：

1. 使用正则表达式匹配 `font_*.c` 中的 `static const uint8_t ..._bitmaps[] = { ... }`，提取所有十六进制字节转为 `Uint8Array`（或 Base64 字符串以减小体积）。
2. 匹配 `static const ..._glyph_t ..._glyphs[] = { ... }`，解析每行的 `{ codepoint, width, height, ... }`。
3. 输出为可直接由页面 `<script>` 标签加载的 `js/fonts.js` 对象，确保网页上的每一个汉字、数字和符号与实物 LCD 屏幕逐像素一致。

### 3. 传感器外设的网页控件映射规范

1. **连续载荷模拟（竖向滑块 + 数值保持输入框）**：
   - 滑块范围覆盖 `[-FS, +FS]`，松手可配置自动回零或保持；
   - 数值输入框支持直接键入精确力值（用于测试公差边界和六点标定稳定采点），写入后进入“锁存保持”状态，直到用户点击“释放/回零”或再次拖动滑块。
2. **开关量/外部中断模拟（如 `PA11 / INSER` 接点信号）**：
   - 用网页上的拨动开关或点动按钮模拟，内部经过与固件一致的 `10 ms` 去抖状态机，生成上升沿/下降沿事件送入接点保持测试模块。
3. **重力感应翻转模拟**：
   - 提供“正向 / 反向”切换开关，仅当系统菜单中“屏幕方向”设为“自动”时生效，触发 Canvas 180° 旋转重绘。
