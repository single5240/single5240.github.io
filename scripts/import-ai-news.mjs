import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const newsDir = join(repoRoot, "ai-news");
const dataPath = join(repoRoot, "_data", "ai_news.json");
const datePattern = /^(\d{4}-\d{2}-\d{2})\.html$/;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function utcDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function weekdayLabel(value) {
  return WEEKDAYS[utcDate(value).getUTCDay()];
}

export function mondayOf(value) {
  const utc = utcDate(value);
  const day = utc.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

function addDays(value, count) {
  const utc = utcDate(value);
  utc.setUTCDate(utc.getUTCDate() + count);
  return utc.toISOString().slice(0, 10);
}

function siteOrigin() {
  const config = readFileSync(join(repoRoot, "_config.yml"), "utf8");
  const match = config.match(/^url:\s*(\S+)\s*$/m);
  if (!match) throw new Error("_config.yml: missing url");
  return match[1].replace(/\/$/, "");
}

function stripMarker(html, name) {
  return html.replace(new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->\\n?`, "g"), "");
}

function stripUnmanagedMeta(html) {
  return html
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");
}

function pageTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  if (!match) throw new Error("missing <title>");
  return unescapeHtml(match[1]).replace(/\s*\|\s*single5240\s*$/, "").trim();
}

function pageSummary(html, title) {
  const intro = html.match(/<div class="am-intro\b[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  const raw = intro ? intro[1].replace(/<[^>]+>/g, "") : title;
  return unescapeHtml(raw).replace(/\s+/g, " ").trim().slice(0, 180);
}

export function extractSources(markdown) {
  const links = [];
  const seen = new Set();
  const without = markdown.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_all, label, url) => {
    const clean = url.trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      links.push({ label: label.trim() || clean, url: clean });
    }
    return " ";
  });
  for (const match of without.matchAll(/https?:\/\/[^\s<>)\]]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      links.push({ label: url, url });
    }
  }
  return links;
}

function chromeBlock({ title, description, canonical }) {
  const origin = siteOrigin();
  const image = `${origin}/assets/images/engineer-computer-lineart.jpg`;
  return `<!-- s5-news-chrome:start -->
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#f8faf7">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="嵌入式开发工作台插画">
<meta property="og:site_name" content="single5240 笔记分享">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/atom+xml" title="技术笔记 RSS" href="/feed.xml">
<script src="/assets/js/theme.js?v=20261018"></script>
<link rel="stylesheet" href="/assets/css/base.css?v=20261018">
<link rel="stylesheet" href="/assets/css/site.css?v=20261018">
<link rel="stylesheet" href="/assets/css/ai-news.css?v=20261018">
<!-- s5-news-chrome:end -->`;
}

function headerBlock() {
  return `<!-- s5-news-header:start -->
<div class="site-ambience" aria-hidden="true"></div>
<a class="skip-link" href="#main-content">跳到主要内容</a>
<header class="site-header">
  <nav class="nav" aria-label="主导航">
    <a class="brand" href="/" aria-label="single5240 首页"><span class="brand-mark" aria-hidden="true">s5<span>.</span></span><span>single5240<span class="brand-caption"> / 工程笔记</span></span></a>
    <div class="nav-actions">
      <div class="nav-links">
        <a href="/">首页</a>
        <a href="/articles/index.html">文章</a>
        <a href="/projects/index.html">项目</a>
        <a href="/tools/index.html">工具</a>
        <a href="/daily/index.html" aria-current="page">日常</a>
        <a href="/about/index.html">关于</a>
      </div>
      <div class="system-status" aria-label="系统运行状态与北京时间" title="硬件心跳与系统时间">
        <span class="status-pulse" aria-hidden="true"></span>
        <span class="status-time" id="statusClock">--:--</span>
        <span class="status-tag">BJT</span>
      </div>
      <a class="search-link" href="/articles/index.html#search" aria-label="搜索文章"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></a>
      <div class="theme-picker" data-theme-picker></div>
    </div>
  </nav>
</header>
<!-- s5-news-header:end -->`;
}

function subbarBlock(weekId, date) {
  return `<!-- s5-news-subbar:start -->
<div class="ai-news-subbar-wrap">
  <div class="ai-news-subbar">
    <nav class="ai-news-breadcrumb" aria-label="路径导航">
      <a href="/daily/index.html">日常</a>
      <span class="sep" aria-hidden="true">/</span>
      <a href="/ai-news/index.html">AI 资讯</a>
      <span class="sep" aria-hidden="true">/</span>
      <a href="/ai-news/index.html#week-${weekId}">周汇总 (${weekId})</a>
      <span class="sep" aria-hidden="true">/</span>
      <span class="current">${date}</span>
    </nav>
  </div>
</div>
<!-- s5-news-subbar:end -->`;
}

function sourcesBlock(links) {
  if (!links.length) return "";
  const items = links.map((link) => `    <li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} ↗</a></li>`).join("\n");
  return `<!-- s5-news-sources:start -->
<section class="s5-news-sources" aria-label="参考来源">
  <h2>参考来源</h2>
  <ol>
${items}
  </ol>
</section>
<!-- s5-news-sources:end -->
`;
}

function footerBlock() {
  return `<!-- s5-news-footer:start -->
<footer class="site-footer" id="contact">
  <div><a class="footer-brand" href="/">single5240</a><p>© 2026 · Jekyll &amp; GitHub Pages</p></div>
  <nav aria-label="辅助导航"><a href="/about/index.html">关于与联系</a><a href="/feed.xml">RSS</a><a href="https://github.com/single5240" target="_blank" rel="noopener noreferrer">GitHub ↗</a><a href="/board.html">板子项目</a></nav>
</footer>
<script src="/assets/js/motion.js?v=20261018" defer></script>
<!-- s5-news-footer:end -->`;
}

export function prepareNewsHtml(html, { date, sources }) {
  if (/^\uFEFF?---\r?\n/.test(html)) {
    throw new Error(`${date}: HTML starts with front matter; leave it as a static page so Liquid is not executed`);
  }
  let next = html;
  const markers = [
    "s5-news-chrome",
    "s5-news-header",
    "s5-news-subbar",
    "s5-news-bar",
    "s5-news-sources",
    "s5-news-footer",
  ];
  for (const marker of markers) {
    next = stripMarker(next, marker);
  }
  next = stripUnmanagedMeta(next);

  next = next.replace(/<html\b[^>]*>/i, '<html lang="zh-CN" data-theme="light" data-skin="grid">');

  const title = pageTitle(next);
  const description = pageSummary(next, title) || title;
  const canonical = `${siteOrigin()}/ai-news/${date}.html`;
  const weekId = mondayOf(date);

  if (!next.includes("</head>") || !next.includes("<body") || !next.includes("</main>")) {
    throw new Error(`${date}: expected </head>, <body>, and </main>`);
  }

  next = next.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)} | single5240</title>`);
  next = next.replace(/\s*<\/head>/i, `\n${chromeBlock({ title, description, canonical, weekId })}\n</head>`);
  next = next.replace(/<body([^>]*)>\s*/i, `<body$1>\n${headerBlock()}\n${subbarBlock(weekId, date)}\n`);

  next = next.replace(/<main\s+class="am-sheet"([^>]*)>/i, (match, rest) => {
    if (rest.includes("id=")) return match;
    return `<main class="am-sheet"${rest} id="main-content">`;
  });

  const sourceHtml = sourcesBlock(sources);
  if (sourceHtml) {
    next = next.replace(/\s*<\/main>/i, `\n${sourceHtml}</main>`);
  }

  next = next.replace(/\s*<\/body>/i, `\n${footerBlock()}\n</body>`);

  return { html: next, title, description, weekId };
}

function htmlInputs(args) {
  const htmls = new Set();
  for (const arg of args) {
    const full = resolve(arg);
    let info;
    try {
      info = statSync(full);
    } catch {
      throw new Error(`not found: ${arg}`);
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(full)) {
        if (datePattern.test(name)) htmls.add(join(full, name));
      }
      continue;
    }
    if (full.endsWith(".html")) {
      htmls.add(full);
      continue;
    }
    if (full.endsWith(".md")) {
      const html = full.slice(0, -3) + ".html";
      if (!statSync(html, { throwIfNoEntry: false })) throw new Error(`missing HTML beside ${arg}`);
      htmls.add(html);
      continue;
    }
    throw new Error(`expected a directory, .html, or .md: ${arg}`);
  }
  return [...htmls].sort();
}

function companionMarkdown(htmlPath, rawHtml = "") {
  const markdownPath = htmlPath.replace(/\.html$/, ".md");
  try {
    return readFileSync(markdownPath, "utf8");
  } catch {
    const match = rawHtml.match(/<textarea[^>]*\bid=["']am-source["'][^>]*>([\s\S]*?)<\/textarea>/i)
      || rawHtml.match(/<script[^>]*\bid=["']am-source["'][^>]*>([\s\S]*?)<\/script>/i);
    if (match) {
      return unescapeHtml(match[1]);
    }
    return "";
  }
}

export function rebuildNewsIndex() {
  mkdirSync(newsDir, { recursive: true });
  const days = readdirSync(newsDir)
    .filter((name) => datePattern.test(name))
    .map((name) => name.slice(0, 10))
    .filter((date) => isRealDate(date))
    .sort();
  const weeks = new Map();
  for (const date of days) {
    const html = readFileSync(join(newsDir, `${date}.html`), "utf8");
    const title = pageTitle(html);
    const description = unescapeHtml((html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [])[1] || title);
    const weekId = mondayOf(date);
    if (!weeks.has(weekId)) {
      weeks.set(weekId, {
        id: weekId,
        label: `${weekId} 至 ${addDays(weekId, 6)}`,
        days: [],
      });
    }
    weeks.get(weekId).days.push({
      date,
      weekday: weekdayLabel(date),
      title,
      summary: description,
    });
  }
  const payload = {
    weeks: [...weeks.values()].sort((a, b) => (a.id < b.id ? 1 : -1)),
  };
  for (const week of payload.weeks) week.days.sort((a, b) => (a.date < b.date ? -1 : 1));
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`);
  return dataPath;
}

function importOne(htmlPath) {
  const name = basename(htmlPath);
  const match = datePattern.exec(name);
  if (!match || !isRealDate(match[1])) throw new Error(`${htmlPath}: filename must be YYYY-MM-DD.html`);
  const date = match[1];
  const rawHtml = readFileSync(htmlPath, "utf8");
  const markdown = companionMarkdown(htmlPath, rawHtml);
  const sources = markdown ? extractSources(markdown) : [];
  const prepared = prepareNewsHtml(rawHtml, { date, sources });
  mkdirSync(newsDir, { recursive: true });
  const target = join(newsDir, `${date}.html`);
  writeFileSync(target, prepared.html);
  return { target, sources: sources.length };
}

function isDirectRun() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  return entry === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node scripts/import-ai-news.mjs <dir-or-files...>");
    process.exit(1);
  }
  try {
    const files = htmlInputs(args);
    if (files.length === 0) throw new Error("no YYYY-MM-DD.html files found");
    for (const file of files) {
      const written = importOne(file);
      console.log(`wrote ${written.target} (${written.sources} source links)`);
    }
    const index = rebuildNewsIndex();
    console.log(`wrote ${index}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
