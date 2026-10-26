// Run after Jekyll build. Uses the same optional Playwright setup as the mixer check.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('_site');
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(file)];
    res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const page = await browser.newPage({ reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
try {
  const paths = ['/', '/articles/index.html', '/articles/n32g455-lcd-strip-rendering.html', '/projects/index.html', '/tools/index.html', '/projects/ai-asmr/index.html'];
  for (const theme of ['light', 'dark']) {
    await page.goto(base);
    await page.evaluate(theme => localStorage.setItem('single5240-theme', theme), theme);
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(base + path);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'Requested theme is applied');
        assert.equal(await page.locator('h1').count(), 1, `${path}: one page heading`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}: horizontal overflow at ${width}/${theme}`);
        if (process.env.DESIGN_SCREENSHOTS && [390, 1440].includes(width) && ['/', '/articles/index.html', '/articles/n32g455-lcd-strip-rendering.html'].includes(path)) {
          mkdirSync(process.env.DESIGN_SCREENSHOTS, { recursive: true });
          const name = path === '/' ? 'home' : path.includes('strip-rendering') ? 'article' : 'archive';
          await page.screenshot({ path: resolve(process.env.DESIGN_SCREENSHOTS, `${name}-${width}-${theme}.png`) });
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/articles/index.html');
  await page.locator('#article-search').fill('DMA');
  await page.waitForFunction(() => document.querySelector('.search-status').textContent.includes('搜索“DMA”'));
  assert(await page.locator('[data-search-item]:visible mark').count() > 0, 'Search matches are highlighted');
  await page.locator('[data-topic-filter="qt"]').click();
  assert(await page.locator('.search-empty').isVisible(), 'Combined filters show an empty result');
  await page.locator('.clear-search:not(.clear-topic)').click();
  assert.equal(await page.locator('[data-topic-filter="qt"]').getAttribute('aria-pressed'), 'true', 'Clearing keywords retains topic');
  await page.locator('#article-search').fill('DMA');
  await page.locator('[data-clear-topic]').click();
  assert.equal(await page.locator('#article-search').inputValue(), 'DMA', 'Clearing topic retains keywords');
  const result = page.locator('[data-search-item]:visible h3 a').first();
  await result.click();
  await page.getByRole('link', { name: '← 返回搜索结果', exact: true }).first().click();
  assert.equal(await page.locator('#article-search').inputValue(), 'DMA', 'Returning from article retains query');
  for (const query of ['[', '(', '\\', '<img src=x>', 'ＤＭＡ']) {
    await page.locator('#article-search').fill(query);
  }
  assert.equal(await page.locator('img[src="x"]').count(), 0, 'Search text never becomes HTML');
  await page.goto(base);
  const links = await page.locator('.aside-tools-list a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  for (const href of links) {
    await page.goto(base + href);
    const target = page.locator(new URL(page.url()).hash);
    assert.equal(await target.count(), 1, `${href}: target exists`);
    assert.equal(await page.locator('.tools-tab-btn[aria-current="location"]').count(), 1);
    assert(await target.evaluate(node => node.getBoundingClientRect().top >= 0 && node.getBoundingClientRect().top < innerHeight), `${href}: target is on screen`);
  }
  await page.goto(base + '/projects/index.html');
  assert.equal(await page.locator('.project-notes[open]').count(), 0);
  await page.locator('.project-notes summary').first().click();
  assert(await page.locator('.project-notes[open] .related-link').count() > 2);
  await page.goto(base + '/articles/n32g455-lcd-strip-rendering.html');
  assert(await page.locator('#article-toc').isVisible());
  assert.equal(await page.locator('.reading-companion[open]').count(), 0);
  await page.locator('.reading-companion summary').click();
  assert(await page.locator('#retroRobot').isVisible());
  await page.goto(base);
  await page.locator('[data-scope-pause]').click();
  assert.equal(await page.locator('[data-scope-pause]').getAttribute('aria-pressed'), 'true');
  await page.goto(base + '/projects/ai-asmr/index.html');
  assert(await page.locator('#btnMainPlay').evaluate(node => node.getBoundingClientRect().bottom < innerHeight), 'Playback is available in first viewport');
  await page.locator('.lab-disclosure summary').first().click();
  assert(await page.locator('#rangeLowpass').isVisible());
  assert.deepEqual(errors, [], 'No browser script errors');
  console.log('Design checks passed: 48 page/theme/viewport combinations, search, return, anchors, disclosures and motion control.');
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
