// Run after a Jekyll build. Uses the same optional Playwright setup as check-asmr-mixer.mjs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve("_site");
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = readFileSync(file);
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" }[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + "/tools/index.html");

  const payload = "<img/src='x'onerror='globalThis.__injected=1'>";
  await page.locator("#mb-inspect-input").fill(payload);
  assert((await page.locator("#mb-inspect-result").innerText()).includes(payload));
  assert.equal(await page.locator("#mb-inspect-result img").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);

  await page.locator("#adc-mode").selectOption("twos_comp");
  await page.locator("#adc-vref").fill("5");
  await page.locator("#adc-pga").selectOption("1");
  for (const [millivolts, code] of [[5000, "0x7FFFFF"], [6000, "0x7FFFFF"], [-5000, "0x800000"], [-6000, "0x800000"], [0, "0x000000"]]) {
    await page.locator("#adc-volt-mv").fill(String(millivolts));
    assert.equal(await page.locator("#adc-code").inputValue(), code);
  }
  for (const duty of [0, 50, 100]) {
    await page.locator("#tim-duty").fill(String(duty));
    assert.match(await page.locator("#tim-results-body tr").first().innerText(), new RegExp(`\\(${duty}\\.00%\\)`));
  }

  await page.locator("#mb-func").selectOption("16");
  for (const value of ["", "bad", "1oops", "65536", "-1", Array(124).fill("1").join(" ")]) {
    await page.locator("#mb-val").fill(value);
    await page.locator("#mb-build-btn").click();
    assert.equal(await page.locator("#mb-inspect-result .is-fault").count(), 1);
  }
  for (const value of ["0x1234 65535", Array(123).fill("0").join(" ")]) {
    await page.locator("#crc-mode").selectOption("ascii");
    await page.locator("#mb-val").fill(value);
    await page.locator("#mb-build-btn").click();
    assert.match(await page.locator("#mb-inspect-result").innerText(), /CRC 校验通过/);
    assert.equal(await page.locator("#crc-mode").inputValue(), "hex");
    assert.equal(await page.locator("#crc-modbus-frame").innerText(), await page.locator("#mb-inspect-input").inputValue());
  }
  await page.locator("#mb-inspect-input").fill("01 10 00 00 00 01 02 89 01");
  assert.match(await page.locator("#mb-inspect-result").innerText(), /实际帧长不一致/);
  console.log("Tools: literal error text, signed ADC saturation, PWM endpoints and Modbus payload validation passed.");

  await page.goto(base + "/projects/n32g455-tensile/index.html");
  await page.waitForFunction(() => window.FG?.selfCheck);
  assert.equal(await page.evaluate(() => FG.selfCheck.failed.length), 0);
  await page.evaluate(() => {
    window.keyEvents = [];
    const dispatch = FG.app.ui.dispatch.bind(FG.app.ui);
    FG.app.ui.dispatch = (event, tick) => { keyEvents.push(event); return dispatch(event, tick); };
  });
  const menu = page.locator('[data-key="MENU"]');
  await menu.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => FG.app.ui.page), 1);
  await page.keyboard.press("Space");
  assert.equal(await page.evaluate(() => FG.app.ui.page), 0);
  assert.equal(await page.evaluate(() => keyEvents.filter(e => e === FG.UI_EVENT.MENU).length), 2);
  await menu.click();
  assert.equal(await page.evaluate(() => FG.app.ui.page), 1);
  await menu.click();
  const unit = page.locator('[data-key="UNIT"]');
  await unit.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => keyEvents.at(-1)), await page.evaluate(() => FG.UI_EVENT.PREVIOUS));
  await page.locator('[data-key="DATA"]').focus();
  await page.keyboard.press("Space");
  assert.deepEqual(await page.evaluate(() => keyEvents.slice(-2)), await page.evaluate(() => [FG.UI_EVENT.NEXT, FG.UI_EVENT.DATA_RELEASE]));
  await page.locator('[data-key="PWR"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => keyEvents.at(-1)), await page.evaluate(() => FG.UI_EVENT.CONFIRM));
  await page.evaluate(() => {
    window.zeroCalls = 0;
    const zero = FG.app.handleZero.bind(FG.app);
    FG.app.handleZero = () => { zeroCalls++; return zero(); };
  });
  await page.locator('[data-key="ZERO"]').focus();
  await page.keyboard.press("Space");
  assert.equal(await page.evaluate(() => zeroCalls), 1);
  await unit.focus();
  const previousUnit = await page.evaluate(() => FG.app.settings.getForceUnit());
  await page.keyboard.down("Space");
  await page.keyboard.down("Space"); // Browser repeat must not restart the hold.
  await page.waitForFunction(old => FG.app.settings.getForceUnit() !== old, previousUnit);
  const nextUnit = await page.evaluate(() => FG.app.settings.getForceUnit());
  await page.keyboard.up("Space");
  assert.equal(await page.evaluate(() => FG.app.settings.getForceUnit()), nextUnit);
  const data = page.locator('[data-key="DATA"]');
  await data.focus();
  await page.evaluate(() => { keyEvents.length = 0; });
  await page.keyboard.down("Enter");
  await page.waitForFunction(() => keyEvents.includes(FG.UI_EVENT.DATA_HOLD));
  await page.keyboard.up("Enter");
  assert.deepEqual(await page.evaluate(() => keyEvents), await page.evaluate(() => [FG.UI_EVENT.DATA_HOLD, FG.UI_EVENT.DATA_RELEASE]));
  await menu.focus();
  await page.evaluate(() => { keyEvents.length = 0; });
  await page.keyboard.down("Space");
  await unit.focus();
  await page.keyboard.up("Space");
  assert.equal(await page.evaluate(() => keyEvents.length), 0, "Losing focus must cancel a held key");
  console.log("Tensile demo: 51 self-checks, Enter/Space, pointer parity, long holds, repeat and focus cancellation passed.");

  await page.addInitScript(() => {
    window.testGains = [];
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function (...args) {
      const node = createGain.apply(this, args);
      testGains.push(node);
      return node;
    };
    window.testTimeOffset = 0;
    const now = Date.now;
    Date.now = () => now() + window.testTimeOffset;
  });
  await page.goto(base + "/projects/ai-asmr/index.html");
  await page.locator("#selectSleepTimer").selectOption("15");
  await page.locator("#btnMainPlay").click();
  await page.waitForFunction(() => testGains[1]?.gain.value > 0.7);
  const volume = await page.locator("#rangeMasterVol").inputValue();
  await page.evaluate(() => { testTimeOffset = 895000; });
  await page.waitForFunction(() => testGains[1].gain.value < 0.5);
  await page.locator("#selectSleepTimer").selectOption("30");
  await page.waitForFunction(expected => Math.abs(testGains[1].gain.value - expected) < 0.01, Number(volume));
  await page.locator("#btnMainPlay").click();
  assert.deepEqual(errors, []);
  console.log("ASMR: extending a fading sleep timer restores the selected master volume.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
