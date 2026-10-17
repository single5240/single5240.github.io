# 每日英语与 AI 资讯：怎么加一天

在仓库根目录执行。脚本会写入需要提交的文件，提交并推送到 main 后，Site quality and Pages 工作流先构建、检查，再发布通过检查的 `_site/` 产物。不要手动修改 `_site/`。

## 本地验证与发布

```bash
bundle install
bundle exec jekyll build --strict_front_matter
node scripts/check-site.mjs
node --test scripts/import-ai-news.test.mjs
git diff --check
```

GitHub Pages 的发布源需要选择 GitHub Actions。工作流的 deploy 作业依赖 build-and-check，构建或检查失败时不会发布；拉取请求只做验证，不部署。原始 articles、english、ai-news 和项目演示地址保持可用。

Windows 没有 Ruby 时，可在已安装 Ruby/Bundler 的 WSL 中执行构建，再在 Windows 运行 Node 检查。`vendor/`、`.bundle/`、`_site/` 和 Gemfile.lock 均为本地构建状态，不应提交。

## 页面与内容维护

- 公共外壳：`_layouts/default.html`，公共 head/header/footer 位于 `_includes/`。首页和文章不再复制站点导航。
- 导航：`_data/navigation.yml`。专题：`_data/topics.yml`，每项 articles 写已有文章的文件名（去掉 `.md`）；文章可归入多个专题。项目：`_data/projects.yml`。
- 首页精选：`index.html` 中的 featured_slugs。新增技术文章只需遵守 AGENTS.md 的 front matter 约定，归档、Feed、search.json 自动更新。
- 文章可选字段：`updated`（实际内容更新日期）、`series`（系列名称）、`status`（文档完善状态）。不填写时不会显示空占位；文档状态不代表硬件验证状态。
- 搜索覆盖技术文章的标题、摘要和全部标签，支持空格分隔的多个关键词及专题组合；查询保存在 URL，可直接分享。搜索索引加载失败时退回页面文字筛选，无 JavaScript 时仍有完整列表与专题入口。
- 项目演示独立加载，避免全站样式或搜索脚本干扰模拟器；全站不加载模拟器代码。
- AI 日报保持无 front matter 的独立 HTML。导入器维护顶部站点导航、元信息与来源，`news-theme.js` 只将网站深浅偏好映射到日报 data-mode，保留日报自己的 data-theme 与布局。日报模式下拉框的选择会同步回网站偏好。

## 每日英语

另一边每天给出一个 `YYYY-MM-DD.json`，字段为 `date`、`sentence`、`source`（`author`、`work`、`year`、`detail`）、`translation`、`grammar`、`vocab`、`note`。文件名里的日期必须和 `date` 相同。

```bash
node scripts/import-english.mjs path/to/YYYY-MM-DD.json
```

脚本会检查 JSON，并覆盖写入：

- `_data/english/YYYY-MM-DD.json`
- `_english/YYYY-MM-DD.md`

然后提交这两个文件。首页「每日英语」卡片、`/english/YYYY-MM-DD.html` 和 `/english/index.html` 会在下次构建时带上这一天。可以一次传入多个 JSON。

## AI 资讯日报

每天一篇，文件是 `YYYY-MM-DD.html`，以及可选的同名 `YYYY-MM-DD.md`。HTML 保持生成器原样即可，里面就算出现 `{{` 或 `{%` 也不会被 Jekyll 执行：导入后它是不带 front matter 的静态文件。Markdown 里的 `[文字](https://…)` 和裸链接会被抽成页面底部的「来源」。没有 Markdown，或里面没有链接时，不加来源一节。

每天导入新的一天。把当天的 HTML 和可选的 Markdown 放在一个目录里：

```bash
node scripts/import-ai-news.mjs path/to/news-dir
```

也可以一次列出多个文件：

```bash
node scripts/import-ai-news.mjs path/to/2026-10-07.html path/to/2026-10-07.md
```

脚本会把页面写到 `ai-news/YYYY-MM-DD.html`（补上返回栏、标题、canonical、描述和 Open Graph；若有来源再补「来源」），并重写 `_data/ai_news.json`。周列表按周一到周日归周，新的一周在前。重复导入同一天会先去掉上次注入的栏和来源，再按当前文件重新生成。

提交 `ai-news/` 里新增或更新的 HTML，以及 `_data/ai_news.json`。
