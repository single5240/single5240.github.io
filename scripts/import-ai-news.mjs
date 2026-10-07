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

function chromeBlock({ title, description, canonical, weekId }) {
  const origin = siteOrigin();
  const image = `${origin}/assets/images/engineer-computer-lineart.jpg`;
  const weekHref = `/ai-news/index.html#week-${weekId}`;
  return `<!-- s5-news-chrome:start -->
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:site_name" content="single5240 笔记分享">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<style>
.s5-news-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  padding: 8px 220px 8px 14px;
  background: var(--paper, #fff);
  color: var(--ink, #16181d);
  border-bottom: 1px solid var(--line-2, #d6dae1);
  font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
}
.s5-news-bar a { color: var(--accent, #1d5fbf); text-decoration: none; }
.s5-news-bar a:hover { text-decoration: underline; }
.s5-news-bar a:focus-visible { outline: 2px solid var(--accent, #1d5fbf); outline-offset: 2px; }
.am-toolbar { top: 48px !important; }
.s5-news-sources {
  margin: 28px 0 8px;
  padding-top: 16px;
  border-top: 1px solid var(--line-2, #d6dae1);
  color: var(--ink, #16181d);
}
.s5-news-sources h2 { margin: 0 0 10px; font-size: 16px; }
.s5-news-sources ol { margin: 0; padding-left: 1.2em; }
.s5-news-sources a { color: var(--accent, #1d5fbf); overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .s5-news-bar { padding-right: 14px; }
  .am-toolbar { top: 78px !important; }
}
@media (prefers-reduced-motion: reduce) {
  .s5-news-bar, .s5-news-bar a { transition: none; scroll-behavior: auto; }
}
@media print {
  .s5-news-bar { display: none !important; }
}
</style>
<!-- s5-news-chrome:end -->
`;
}

function barBlock(weekId) {
  return `<!-- s5-news-bar:start -->
<div class="s5-news-bar">
  <a href="/">返回笔记</a>
  <a href="/ai-news/index.html#week-${weekId}">本周 AI 资讯</a>
</div>
<!-- s5-news-bar:end -->
`;
}

function sourcesBlock(links) {
  if (!links.length) return "";
  const items = links.map((link) => `  <li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`).join("\n");
  return `<!-- s5-news-sources:start -->
<section class="s5-news-sources" aria-label="来源">
  <h2>来源</h2>
  <ol>
${items}
  </ol>
</section>
<!-- s5-news-sources:end -->
`;
}

export function prepareNewsHtml(html, { date, sources }) {
  if (/^\uFEFF?---\r?\n/.test(html)) {
    throw new Error(`${date}: HTML starts with front matter; leave it as a static page so Liquid is not executed`);
  }
  let next = stripMarker(stripMarker(stripMarker(html, "s5-news-chrome"), "s5-news-bar"), "s5-news-sources");
  next = stripUnmanagedMeta(next);
  const title = pageTitle(next);
  const description = pageSummary(next, title) || title;
  const canonical = `${siteOrigin()}/ai-news/${date}.html`;
  const weekId = mondayOf(date);
  if (!next.includes("</head>") || !next.includes("<body") || !next.includes("</main>")) {
    throw new Error(`${date}: expected </head>, <body>, and </main>`);
  }
  next = next.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)} | single5240</title>`);
  next = next.replace(/<\/head>/i, `${chromeBlock({ title, description, canonical, weekId })}\n</head>`);
  next = next.replace(/<body([^>]*)>/i, `<body$1>\n${barBlock(weekId)}`);
  const sourceHtml = sourcesBlock(sources);
  if (sourceHtml) {
    const at = next.indexOf("</main>");
    next = `${next.slice(0, at)}${sourceHtml}\n${next.slice(at)}`;
  }
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

function companionMarkdown(htmlPath) {
  const markdownPath = htmlPath.replace(/\.html$/, ".md");
  try {
    return readFileSync(markdownPath, "utf8");
  } catch {
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
  const markdown = companionMarkdown(htmlPath);
  const sources = markdown ? extractSources(markdown) : [];
  const prepared = prepareNewsHtml(readFileSync(htmlPath, "utf8"), { date, sources });
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
