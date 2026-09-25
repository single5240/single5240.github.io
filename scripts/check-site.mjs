import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const root = resolve("_site");
const failures = [];

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

if (!existsSync(root)) {
  console.error("_site does not exist. Build the Jekyll site first.");
  process.exit(1);
}

for (const file of walk(root).filter((path) => extname(path) === ".html")) {
  const html = readFileSync(file, "utf8");
  const label = file.slice(root.length + 1);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) failures.push(`${label}: expected one h1, found ${h1Count}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`${label}: missing title`);
  if (!/<meta\s+name=["']description["']/i.test(html)) failures.push(`${label}: missing description`);

  for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|tel:|javascript:|data:|#)/i.test(href)) continue;
    if (!targetExists(file, href)) failures.push(`${label}: broken internal reference ${href}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Site structure and internal links look good.");
