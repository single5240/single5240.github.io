// Run after a Jekyll build. Set PLAYWRIGHT_MODULE if Playwright is installed elsewhere.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve("_site");
assert(existsSync(resolve(root, "projects/ai-asmr/index.html")), "Build the Jekyll site first");
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  if (!file.startsWith(root + "/") && !file.startsWith(root + "\\")) { res.writeHead(403).end(); return; }
  try {
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[extname(file)] || "application/octet-stream";
    let content = readFileSync(file);
    if (pathname.endsWith("/ai-asmr/lab.js")) content = content.toString().replace("  setupMixer();", "  window.audioTest.makeVoice = createVoice; window.audioTest.paramButtons = PARAM_BUTTONS; window.audioTest.defaults = { ...initialState }; window.audioTest.clearVisuals = () => { visualQueue.length = 0; };\n  setupMixer();");
    res.writeHead(200, { "Content-Type": type }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => { errors.push(error.message); console.error("Browser:", error.message); });
await page.addInitScript(() => {
  window.audioTest = { contexts: [], scopes: [], grooves: [], starts: 0 };
  let grooveLibrary;
  Object.defineProperty(window, "AsmrGroove", {
    get: () => grooveLibrary,
    set(value) {
      grooveLibrary = value;
      const original = value.create;
      value.create = (...args) => {
        const model = original(...args);
        const record = { model, samples: [], delays: 0 };
        const sample = model.sample;
        const delay = model.delay;
        model.sample = (...values) => {
          const result = sample(...values);
          record.samples.push(result.gain);
          if (record.samples.length > 64) record.samples.shift();
          return result;
        };
        model.delay = (...values) => { record.delays++; return delay(...values); };
        audioTest.grooves.push(record);
        return model;
      };
    }
  });
  for (const prototype of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    if (!Object.hasOwn(prototype, "start")) continue;
    const originalStart = prototype.start;
    prototype.start = function (...args) { audioTest.starts++; return originalStart.apply(this, args); };
  }
  const Real = window.AudioContext;
  window.AudioContext = new Proxy(Real, {
    construct(target, args) { const context = new target(...args); window.audioTest.contexts.push(context); return context; }
  });
  let runtime;
  Object.defineProperty(window, "AsmrRuntime", {
    get: () => runtime,
    set(value) {
      runtime = value;
      const original = value.createScope;
      value.createScope = (...args) => {
        const scope = original(...args);
        if (!(args[0] instanceof OfflineAudioContext)) window.audioTest.scopes.push(scope);
        return scope;
      };
    }
  });
});
const row = i => page.locator(".mixer-track").nth(i);
const action = (i, name) => row(i).locator(`[data-action="${name}"]`);
const add = () => page.locator("#btnAddToMix").click();
const category = name => page.locator(`[data-cat="${name}"]`).click();
const pause = () => page.locator("#btnMixPlay").click();
const settle = ms => page.waitForTimeout(ms);
const resources = () => page.evaluate(() => window.audioTest.scopes.map(s => ({ nodes: s.nodeCount, sources: s.sourceCount, tasks: s.taskCount })));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/projects/ai-asmr/index.html`);
  assert.equal(await page.locator('#btnMixerToggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#mixerBody').isVisible(), false);
  await page.locator('#btnMixerToggle').click();
  const acoustic = await page.evaluate(async () => {
    const offline = new OfflineAudioContext(2, 48000 * 168, 48000);
    const noise = AsmrRuntime.circularNoise(offline, 8, 2, AsmrRuntime.random(20261025));
    const source = offline.createBufferSource();
    source.buffer = noise; source.loop = true; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    const channel = rendered.getChannelData(0);
    let peak = 0, maxDelta = 0;
    for (let i = 1; i < 8 * 48000; i++) {
      peak = Math.max(peak, Math.abs(channel[i]));
      maxDelta = Math.max(maxDelta, Math.abs(channel[i] - channel[i - 1]));
    }
    const rms = (start, count) => {
      let energy = 0;
      for (let i = start; i < start + count; i++) energy += channel[i] ** 2;
      return Math.sqrt(energy / count);
    };
    const seamRms = rms(8 * 48000 - 4800, 9600);
    const typicalRms = rms(48000, 6 * 48000);
    let seamDelta = 0;
    for (let n = 1; n <= 20; n++) seamDelta = Math.max(seamDelta, Math.abs(channel[n * 8 * 48000] - channel[n * 8 * 48000 - 1]));
    return { peak, maxDelta, seamDelta, seamRms, typicalRms, seconds: rendered.duration };
  });
  assert(acoustic.peak > 0.01 && acoustic.peak < 1);
  assert(acoustic.seamDelta < acoustic.maxDelta, "Loop seam has an abnormal sample jump");
  assert(acoustic.seamRms / acoustic.typicalRms > 0.6 && acoustic.seamRms / acoustic.typicalRms < 1.6, "Loop seam RMS discontinuity");
  console.log("Circular noise, 20 rendered boundaries:", JSON.stringify(acoustic));
  const mix = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(2, 48000 * 12, 48000);
    const scheduler = AsmrRuntime.createScheduler(ctx);
    const sum = ctx.createGain(); sum.gain.value = 0.45;
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1800; filter.Q.value = 0.65;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -6; compressor.knee.value = 6; compressor.ratio.value = 16;
    compressor.attack.value = 0.003; compressor.release.value = 0.12;
    const master = ctx.createGain(); master.gain.value = 0.75;
    sum.connect(filter).connect(compressor).connect(master).connect(ctx.destination);
    const voices = [];
    const motionGains = [];
    const arrangement = AsmrGroove.create(0, 20261025);
    const categories = ["rain", "fire", "tapping", "bowls"];
    for (const category of categories) arrangement.add("offline-" + category, category);
    arrangement.setActive(categories.map(category => "offline-" + category));
    for (const category of categories) {
      const scope = AsmrRuntime.createScope(ctx, scheduler);
      const output = ctx.createGain(); output.gain.value = 0.65;
      const motion = ctx.createGain(); output.connect(motion).connect(sum);
      motionGains.push({ id: "offline-" + category, motion });
      const voice = audioTest.makeVoice({ ...audioTest.defaults, activeCategory: category,
        currentRain: "drizzle", currentTapMat: "book" }, scope, output, "offline-" + category, arrangement);
      voice.start(0.05 + arrangement.entry("offline-" + category)); voices.push(voice);
    }
    for (let now = 0; now < 12; now += 0.025) {
      for (const voice of voices) voice.scope.pump(now, Math.min(12, now + 0.15), 32);
      for (const { id, motion } of motionGains) motion.gain.setTargetAtTime(arrangement.sample(id, now).gain, now, 0.65);
    }
    const rendered = await ctx.startRendering();
    let peak = 0, energy = 0, count = 0;
    for (let channel = 0; channel < 2; channel++) for (const sample of rendered.getChannelData(channel)) {
      peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; count++;
    }
    voices.forEach(v => v.dispose());
    return { peak, rms: Math.sqrt(energy / count), seconds: rendered.duration };
  });
  assert(mix.peak > 0.001 && mix.peak < 0.95, "Mixed audio must be non-silent and have peak headroom");
  console.log("Four-layer offline render with shared groove:", JSON.stringify(mix));
  const renderedVariants = await page.evaluate(async () => {
    const names = ["rain", "tapping", "friction", "water", "bowls", "tools", "fire", "squish", "keyboard", "ambient"];
    let cases = 0;
    for (const [index, [selector, key, attribute]] of audioTest.paramButtons.entries()) {
      for (const button of document.querySelectorAll(selector)) {
        const ctx = new OfflineAudioContext(2, 48000, 48000);
        const scheduler = AsmrRuntime.createScheduler(ctx);
        const scope = AsmrRuntime.createScope(ctx, scheduler);
        const gain = ctx.createGain(); gain.gain.value = 0.2; gain.connect(ctx.destination);
        const config = { ...audioTest.defaults, activeCategory: names[Math.floor(index / 2)], [key]: button.getAttribute(attribute) };
        const voice = audioTest.makeVoice(config, scope, gain, "variant");
        voice.start(0.01);
        for (let now = 0; now < 1; now += 0.025) scope.pump(now, Math.min(1, now + 0.15), 32);
        const result = await ctx.startRendering();
        let energy = 0;
        for (const sample of result.getChannelData(0)) {
          if (!Number.isFinite(sample)) throw new Error("Non-finite audio: " + key + "=" + config[key]);
          energy += sample * sample;
        }
        voice.dispose();
        if (energy <= 1e-12) throw new Error("Silent variant: " + key + "=" + config[key]);
        cases++;
      }
    }
    return cases;
  });
  console.log("Material/scene/style offline renders:", renderedVariants);
  await page.evaluate(() => audioTest.clearVisuals());
  await page.evaluate(() => {
    const context = { currentTime: 0 };
    const scope = AsmrRuntime.createScope(context, { add() {}, remove() {}, sourceCount: 0 });
    let obsolete = 0;
    const times = [];
    for (let i = 1; i <= 40; i++) scope.setTimeout(() => obsolete++, i, true);
    const recur = () => { times.push(scope.time()); scope.setTimeout(recur, 100); };
    scope.setTimeout(recur, 5);
    scope.pump(2, 2.15, 128);
    scope.dispose();
    if (obsolete || times.length > 2 || times.some(time => time < 2)) throw new Error("Audio scheduler replayed an obsolete backlog");
  });
  // Independent playback remains the primary page action, and never adds a mix layer.
  const sessionsBeforeIndependent = await page.evaluate(() => audioTest.grooves.length);
  await page.locator('#btnMainPlay').click(); await settle(650);
  assert.equal(await page.evaluate(() => audioTest.grooves.length), sessionsBeforeIndependent, 'Independent playback must not create a groove session');
  assert.equal(await page.locator('.mixer-track').count(), 0);
  assert.equal(await page.locator('#btnMainPlay').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#btnMixPlay').getAttribute('aria-pressed'), 'false');
  await page.locator('.surface-btn[data-surface="window"]').click(); await settle(650);
  assert.equal(await page.locator('.mixer-track').count(), 0, 'Independent parameter changes must not add mix layers');
  assert.equal((await resources()).filter(scope => scope.nodes).length, 1);
  await category('tapping'); await settle(600);
  assert.equal(await page.locator('#btnMainPlay').getAttribute('aria-pressed'), 'false', 'Category switching preserves independent stop behavior');
  assert((await resources()).every(scope => scope.nodes === 0));
  await category('rain'); await page.locator('#btnMainPlay').click(); await settle(650);
  await pause(); await settle(700);
  assert.equal(await page.locator('#btnMainPlay').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#btnMixPlay').getAttribute('aria-pressed'), 'true');
  assert.equal((await resources()).filter(scope => scope.nodes).length, 1, 'Independent source must be disposed after starting the mix');
  assert(await page.evaluate(() => audioTest.grooves.at(-1).samples.length > 0 && audioTest.grooves.at(-1).delays > 0), 'Mixed playback must drive gain and timing variation');
  const faderBefore = await action(0, 'volume').inputValue();
  await page.locator('#btnMixGroove').click(); await settle(900);
  assert.equal(await page.locator('#btnMixGroove').getAttribute('aria-pressed'), 'false');
  assert(await page.evaluate(() => audioTest.grooves.at(-1).samples.at(-1) === 1), 'Bypass must restore neutral motion gain');
  assert.equal(await action(0, 'volume').inputValue(), faderBefore, 'Groove must not overwrite user volume');
  await page.locator('#btnMixGroove').click();
  await page.locator('#btnMixerToggle').click();
  assert.equal(await page.locator('#mixerBody').isVisible(), false);
  assert.equal(await page.locator('#btnMixPlay').getAttribute('aria-pressed'), 'true');
  await page.locator('#btnMixerToggle').click();
  await page.locator('#btnMainPlay').click(); await settle(700);
  assert.equal(await page.locator('#btnMainPlay').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#btnMixPlay').getAttribute('aria-pressed'), 'false');
  assert.equal((await resources()).filter(scope => scope.nodes).length, 1, 'Mix source must be disposed after starting independent playback');
  await action(0, 'remove').click();
  assert.equal(await page.locator('#btnMainPlay').getAttribute('aria-pressed'), 'true', 'Removing a stored mix must not stop independent audio');
  await pause(); // Switching to an empty mix adds the browsed sound.
  await settle(700);
  assert.equal(await page.locator(".mixer-track").count(), 1);
  assert.equal(await page.locator("#btnMixPlay").getAttribute("aria-pressed"), "true");
  await category("fire"); await add();
  await category("tapping"); await page.locator('.tap-mat-btn[data-mat="book"]').click(); await add();
  await category("rain"); await add();
  assert.equal(await page.locator(".mixer-track").count(), 4);
  await page.locator("#btnAddToMix").dispatchEvent("click");
  assert.equal(await page.locator(".mixer-track").count(), 4);
  assert.match(await page.locator("#mixerStatus").textContent(), /最多/);
  assert.equal(await page.evaluate(() => audioTest.contexts.length), 1);
  await action(0, "muted").click();
  assert.equal(await row(0).getAttribute("data-audible"), "false");
  await action(1, "solo").click(); await action(2, "solo").click();
  assert.equal(await row(1).getAttribute("data-audible"), "true");
  assert.equal(await row(2).getAttribute("data-audible"), "true");
  assert.equal(await row(3).getAttribute("data-audible"), "false");
  await action(1, "solo").click(); await action(2, "solo").click();
  await action(0, "muted").click();
  // Same-category instances must remain independent while editing.
  const originalRain = await row(3).locator("strong").textContent();
  await action(0, "edit").click();
  await page.locator('.surface-btn[data-surface="car_roof"]').click();
  assert.equal(await row(3).locator("strong").textContent(), originalRain);
  assert.notEqual(await row(0).locator("strong").textContent(), originalRain);
  await page.locator("#btnLeaveTrackEditor").click();
  // Browsing does not stop playback or change existing names.
  await category("water");
  assert.equal(await page.locator("#btnMixPlay").getAttribute("aria-pressed"), "true");
  await settle(1200);
  for (const delay of [500, 2000]) {
    await page.evaluate(delay => { const until = performance.now() + delay; while (performance.now() < until) {} }, delay);
    await settle(300);
  }
  await pause(); await settle(600);
  assert((await resources()).every(s => s.nodes === 0 && s.sources === 0 && s.tasks === 0), "Pause must release every voice");
  // Repeated play/pause races must settle with one context and no surviving scopes.
  for (let n = 0; n < 6; n++) { await pause(); await settle(40); await pause(); await settle(40); }
  await settle(650);
  assert((await resources()).every(s => s.nodes === 0 && s.tasks === 0));
  while (await page.locator(".mixer-track").count()) await action(0, "remove").click();
  await pause(); await settle(600);
  for (let n = 0; n < 25; n++) {
    await add();
    await action(1, "remove").click();
    await settle(500);
    assert.equal((await resources()).filter(s => s.nodes).length, 1, "Add/remove cycle leaked a voice");
  }
  await action(0, "remove").click(); await settle(600);
  // Exercise every category, including sustained bowl tails and all preset buttons.
  const categories = ["rain", "tapping", "friction", "water", "bowls", "tools", "fire", "squish", "keyboard", "ambient"];
  for (const name of categories) {
    console.log("Checking category:", name);
    const startsBefore = await page.evaluate(() => audioTest.starts);
    await category(name); await add(); await pause(); await settle(800);
    await action(0, "edit").click();
    const panel = page.locator('[role="tabpanel"]:visible');
    const buttons = panel.locator('button[aria-checked]');
    const count = await buttons.count();
    for (let n = 0; n < count; n++) { await buttons.nth(n).click(); await settle(40); }
    await settle(1000);
    const live = (await resources()).filter(s => s.nodes);
    assert.equal(live.length, 1, name + " must leave only the current voice after transitions");
    assert(await page.evaluate(() => audioTest.starts) > startsBefore, name + " should start actual audio sources");
    await action(0, "remove").click(); await settle(600);
    assert((await resources()).every(s => s.nodes === 0 && s.tasks === 0), name + " leaked resources");
  }
  // Mobile/light and desktop/dark layout, without relying on audible output.
  for (const name of ["rain", "fire", "tapping", "water"]) { await category(name); await add(); }
  for (const width of [390, 1280]) for (const theme of ["light", "dark", "swiss", "hud", "mono"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    assert(await page.locator("#btnAddToMix").isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal overflow at " + width);
    if (process.env.ASMR_SCREENSHOT_DIR && ((width === 390 && theme === "light") || (width === 1280 && theme === "dark"))) {
      mkdirSync(process.env.ASMR_SCREENSHOT_DIR, { recursive: true });
      await page.locator("#mixerBody").evaluate(element => element.scrollTop = 0);
      await page.locator("#mixerDock").screenshot({ path: join(process.env.ASMR_SCREENSHOT_DIR, `mixer-${width}-${theme}.png`) });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(process.env.ASMR_SCREENSHOT_DIR, `layout-${width}-${theme}.png`) });
    }
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log("ASMR mixer: 4-track controls, independent same-category editing, 10 categories/presets, races, cleanup and responsive layout passed.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
