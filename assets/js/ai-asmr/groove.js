/* A shared, softly drifting phrase clock for mixed playback only. */
(function () {
  "use strict";
  const beds = new Set(["rain", "water", "fire", "squish", "ambient"]);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smooth = value => value * value * (3 - 2 * value);
  const lerp = (a, b, amount) => a + (b - a) * amount;

  function hash(seed, index) {
    let value = Math.imul(seed ^ index, 0x45d9f3b);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  }

  function laneSeed(seed, id) {
    for (const letter of id) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
    return seed >>> 0;
  }

  function noise(seed, time) {
    const index = Math.floor(time);
    return lerp(hash(seed, index), hash(seed, index + 1), smooth(time - index)) * 2 - 1;
  }

  function create(startTime, seed) {
    const lanes = new Map();
    const phrases = [];
    let active = [];
    let enabled = true;
    let tempo = 2.2;
    let nextIndex = 0;
    let endTime = startTime;

    function append() {
      const index = nextIndex++;
      // A mean-reverting beat duration and individual rubato, never a timer grid.
      tempo = clamp(tempo + (2.2 - tempo) * 0.18 + (hash(seed, index * 17) - 0.5) * 0.18, 1.8, 2.6);
      const count = 4 + Math.floor(hash(seed, index * 17 + 1) * 3);
      const beats = [endTime];
      for (let n = 0; n < count; n++) beats.push(beats.at(-1) + tempo * (0.94 + hash(seed, index * 17 + n + 2) * 0.12));
      const phrase = { index, start: endTime, end: beats.at(-1), beats, tempo };
      phrases.push(phrase);
      endTime = phrase.end;
      if (phrases.length > 64) phrases.shift();
    }

    function phraseAt(when) {
      while (!phrases.length || endTime <= when) append();
      return phrases.find(phrase => phrase.end > when) || phrases.at(-1);
    }

    function leadFor(index) {
      if (!active.length) return null;
      // Each block lets every audible layer take a turn, with a new block offset.
      const block = Math.floor(index / active.length);
      return active[(index + Math.floor(hash(seed ^ 0x517cc1b7, block) * active.length)) % active.length];
    }

    function sample(id, when) {
      const lane = lanes.get(id);
      if (!enabled || !lane || !active.includes(id)) return { gain: 1, pace: 1, phrase: -1, lead: false };
      const phrase = phraseAt(when);
      const phase = clamp((when - phrase.start) / (phrase.end - phrase.start), 0, 1);
      const crest = 0.38 + hash(seed ^ 0x748f, phrase.index) * 0.24;
      const begin = 0.28 + hash(seed ^ 0x234a, phrase.index) * 0.32;
      const finish = 0.28 + hash(seed ^ 0x234a, phrase.index + 1) * 0.32;
      const peak = 0.76 + hash(seed ^ 0x19ce, phrase.index) * 0.24;
      const breath = phase < crest ? lerp(begin, peak, smooth(phase / crest)) : lerp(peak, finish, smooth((phase - crest) / (1 - crest)));
      const drift = noise(lane.seed, (when - startTime) / lane.period + lane.offset);
      // Fade the handoff around phrase boundaries rather than switching leaders.
      const handoff = Math.min(1, phase / 0.2, (1 - phase) / 0.2);
      const lead = leadFor(phrase.index) === id;
      const emphasis = lead ? smooth(handoff) : 0;
      const bed = beds.has(lane.category);
      return {
        gain: bed ? clamp(0.96 + breath * 0.028 + drift * 0.008, 0.94, 1)
          : clamp(0.90 + breath * 0.055 + drift * 0.012 + emphasis * 0.025, 0.86, 1),
        pace: 1 + (breath - 0.55) * (bed ? 0.07 : 0.12) + drift * (bed ? 0.018 : 0.032) + emphasis * (bed ? 0.006 : 0.018),
        phrase: phrase.index,
        lead
      };
    }

    return {
      add(id, category) {
        if (lanes.has(id)) return false;
        const localSeed = laneSeed(seed, id);
        lanes.set(id, { category, seed: localSeed, period: 7.3 + hash(localSeed, 1) * 4.6, offset: hash(localSeed, 2) * 8 });
        return true;
      },
      remove(id) { lanes.delete(id); active = active.filter(value => value !== id); },
      setActive(ids) { active = ids.filter(id => lanes.has(id)); },
      setEnabled(value) { enabled = value; },
      sample,
      entry(id) {
        const lane = lanes.get(id);
        return !enabled || !lane ? 0 : beds.has(lane.category) ? hash(lane.seed, 3) * 0.12 : 0.18 + hash(lane.seed, 3) * 1.1;
      },
      delay(id, milliseconds, when) {
        if (!enabled || !lanes.has(id) || !active.includes(id) || !Number.isFinite(milliseconds) || milliseconds <= 0) return milliseconds;
        const lane = lanes.get(id);
        const motion = sample(id, when);
        // Long natural events (thunder, bamboo tipping) keep almost all their spacing.
        const pace = milliseconds > 6000 ? 1 + (motion.pace - 1) * 0.3 : motion.pace;
        let delay = milliseconds / pace;
        // Only broad foreground gestures lean gently toward the common phrase.
        // Raindrops, stream bubbles and dense typing never get quantized to beats.
        if (!beds.has(lane.category) && milliseconds >= 400 && milliseconds <= 6000) {
          const target = when + delay / 1000;
          const phrase = phraseAt(target);
          const anchors = phrase.beats.slice();
          const offbeat = 0.35 + hash(lane.seed, 4) * 0.3;
          for (let n = 0; n < phrase.beats.length - 1; n++) anchors.push(lerp(phrase.beats[n], phrase.beats[n + 1], offbeat));
          const nearest = anchors.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best);
          const limit = Math.min(45, milliseconds * 0.06);
          delay += clamp((nearest - target) * 1000 * 0.08, -limit, limit);
        }
        return clamp(delay, milliseconds * 0.84, milliseconds * 1.18);
      },
      get retainedPhrases() { return phrases.length; }
    };
  }

  window.AsmrGroove = { create };
})();
