import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { gcd, quoteIndex, quoteStep } from "./quote-order.mjs";
import { validateEnglish } from "./import-english.mjs";
import { isRealDate as isNewsDate, mondayOf, weekdayLabel } from "./import-ai-news.mjs";

const root = resolve("_site");
const failures = [];
const maxImageBytes = 400 * 1024;

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function targetExists(source, href) {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (!clean) return true;
  const relative = clean.startsWith("/") ? clean.slice(1) : normalize(join(dirname(source.slice(root.length + 1)), clean));
  const target = join(root, relative);
  return existsSync(target) || existsSync(join(target, "index.html")) || (!extname(target) && existsSync(`${target}.html`));
}

function pagePath(file) {
  const relative = file.slice(root.length + 1).split("\\").join("/");
  return relative === "index.html" ? "/" : `/${relative}`;
}

function urlPath(value) {
  const url = new URL(value, "https://single5240.github.io");
  let path = decodeURIComponent(url.pathname);
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function attr(tag, name) {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] || "";
}

const quotesPath = resolve("_data/quotes.yml");
const requiredQuoteFields = ["zh", "en", "author", "origin"];

function unquoteYaml(value) {
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    return JSON.parse(value);
  }
  return value;
}

function parseQuotes(text) {
  const entries = [];
  let current = null;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("- ")) {
      if (current) entries.push(current);
      current = { line: index + 1 };
      const rest = line.slice(2).trim();
      if (rest) assignQuoteField(current, rest, index + 1);
      continue;
    }
    if (!current) throw new Error(`line ${index + 1}: field outside an entry`);
    assignQuoteField(current, line, index + 1);
  }
  if (current) entries.push(current);
  return entries;
}

function assignQuoteField(entry, text, line) {
  const match = text.match(/^([A-Za-z_]+):\s*(.*)$/);
  if (!match) throw new Error(`line ${line}: expected key: value`);
  entry[match[1]] = unquoteYaml(match[2].trim());
}

function validateQuotes() {
  const problems = [];
  if (!existsSync(quotesPath)) {
    problems.push("_data/quotes.yml: missing");
    return problems;
  }

  let quotes;
  try {
    quotes = parseQuotes(readFileSync(quotesPath, "utf8"));
  } catch (error) {
    problems.push(`_data/quotes.yml: ${error.message}`);
    return problems;
  }

  if (quotes.length !== 100) problems.push(`_data/quotes.yml: expected 100 quotes, found ${quotes.length}`);
  const seen = new Set();
  const counts = { cn: 0, foreign: 0 };
  for (const [index, quote] of quotes.entries()) {
    const label = `_data/quotes.yml entry ${index + 1}`;
    for (const field of requiredQuoteFields) {
      if (typeof quote[field] !== "string" || quote[field].trim() === "") {
        problems.push(`${label}: missing ${field}`);
      }
    }
    if (quote.source !== undefined && (typeof quote.source !== "string" || quote.source.trim() === "")) {
      problems.push(`${label}: source is present but empty`);
    }
    if (typeof quote.source === "string" && isVagueSource(quote.source)) {
      problems.push(`${label}: vague source`);
    }
    if (quote.origin === "cn" || quote.origin === "foreign") counts[quote.origin] += 1;
    else if (quote.origin) problems.push(`${label}: origin must be cn or foreign`);
    if (quote.zh && seen.has(quote.zh)) problems.push(`${label}: duplicate zh`);
    if (quote.zh) seen.add(quote.zh);
  }

  if (quotes.length && (counts.cn !== 50 || counts.foreign !== 50)) {
    problems.push(`_data/quotes.yml: expected 50 cn and 50 foreign quotes, found cn ${counts.cn}, foreign ${counts.foreign}`);
  }
  if (quotes.length > 1 && counts.cn + counts.foreign === quotes.length) {
    const step = quoteStep(quotes.length);
    if (gcd(quotes.length, step) !== 1) problems.push(`_data/quotes.yml: step ${step} is not coprime to ${quotes.length}`);
    const seen = new Set();
    for (let index = 0; index < quotes.length; index += 1) {
      const slot = (index * step) % quotes.length;
      seen.add(slot);
      const next = (slot + step) % quotes.length;
      if (quotes[slot].author && quotes[slot].author === quotes[next].author) {
        problems.push(`_data/quotes.yml: ${quotes[slot].author} is on adjacent days of the cycle`);
      }
    }
    if (seen.size !== quotes.length) problems.push("_data/quotes.yml: daily order is not a full cycle");
  }
  return problems;
}

function isVagueSource(source) {
  if (source === "笔记") return true;
  return ["演讲中的话", "前后的话", "常被引用", "多次说过", "谈科学与工程", "实践论", "附注"].some((item) => source.includes(item));
}

function shanghaiDayNumber(date = new Date()) {
  return Math.floor((Math.floor(date.getTime() / 1000) + 28800) / 86400);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function listJson(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
}

function validateEnglishSources() {
  const problems = [];
  const dataDir = resolve("_data/english");
  const docDir = resolve("_english");
  const jsonNames = listJson(dataDir);
  if (jsonNames.length === 0) problems.push("_data/english: expected at least one YYYY-MM-DD.json");
  const docNames = existsSync(docDir) ? readdirSync(docDir).filter((name) => name.endsWith(".md")).sort() : [];
  if (jsonNames.join("\n") !== docNames.map((name) => name.replace(/\.md$/, ".json")).join("\n")) {
    problems.push("_data/english and _english filenames do not match");
  }
  for (const name of jsonNames) {
    const file = join(dataDir, name);
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    problems.push(...validateEnglish(data, name));
    const date = name.slice(0, -5);
    if (data && data.date !== date) problems.push(`${name}: filename does not match date`);
    const docPath = join(docDir, `${date}.md`);
    if (existsSync(docPath)) {
      const doc = readFileSync(docPath, "utf8");
      if (!doc.includes("layout: english")) problems.push(`_english/${date}.md: missing layout english`);
      if (!doc.includes(`day: '${date}'`) && !doc.includes(`day: "${date}"`)) problems.push(`_english/${date}.md: missing day`);
    }
  }
  return problems;
}

function validateNewsSources() {
  const problems = [];
  const dataFile = resolve("_data/ai_news.json");
  if (!existsSync(dataFile)) {
    problems.push("_data/ai_news.json: missing");
    return problems;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(dataFile, "utf8"));
  } catch (error) {
    problems.push(`_data/ai_news.json: ${error.message}`);
    return problems;
  }
  if (!data || !Array.isArray(data.weeks)) {
    problems.push("_data/ai_news.json: expected weeks array");
    return problems;
  }
  const seen = [];
  let previousWeek = "9999-99-99";
  for (const week of data.weeks) {
    if (!week || !isNewsDate(week.id) || week.id !== mondayOf(week.days?.[0]?.date || week.id)) {
      problems.push(`_data/ai_news.json: week ${week && week.id} is not a Monday group`);
    }
    if (week.id >= previousWeek) problems.push(`_data/ai_news.json: weeks are not newest first (${week.id})`);
    previousWeek = week.id;
    let previousDay = "";
    for (const day of week.days || []) {
      if (!isNewsDate(day.date) || mondayOf(day.date) !== week.id) problems.push(`_data/ai_news.json: ${day.date} is outside week ${week.id}`);
      if (day.weekday !== weekdayLabel(day.date)) problems.push(`_data/ai_news.json: ${day.date} weekday should be ${weekdayLabel(day.date)}`);
      if (!day.title || !day.summary) problems.push(`_data/ai_news.json: ${day.date} missing title or summary`);
      if (previousDay && day.date <= previousDay) problems.push(`_data/ai_news.json: days in ${week.id} are not chronological`);
      previousDay = day.date;
      const htmlPath = resolve("ai-news", `${day.date}.html`);
      if (!existsSync(htmlPath)) problems.push(`ai-news/${day.date}.html: missing`);
      else if (/^\uFEFF?---\r?\n/.test(readFileSync(htmlPath, "utf8"))) problems.push(`ai-news/${day.date}.html: must not start with front matter`);
      seen.push(day.date);
    }
  }
  const newsDir = resolve("ai-news");
  if (existsSync(newsDir)) {
    for (const name of readdirSync(newsDir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.html$/.test(name)) continue;
      if (!seen.includes(name.slice(0, 10))) problems.push(`_data/ai_news.json: missing ${name}`);
    }
  }
  if (seen.length === 0) problems.push("_data/ai_news.json: expected at least one day");
  return problems;
}

failures.push(...validateQuotes());
failures.push(...validateEnglishSources());
failures.push(...validateNewsSources());

if (!existsSync(root)) {
  failures.push("_site does not exist. Build the Jekyll site first.");
  console.error(failures.join("\n"));
  process.exit(1);
}

const robotsPath = join(root, "robots.txt");
const sitemapPath = join(root, "sitemap.xml");
const feedPath = join(root, "feed.xml");
const manifestPath = join(root, "site.webmanifest");
if (!existsSync(robotsPath)) failures.push("robots.txt: missing");
if (!existsSync(sitemapPath)) failures.push("sitemap.xml: missing");
if (!existsSync(feedPath)) failures.push("feed.xml: missing");
if (!existsSync(manifestPath)) failures.push("site.webmanifest: missing");

const feed = existsSync(feedPath) ? readFileSync(feedPath, "utf8") : "";
if (feed && !/<entry(?:\s|>)/i.test(feed)) failures.push("feed.xml: contains no article entries");

if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons?.find((item) => item.sizes === size && item.type === "image/png");
      if (!icon) failures.push(`site.webmanifest: missing ${size} PNG icon`);
      else if (!existsSync(join(root, icon.src.replace(/^\//, "")))) failures.push(`site.webmanifest: missing icon file ${icon.src}`);
    }
  } catch {
    failures.push("site.webmanifest: invalid JSON");
  }
}

const robots = existsSync(robotsPath) ? readFileSync(robotsPath, "utf8") : "";
if (robots && !/^Sitemap:\s+\S+/m.test(robots)) failures.push("robots.txt: missing Sitemap directive");

const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, "utf8") : "";
const sitemapPaths = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => urlPath(match[1].trim()));
const htmlFiles = walk(root).filter((path) => extname(path) === ".html");

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const label = file.slice(root.length + 1);
  const path = pagePath(file);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) failures.push(`${label}: expected one h1, found ${h1Count}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`${label}: missing title`);
  if (!/<meta\s+name=["']description["']/i.test(html)) failures.push(`${label}: missing description`);

  const links = tags(html, "link");
  const metas = tags(html, "meta");
  const canonical = links.find((tag) => attr(tag, "rel") === "canonical");
  if (!canonical) failures.push(`${label}: missing canonical`);
  else if (urlPath(attr(canonical, "href")) !== path) failures.push(`${label}: canonical does not match ${path}`);

  for (const property of ["og:title", "og:description", "og:url", "og:image"]) {
    if (!metas.some((tag) => attr(tag, "property") === property && attr(tag, "content"))) {
      failures.push(`${label}: missing ${property}`);
    }
  }

  const image = metas.find((tag) => attr(tag, "property") === "og:image");
  if (image && !targetExists(file, urlPath(attr(image, "content")))) {
    failures.push(`${label}: missing og:image file ${attr(image, "content")}`);
  }

  const robotsMeta = metas.find((tag) => attr(tag, "name") === "robots");
  const noindex = robotsMeta && /noindex/i.test(attr(robotsMeta, "content"));
  const listed = sitemapPaths.includes(path);
  if (noindex && listed) failures.push(`${label}: noindex page is listed in sitemap.xml`);
  if (!noindex && !listed) failures.push(`${label}: indexable page is missing from sitemap.xml`);

  if (path === "/") {
    const quoteData = html.match(/<script type="application\/json" id="daily-quote-data">([\s\S]*?)<\/script>/);
    if (!quoteData) failures.push("index.html: missing embedded daily quote data");
    else {
      try {
        const embedded = JSON.parse(quoteData[1]);
        if (!Array.isArray(embedded) || embedded.length !== 100) {
          failures.push("index.html: embedded quote data is missing or not 100 quotes");
        } else if (embedded.some((item) => !item.zh || !item.en || !item.author || !item.origin)) {
          failures.push("index.html: an embedded quote is missing a required field");
        }
      } catch {
        failures.push("index.html: embedded quote data is not valid JSON");
      }
    }
    if (!html.includes("data-daily-quote")) failures.push("index.html: missing daily quote");
    if (!html.includes("Asia/Shanghai")) failures.push("index.html: daily quote does not document Asia/Shanghai");
    if (!html.includes("function quoteIndex")) failures.push("index.html: missing shared quote order");
    let embeddedQuotes = [];
    if (quoteData) {
      try {
        embeddedQuotes = JSON.parse(quoteData[1]);
      } catch {
        embeddedQuotes = [];
      }
    }
    const quoteTotal = Array.isArray(embeddedQuotes) ? embeddedQuotes.length : 0;
    const step = quoteStep(quoteTotal);
    const stepAttr = html.match(/data-quote-step="(\d+)"/);
    const indexAttr = html.match(/data-quote-index="(\d+)"/);
    if (!stepAttr || Number(stepAttr[1]) !== step) failures.push(`index.html: quote step ${stepAttr && stepAttr[1]} !== ${step}`);
    const expectedIndex = quoteIndex(shanghaiDayNumber(), quoteTotal);
    if (!indexAttr || Number(indexAttr[1]) !== expectedIndex) {
      failures.push(`index.html: quote index ${indexAttr && indexAttr[1]} !== ${expectedIndex}`);
    }
    if (!html.includes("每日英语") || !html.includes("/english/")) failures.push("index.html: missing daily English card");
    if (!html.includes("AI 资讯") || !html.includes("/ai-news/")) failures.push("index.html: missing AI news teaser");
  }

  for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|tel:|javascript:|data:|#)/i.test(href)) continue;
    if (!targetExists(file, href)) failures.push(`${label}: broken internal reference ${href}`);
  }
}

for (const path of sitemapPaths) {
  const target = path === "/" ? join(root, "index.html") : join(root, path.slice(1));
  if (!existsSync(target)) failures.push(`sitemap.xml: ${path} does not match a built file`);
}

const englishDataDir = resolve("_data/english");
for (const name of listJson(englishDataDir)) {
  const data = JSON.parse(readFileSync(join(englishDataDir, name), "utf8"));
  const built = join(root, "english", `${data.date}.html`);
  if (!existsSync(built)) failures.push(`english/${data.date}.html: missing built page`);
  else if (!readFileSync(built, "utf8").includes(escapeHtml(data.sentence))) failures.push(`english/${data.date}.html: missing sentence`);
}
const archive = join(root, "english", "index.html");
if (!existsSync(archive)) failures.push("english/index.html: missing");
const newsDataPath = resolve("_data/ai_news.json");
if (existsSync(newsDataPath)) {
  const news = JSON.parse(readFileSync(newsDataPath, "utf8"));
  const newsIndex = join(root, "ai-news", "index.html");
  const newsIndexHtml = existsSync(newsIndex) ? readFileSync(newsIndex, "utf8") : "";
  if (!newsIndexHtml) failures.push("ai-news/index.html: missing");
  for (const week of news.weeks || []) {
    if (newsIndexHtml && !newsIndexHtml.includes(`id="week-${week.id}"`)) failures.push(`ai-news/index.html: missing week ${week.id}`);
    for (const day of week.days || []) {
      const built = join(root, "ai-news", `${day.date}.html`);
      if (!existsSync(built)) {
        failures.push(`ai-news/${day.date}.html: missing built page`);
        continue;
      }
      const page = readFileSync(built, "utf8");
      if (!page.includes("s5-news-bar")) failures.push(`ai-news/${day.date}.html: missing return bar`);
      if (!page.includes(`/ai-news/index.html#week-${week.id}`)) failures.push(`ai-news/${day.date}.html: missing week link`);
      if (page.includes("<!-- s5-news-sources:start -->")) {
        const sourceHtml = page.match(/<!-- s5-news-sources:start -->([\s\S]*?)<!-- s5-news-sources:end -->/);
        const hrefs = sourceHtml ? [...sourceHtml[1].matchAll(/href="([^"]+)"/g)].map((match) => match[1]) : [];
        if (hrefs.length === 0 || hrefs.some((href) => !/^https?:\/\//.test(href))) {
          failures.push(`ai-news/${day.date}.html: source links must be absolute http(s)`);
        }
      }
    }
  }
}

for (const file of walk(root)) {
  if (!/\.(?:jpe?g|png|gif|webp)$/i.test(file)) continue;
  const size = statSync(file).size;
  if (size > maxImageBytes) failures.push(`${file.slice(root.length + 1)}: image is ${size} bytes, over ${maxImageBytes}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Site structure, metadata, sitemap, quotes, English, AI news, and internal links look good.");
