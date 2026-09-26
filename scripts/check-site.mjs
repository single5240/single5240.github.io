import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

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

if (!existsSync(root)) {
  console.error("_site does not exist. Build the Jekyll site first.");
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

for (const file of walk(root)) {
  if (!/\.(?:jpe?g|png|gif|webp)$/i.test(file)) continue;
  const size = statSync(file).size;
  if (size > maxImageBytes) failures.push(`${file.slice(root.length + 1)}: image is ${size} bytes, over ${maxImageBytes}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Site structure, metadata, sitemap, and internal links look good.");
