---
layout: skill
title: 单页 HTML 可视化图解与视频生成 (answer-me-with-html)
skill_id: answer-me-with-html
description: 借助无依赖单文件脚本 am.mjs，将复杂架构、通信协议时序、状态机或方案对比渲染为单页交互式 HTML 图解看板或 3b1b 风格讲解视频。
category: common
category_label: 通用与工程基建
scope: global
target: Node.js 20+ / 架构图解与协议时序可视化
order: 4
tags:
  - HTML图解
  - 架构可视化
  - 协议时序
  - Node.js
---

> 来源：[QingYunA/answer-me-with-html](https://github.com/QingYunA/answer-me-with-html)（MIT 协议，v0.4.12）。模型只写一份扩展 Markdown 草稿，自带的 `scripts/am.mjs`（单文件、无依赖，需要 Node.js 20+）负责排版、配色、暗色模式和图表坐标，无需手写 HTML / CSS / SVG。

## SKILL.md 元数据

```yaml
---
name: answer-me-with-html
argument-hint: "[config [key value] | clean | update]"
description: >-
  [Scope: global] Opt-in one-page HTML explainer. Use this skill only when the current message explicitly
  invokes /answer-me-with-html, or explicitly asks for an HTML page, a visual explainer, or an
  explainer video ("make a video", "做个视频"). Do not use it proactively. Do not use it for ordinary
  explanations, architecture, comparisons, reviews, tables, or long answers unless the user asked
  for this page in the current message. Also use it when the user asks to change this skill's
  settings (config, clean, update) or its trigger policy.
---
```

## 1. 中文速查说明（中文说明.md）

### 什么时候触发

只在用户当前这条消息里明确要求时使用：

- 调用 `/answer-me-with-html`
- 明确要求 HTML 讲解页、可视化讲解，或讲解视频（“做个视频”）
- 要求修改本技能的设置或触发策略

普通解释、架构说明、对比、审查和长回答不要主动调用。

### 基本用法

````bash
node scripts/am.mjs render - <<'AM_EOF'
---
title: 标题
---
## A 面板标题
```flow
A -> B: 标签
```
AM_EOF
````

- 成功输出 `✓ <路径>`；报错 `✗ L<行号>` 会附正确示例；`STE n warnings` 是写作规范提醒。
- 只改一个面板用 `am patch page.html --panel "面板标题"`。
- **Windows PowerShell 注意事项**：不要使用管道 `Get-Content draft.md | node am.mjs render -`（PowerShell 管道会按控制台代码页重编码导致中文变成 `?`），应先将 UTF-8 草稿写入临时文件，再执行 `node scripts/am.mjs render --no-open draft.md`。

### 组件速查

| 信息形状 | 组件 | 最小语法示例 |
| :--- | :--- | :--- |
| 架构、连接关系、决策分支 | `flow [LR]` | `A -> B: label`, `A --> C` 虚线, `A -> B & C` 扇出, `{decision?}`, `group name: A, B` |
| 多方按时间收发消息（协议、时序） | `sequence [num]` | `A -> B: request`, `B --> A: response`, `note A, B: note`, `== phase ==` |
| 层级、目录、分类 | `tree [list]` | 缩进表示层级, `label \| description` |
| 历史、阶段 | `timeline [v]` | `time \| title \| description`, `*` 高亮 |
| 数值和上限 | `limits` | `label \| 13 / 20 \| unit`, `label \| max 20` |
| 逐词批注 | `annot` | `# heading \| right note`, `[span]{note}`, `[wrong]{!red note}` |
| 元数据标题块 | `kv [cols=2]` | `key: value`, `* wide cell: value` |
| 结论、警告 | `callout <info\|ok\|warn\|err> title` | Markdown 正文 |
| 多维对比 | Markdown 表格 | 状态列写 `ok` / `no` / `warn` 自动转为徽章 |

- **主题**：`auto`（默认）、`blueprint`、`shadcn`、`paper`、`3b1b`。
- **模板**：`sheet`（一屏总览，默认）、`doc`（线性阅读）。

### 在本博客中导入与统一 AI 日报风格

本站的「AI 资讯日报」基于 answer-me-with-html 生成，并通过站点脚本深度融入主站复古工程质感：

1. **生成看板**：使用 `am.mjs` 渲染出基础 HTML 文件（如 `ai-news/YYYY-MM-DD.html`）。
2. **导入与样式桥接**：执行 `node scripts/import-ai-news.mjs ai-news`。
   - 自动注入全局顶栏（`site-header`，含时钟与外观切换器）、全局底栏（`site-footer`）与路径导航。
   - 自动通过 `assets/css/ai-news.css` 桥接深色模式、网格/洞洞板/机箱纹理与毛玻璃卡片风格。
   - 自动重建 `_data/ai_news.json` 索引供首页与归档使用。

### 设置、维护与安装位置

- `am config` 查看设置；`am config set <key> <value>` 修改（`open`、`theme`、`mode`、`style`、`voice`、`update_check`）
- `am clean --dry-run` 先看要清理多少，再 `am clean`
- 生成的页面在 `~/.answer-me-with-html/` 下
- 安装命令：`npx -y skills add QingYunA/answer-me-with-html -g -y -a <agent 名>`，或放入 `%USERPROFILE%\.claude\skills\answer-me-with-html`、`%USERPROFILE%\.agents\skills\answer-me-with-html`。

## 2. SKILL.md 完整英文指令规范

### 0. When the user wants to change settings

Arguments for this call: `$ARGUMENTS`

When the arguments start with `config` (for example `/answer-me-with-html config open off`), this turn handles settings only and produces no page:

- `config`: run `am config` to show the current settings, then let the user choose (`open`, `theme`, `mode`, `style`).
- `config <key> <value>`: run `am config set <key> <value>`.
- `config reset [key]`: run `am config reset [key]`.
- `clean`: first run `am clean --dry-run` and tell the user how many items and how much space will be deleted. Run `am clean` only after the user agrees.
- `update`: run `npx skills update answer-me-with-html -y` or `git pull` depending on installation method.

### 1. Decide: produce a page or not

This skill is opt-in. Follow it only when the current user message explicitly invokes `/answer-me-with-html`, or explicitly asks for an HTML page, a visual explainer, or an explainer video.

When the user did ask for a page, produce one if any of these is true:

- There are ≥ 3 interrelated concepts, and the reader needs to see how they relate.
- There is a flow, protocol, call chain or state transition (especially with branches or several actors).
- There is a comparison across ≥ 3 dimensions, a trade-off between options, or a "can / cannot" list.
- There is a hierarchy or an evolution over time.

### 2. Draft format quick reference

```markdown
---
template: sheet     # sheet board (default, one-screen overview) | doc linear explanation
theme: auto         # auto (default) | blueprint | shadcn | paper | 3b1b
title: Title
subtitle: One-line summary     # optional
cols: 3             # most columns in a sheet row, default 3
source: RFC 9293    # any other key is shown in the page header's meta line
---
Lead: one or two sentences with the core conclusion (optional).

## A Panel title {span=2 meta="small text, top right"}
Plain Markdown: paragraphs, lists, tables, quotes.
Table status words: ok / no / warn (may carry text: "ok approved") → ✓ / ✗ / ! badges.

## B {bare}            ← bare: no title bar (suits a kv title block)
```

### 3. STE controlled writing rules

- One sentence says one thing. Use the active voice. Write steps in the imperative.
- Sentence length limits: steps (ordered lists) 20 words in English / 35 characters in Chinese; descriptions 25 words in English / 45 characters in Chinese.
- No more than 6 sentences per paragraph. Use lists for complex content.
- In Chinese, do not use light verbs (`进行优化` → `优化`, `加以说明` → `说明`), do not chain more than three `的`, and do not use clichés (`赋能`, `闭环`, `至关重要`).

### 4. Explainer videos (`am video`, 3Blue1Brown style)

Use only when the user explicitly asks for a video ("make a video", "做个视频", "3b1b style"). Lines starting with `>` are narration, one beat per line:

````bash
node "${CLAUDE_SKILL_DIR}/scripts/am.mjs" video draft.md --no-open
````

- One `## ` is one scene. Put one component in a scene as the picture, and write 2–5 narration lines below it.
- Write `[name]` in narration: the camera zooms in on the node or actor with that name and highlights it.
- Add `--mp4` to export an MP4 file (requires Chrome, ffmpeg, and Node.js 22+).
