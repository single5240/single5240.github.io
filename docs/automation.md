# 每日英语与 AI 资讯：怎么加一天

在仓库根目录执行。脚本会写入需要提交的文件，提交并推送后，GitHub Pages 会按默认 Jekyll 构建发布。不要改 `_site/`。

## 每日英语

另一边每天给出一个 `YYYY-MM-DD.json`，字段为 `date`、`sentence`、`source`（`author`、`work`、`year`、`detail`）、`translation`、`grammar`、`vocab`、`note`。文件名里的日期必须和 `date` 相同。

```bash
node scripts/import-english.mjs path/to/YYYY-MM-DD.json
```

脚本会检查 JSON，并覆盖写入：

- `_data/english/YYYY-MM-DD.json`
- `_english/YYYY-MM-DD.md`

然后提交这两个文件。首页「每日英语」卡片、`/english/YYYY-MM-DD.html` 和 `/english/index.html` 会在下次构建时带上这一天。可以一次传入多个 JSON。

## AI 资讯周报

每个工作日可能有 `YYYY-MM-DD.html`，以及可选的同名 `YYYY-MM-DD.md`。HTML 保持生成器原样即可，里面就算出现 `{{` 或 `{%` 也不会被 Jekyll 执行：导入后它是不带 front matter 的静态文件。Markdown 里的 `[文字](https://…)` 和裸链接会被抽成页面底部的「来源」。没有 Markdown，或里面没有链接时，不加来源一节。

每周一发布上一周时，把那几天的文件放在一个目录里：

```bash
node scripts/import-ai-news.mjs path/to/week-dir
```

也可以直接列出文件：

```bash
node scripts/import-ai-news.mjs path/to/2026-10-07.html path/to/2026-10-07.md
```

脚本会把页面写到 `ai-news/YYYY-MM-DD.html`（补上返回栏、标题、canonical、描述和 Open Graph；若有来源再补「来源」），并重写 `_data/ai_news.json`。周列表按周一到周日归周，新的一周在前。重复导入同一天会先去掉上次注入的栏和来源，再按当前文件重新生成。

提交 `ai-news/` 里新增或更新的 HTML，以及 `_data/ai_news.json`。
