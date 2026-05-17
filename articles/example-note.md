---
layout: article
title: 示例文章：如何上传一篇 Markdown 笔记
description: 这是一篇示例文章，用来说明以后怎么把 Markdown 笔记放到网站里。
date: 2026-05-18
category: 学习方法
tags:
  - Markdown
  - GitHub Pages
---

## 写文章

以后你可以直接在 `articles` 文件夹里新建 Markdown 文件，比如：

```text
articles/stm32-timer.md
articles/c-pointer.md
articles/qt-serial-debug.md
```

每篇文章开头保留这几行信息：

```yaml
---
layout: article
title: 文章标题
description: 文章简介，会显示在首页文章列表里
date: 2026-05-18
category: 嵌入式
tags:
  - STM32
  - 定时器
---
```

## 上传文章

把 `.md` 文件放进 `articles/` 后，执行：

```powershell
git add .
git commit -m "Add new article"
git push origin main
```

GitHub Pages 会自动把 Markdown 渲染成网页，首页也会自动识别并显示这篇文章。
