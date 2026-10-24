/* Shared audio-clock scheduling, circular noise and per-voice node ownership. */
(function () {
  "use strict";
  const noiseBanks = new WeakMap();

  function random(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }

  // The last crossfade sample tends into raw[overlap]; raw[overlap] begins the
  // following turn. No silent endpoints and no duplicated overlap on playback.
  function circularNoise(context, seconds, channels, rng, amplitude = 0.058) {
    const length = Math.round(context.sampleRate * seconds);
    const overlap = Math.round(context.sampleRate * 0.25);
    const warmup = Math.round(context.sampleRate * 0.5);
    const result = context.createBuffer(channels, length, context.sampleRate);
    for (let channel = 0; channel < channels; channel++) {
      const raw = new Float32Array(length + overlap);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = -warmup; i < raw.length; i++) {
        const white = rng() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        if (i >= 0) raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * amplitude;
        b6 = white * 0.115926;
      }
      const output = result.getChannelData(channel);
      output.set(raw.subarray(overlap, length + overlap));
      for (let i = 0; i < overlap; i++) {
        const angle = (i + 1) / overlap * Math.PI / 2;
        output[length - overlap + i] = raw[length + i] * Math.cos(angle) + raw[i] * Math.sin(angle);
      }
      let mean = 0;
      for (const sample of output) mean += sample;
      mean /= length;
      for (let i = 0; i < length; i++) output[i] -= mean;
    }
    return result;
  }

  function createScheduler(context) {
    const scopes = new Set();
    let timer = null;
    function tick() {
      const now = context.currentTime;
      let remaining = 128;
      for (const scope of scopes) remaining -= scope.pump(now, now + 0.15, Math.min(32, remaining));
    }
    return {
      add(scope) { scopes.add(scope); },
      remove(scope) { scopes.delete(scope); },
      start() { if (timer === null) { tick(); timer = setInterval(tick, 25); } },
      stop() { clearInterval(timer); timer = null; },
      tick,
      get sourceCount() { return [...scopes].reduce((n, s) => n + s.sourceCount, 0); }
    };
  }

  function createScope(context, scheduler) {
    const tasks = new Map();
    const nodes = new Set();
    const sources = new Set();
    const endHandlers = new Map();
    let cursor = null;
    let serial = 0;
    let disposed = false;
    let batch = null;
    const trackedContext = new Proxy(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (!String(key).startsWith("create") || key === "createBuffer" || key === "createPeriodicWave") return value.bind(target);
        return (...args) => {
          const node = value.apply(target, args);
          nodes.add(node);
          if (batch) batch.nodes.add(node);
          if (typeof node.start === "function") {
            sources.add(node);
            const owner = batch;
            if (owner) owner.live++;
            const ended = () => {
              endHandlers.delete(node);
              sources.delete(node);
              node.disconnect();
              nodes.delete(node);
              if (owner && --owner.live === 0) releaseBatch(owner);
            };
            endHandlers.set(node, ended);
            node.addEventListener("ended", ended, { once: true });
          }
          return node;
        };
      }
    });
    function releaseBatch(owner) {
      for (const node of owner.nodes) { node.disconnect(); nodes.delete(node); }
      owner.nodes.clear();
    }
    function run(fn, when) {
      if (disposed) return;
      const previousCursor = cursor;
      const previousBatch = batch;
      cursor = when;
      batch = { nodes: new Set(), live: 0 };
      try { return fn(); }
      finally {
        if (!batch.live) releaseBatch(batch);
        batch = previousBatch;
        cursor = previousCursor;
      }
    }
    const scope = {
      context: trackedContext,
      noise(seconds, channels, rng, amplitude = 0.058) {
        let bank = noiseBanks.get(context);
        if (!bank) { bank = new Map(); noiseBanks.set(context, bank); }
        const key = seconds + ":" + channels + ":" + amplitude;
        if (!bank.has(key)) bank.set(key, { buffers: [], cursor: 0 });
        const pool = bank.get(key);
        const slot = pool.cursor++ % (channels === 1 ? 8 : 4);
        if (!pool.buffers[slot]) pool.buffers[slot] = circularNoise(context, seconds, channels, rng, amplitude);
        return pool.buffers[slot];
      },
      time: () => cursor ?? context.currentTime,
      setTimeout(fn, ms, dropLate = false) {
        const id = ++serial;
        tasks.set(id, { fn, at: scope.time() + Math.max(0.001, ms / 1000), dropLate });
        return id;
      },
      clearTimeout(id) { tasks.delete(id); },
      cancel() { tasks.clear(); },
      run,
      pump(now, horizon, budget) {
        let used = 0;
        while (used < budget && !disposed) {
          let chosen = null;
          for (const [id, task] of tasks) {
            if (task.at <= horizon && (!chosen || task.at < chosen[1].at)) chosen = [id, task];
          }
          if (!chosen) break;
          const [id, task] = chosen;
          tasks.delete(id);
          if (task.dropLate && task.at < now - 0.15) { used++; continue; }
          // A delayed main thread gets one fresh continuation, never a backlog.
          const when = task.at < now + 0.005 ? now + 0.01 : task.at;
          if (sources.size >= 256 || scheduler.sourceCount >= 768) {
            if (!task.dropLate) tasks.set(id, { ...task, at: now + 0.2 });
          } else run(task.fn, when);
          used++;
        }
        return used;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        tasks.clear();
        scheduler.remove(scope);
        for (const source of sources) {
          source.removeEventListener("ended", endHandlers.get(source));
          try { source.stop(); } catch (_) { /* already ended */ }
        }
        endHandlers.clear();
        for (const node of nodes) node.disconnect();
        nodes.clear();
        sources.clear();
      },
      get sourceCount() { return sources.size; },
      get nodeCount() { return nodes.size; },
      get taskCount() { return tasks.size; }
    };
    scheduler.add(scope);
    return scope;
  }

  function ramp(param, value, when, seconds) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
    else {
      const current = param.value;
      param.cancelScheduledValues(when);
      param.setValueAtTime(current, when);
    }
    param.linearRampToValueAtTime(value, when + seconds);
  }

  window.AsmrRuntime = { random, circularNoise, createScheduler, createScope, ramp };
})();
