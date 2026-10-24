import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = { window: {} };
vm.runInNewContext(readFileSync("assets/js/ai-asmr/groove.js", "utf8"), sandbox);
const create = sandbox.window.AsmrGroove.create;
const ids = ["rain", "tap-a", "tap-b", "friction"];
function session() {
  const result = create(0, 20261025);
  result.add(ids[0], "rain");
  result.add(ids[1], "tapping");
  result.add(ids[2], "tapping");
  result.add(ids[3], "friction");
  result.setActive(ids);
  return result;
}

const groove = session();
const mirror = session();
const leaders = new Set();
const rainGains = [];
const tapGains = [];
const delays = new Set();
const phrases = new Set();
let maximumStep = 0;
let last = null;
let divergentLanes = 0;
for (let time = 0; time <= 3600; time += 0.25) {
  const values = ids.map(id => groove.sample(id, time));
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    assert(value.gain >= 0.86 && value.gain <= 1, "Motion must only attenuate the user's fader");
    assert(value.pace > 0.9 && value.pace < 1.12);
    assert.equal(value.gain, mirror.sample(ids[i], time).gain, "Seeded model must be reproducible");
    if (value.lead) leaders.add(ids[i]);
    phrases.add(value.phrase);
    if (last) maximumStep = Math.max(maximumStep, Math.abs(value.gain - last[i].gain));
    for (const base of [30, 120, 800, 3000, 15000]) {
      const delay = groove.delay(ids[i], base, time);
      assert(delay >= base * 0.84 && delay <= base * 1.18);
      if (i === 1 && base === 800) delays.add(Math.round(delay * 10));
    }
  }
  if (Math.abs(values[1].gain - values[2].gain) > 0.001) divergentLanes++;
  rainGains.push(values[0].gain);
  tapGains.push(values[1].gain);
  last = values;
}
const span = values => Math.max(...values) - Math.min(...values);
assert(maximumStep < 0.02, "Phrase changes must not create gain jumps");
assert(span(rainGains) < 0.04, "Natural background should stay stable");
assert(span(tapGains) > span(rainGains), "Foreground should breathe more than the background");
assert(divergentLanes > 1000, "Identical categories need independent variation");
assert.equal(leaders.size, 4, "All audible layers should take turns");
assert(delays.size > 100, "Gesture timing must vary rather than repeat a fixed grid");
assert(phrases.size > 200);
assert(groove.retainedPhrases <= 64, "Long playback must keep phrase storage bounded");

const ordered = session();
const lookahead = session();
lookahead.sample("tap-a", 90);
assert.equal(ordered.sample("tap-a", 84).gain, lookahead.sample("tap-a", 84).gain, "Audio lookahead must not change an earlier sample");
groove.setEnabled(false);
for (const id of ids) {
  assert.equal(groove.sample(id, 3601).gain, 1);
  assert.equal(groove.delay(id, 800, 3601), 800);
  assert.equal(groove.entry(id), 0);
}
groove.setEnabled(true);
groove.remove("tap-a");
assert.equal(groove.sample("tap-a", 3602).gain, 1);
assert.equal(groove.delay("rain", Infinity, 3602), Infinity);
console.log("ASMR groove: 1-hour model simulation, bounded gain/timing/storage, continuous handoffs, independent lanes, lookahead and bypass passed.");
console.log(JSON.stringify({ maximumStep, backgroundGainSpan: span(rainGains), foregroundGainSpan: span(tapGains), distinctGestureDelays: delays.size, phrases: phrases.size }));
