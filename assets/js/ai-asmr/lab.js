(function() {
  "use strict";

  // --------------------------------------------------------------------------
  // A. 声学配置与预设定义 (雨声 + 敲击声)
  // --------------------------------------------------------------------------
  const { RAIN_PRESETS, RAIN_SURFACES, TAPPING_MATERIALS, TAPPING_STYLES, FRICTION_MATERIALS, FRICTION_STYLES, WATER_SCENARIOS, WATER_STYLES, BOWLS_INSTRUMENTS, BOWLS_STYLES, TOOLS_INSTRUMENTS, TOOLS_STYLES, FIRE_INSTRUMENTS, FIRE_STYLES, SQUISH_MATERIALS, SQUISH_STYLES, KEYBOARD_SWITCHES, KEYBOARD_STYLES, AMBIENT_MEDIA, AMBIENT_STYLES, DEFAULT_STATE } = AsmrPresets;
  let state = { ...DEFAULT_STATE };

  // --------------------------------------------------------------------------
  // B. Web Audio API 纯原生程序化声学引擎
  // --------------------------------------------------------------------------
  let fireEmbers = [];
  let squishBlobs = [];
  let squishRipples = [];
  let squishCompression = 0;
  let keycapVisualEvents = [];
  let cosmicVisualEvents = [];
  // Each voice owns its state, nodes and audio-clock tasks. No global category swaps.
  const visualQueue = [];
  const visualFunctions = { registerAcousticEvent, createVisualEvent, createFrictionVisualStroke,
    createWaterVisualEvent, createBowlVisualEvent, createToolVisualEvent, createFireVisualEvent, createSquishVisualEvent };

  function flushTrackVisuals() {
    if (!audioCtx) return;
    for (let i = visualQueue.length - 1; i >= 0; i--) {
      const event = visualQueue[i];
      if (event.at > audioCtx.currentTime) continue;
      visualQueue.splice(i, 1);
      const track = independentTrack?.id === event.trackId ? independentTrack : tracks.find(t => t.id === event.trackId);
      if (!track || !track.branch || track.branch.voice.scope !== event.scope || !isAudible(track) || event.at < audioCtx.currentTime - 0.5) continue;
      const before = radarBeacons.length;
      if (event.kind === "keycap") keycapVisualEvents.push({ ...event.args[0], trackId: event.trackId });
      else if (event.kind === "cosmic") cosmicVisualEvents.push({ ...event.args[0], trackId: event.trackId });
      else if (event.kind === "earLeft") earWavesL.push(event.args[0]);
      else if (event.kind === "earRight") earWavesR.push(event.args[0]);
      else visualFunctions[event.kind](...event.args);
      for (let j = before; j < radarBeacons.length; j++) radarBeacons[j].trackId = event.trackId;
    }
    for (const particles of [earWavesL, earWavesR, fireEmbers, squishBlobs, squishRipples,
      keycapVisualEvents, cosmicVisualEvents, fricParticles, fricStrokes, waterBubbles,
      waterRipples, bowlRings, chimeSparkles, toolVisualEvents, rippleParticles, tapShockwaves]) {
      if (particles.length > 100) particles.splice(0, particles.length - 100);
    }
  }

  function createVoice(config, scope, output, trackId, arrangement = null) {
    return AsmrVoices.create(config, scope, output, trackId, {
      reducedMotion, isDarkThemeActive,
      getDimensions: () => ({ width: logicalWidth, height: logicalHeight }),
      timing: arrangement ? (delay, when) => arrangement.delay(trackId, delay, when) : null,
      emit(event) {
        if (!document.hidden && !reducedMotion.matches && visualQueue.length < 128) visualQueue.push(event);
      }
    });
  }

  const PARAM_BUTTONS = [[".preset-btn","currentRain","data-rain"],[".surface-btn","currentSurface","data-surface"],[".tap-mat-btn","currentTapMat","data-mat"],[".tap-style-btn","currentTapStyle","data-style"],[".fric-mat-btn","currentFricMat","data-mat"],[".fric-style-btn","currentFricStyle","data-style"],[".water-scene-btn","currentWaterScene","data-scene"],[".water-style-btn","currentWaterStyle","data-style"],[".bowl-inst-btn","currentBowlInst","data-inst"],[".bowl-style-btn","currentBowlStyle","data-style"],[".tool-inst-btn","currentToolInst","data-inst"],[".tool-style-btn","currentToolStyle","data-style"],[".fire-inst-btn","currentFireInst","data-inst"],[".fire-style-btn","currentFireStyle","data-style"],[".squish-mat-btn","currentSquishMat","data-mat"],[".squish-style-btn","currentSquishStyle","data-style"],[".key-sw-btn","currentKeySwitch","data-switch"],[".key-style-btn","currentKeyStyle","data-style"],[".amb-media-btn","currentAmbMedia","data-media"],[".amb-style-btn","currentAmbStyle","data-style"]];
  const PARAM_RANGES = [["rangeDropDensity","dropRateMultiplier"],["rangeThunder","thunderVol"],["rangeTapCadence","tapCadenceMultiplier"],["rangeTapSoftness","tapSoftness"],["rangeFricSpeed","fricSpeedMultiplier"],["rangeFricCushion","fricCushion"],["rangeWaterSpeed","waterSpeedMultiplier"],["rangeWaterSoftness","waterSoftness"],["rangeBowlDecay","bowlDecayMultiplier"],["rangeBowlWarmth","bowlWarmth"],["rangeToolPace","toolPaceMultiplier"],["rangeToolWarmth","toolWarmth"],["rangeFireRate","fireRateMultiplier"],["rangeFireWarmth","fireWarmth"],["rangeSquishCadence","squishCadenceMultiplier"],["rangeSquishViscosity","squishViscosity"],["rangeKeyCadence","keyCadenceMultiplier"],["rangeKeyThock","keyThockDamping"],["rangeAmbientDepth","ambDepth"],["rangeAmbientGrain","ambGrain"]];
  const CONFIG_KEYS = ["currentRain","currentSurface","currentTapMat","currentTapStyle","currentFricMat","currentFricStyle","currentWaterScene","currentWaterStyle","currentBowlInst","currentBowlStyle","currentToolInst","currentToolStyle","currentFireInst","currentFireStyle","currentSquishMat","currentSquishStyle","currentKeySwitch","currentKeyStyle","currentAmbMedia","currentAmbStyle","dropRateMultiplier","thunderVol","tapCadenceMultiplier","tapSoftness","fricSpeedMultiplier","fricCushion","waterSpeedMultiplier","waterSoftness","bowlDecayMultiplier","bowlWarmth","toolPaceMultiplier","toolWarmth","fireRateMultiplier","fireWarmth","squishCadenceMultiplier","squishViscosity","keyCadenceMultiplier","keyThockDamping","ambDepth","ambGrain"];

  const tracks = [];
  const retiring = new Set();
  const initialState = { ...state };
  let audioCtx = null;
  let masterGain = null;
  let masterFilter = null;
  let mixInput = null;
  let scheduler = null;
  let sleepTimerTickId = null;
  let selectedTrackId = null;
  let browserDraft = null;
  let syncingEditor = false;
  let playVersion = 0;
  let transportState = "stopped";
  let cleanupTimer = null;
  let contextTransition = Promise.resolve();
  let playbackMode = null;
  let independentTrack = null;
  let grooveSession = null;
  let grooveScope = null;
  let grooveEnabled = true;

  function startGrooveClock() {
    if (!grooveScope || !grooveSession) return;
    const scope = grooveScope;
    const session = grooveSession;
    const advance = () => {
      if (grooveSession !== session || playbackMode !== "mix") return;
      const when = scope.time();
      session.setActive(tracks.filter(track => isAudible(track) && track.volume > 0).map(track => track.id));
      for (const track of tracks) {
        if (track.branch) track.branch.motion.gain.setTargetAtTime(session.sample(track.id, when).gain, when, 0.65);
      }
      scope.setTimeout(advance, 250);
    };
    scope.run(advance, audioCtx.currentTime + 0.02);
  }

  function stopGrooveClock() {
    if (grooveScope) grooveScope.dispose();
    grooveScope = null;
    grooveSession = null;
  }

  function changeContext(method, version) {
    contextTransition = contextTransition.catch(() => {}).then(() => {
      if (version === playVersion) return audioCtx[method]();
    });
    return contextTransition;
  }

  function configFrom(source) {
    return Object.fromEntries(CONFIG_KEYS.map(key => [key, source[key]]));
  }

  function trackName(track) {
    const c = track.config;
    const names = {
      rain: () => RAIN_PRESETS[c.currentRain].name + " · " + RAIN_SURFACES[c.currentSurface].name,
      tapping: () => TAPPING_MATERIALS[c.currentTapMat].name,
      friction: () => FRICTION_MATERIALS[c.currentFricMat].name,
      water: () => WATER_SCENARIOS[c.currentWaterScene].name,
      bowls: () => BOWLS_INSTRUMENTS[c.currentBowlInst].name,
      tools: () => TOOLS_INSTRUMENTS[c.currentToolInst].name,
      fire: () => FIRE_INSTRUMENTS[c.currentFireInst].name,
      squish: () => SQUISH_MATERIALS[c.currentSquishMat].name,
      keyboard: () => KEYBOARD_SWITCHES[c.currentKeySwitch].name,
      ambient: () => AMBIENT_MEDIA[c.currentAmbMedia].name
    };
    const style = trackStyle(track);
    return names[track.category]() + (style ? " · " + style.name : "");
  }

  function trackStyle(track) {
    const c = track.config;
    return { tapping: TAPPING_STYLES[c.currentTapStyle], friction: FRICTION_STYLES[c.currentFricStyle],
      water: WATER_STYLES[c.currentWaterStyle], bowls: BOWLS_STYLES[c.currentBowlStyle],
      tools: TOOLS_STYLES[c.currentToolStyle], fire: FIRE_STYLES[c.currentFireStyle],
      squish: SQUISH_STYLES[c.currentSquishStyle], keyboard: KEYBOARD_STYLES[c.currentKeyStyle],
      ambient: AMBIENT_STYLES[c.currentAmbStyle] }[track.category];
  }

  function initAudioEngine() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("此浏览器暂不支持 Web Audio");
    audioCtx = new AudioContextClass();
    mixInput = audioCtx.createGain();
    mixInput.gain.value = 0.45; // Fixed headroom; adding a track never turns down existing tracks.
    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = state.userLowpass;
    masterFilter.Q.value = 0.65;
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 6;
    compressor.ratio.value = 16;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;
    mixInput.connect(masterFilter).connect(compressor).connect(masterGain).connect(audioCtx.destination);
    scheduler = AsmrRuntime.createScheduler(audioCtx);
    audioCtx.addEventListener("statechange", () => {
      if (audioCtx.state !== "running" && transportState === "playing") {
        stopAudio();
        announce("音频已中断，点击播放恢复混音。");
      }
    });
  }

  function announce(message) {
    document.getElementById("mixerStatus").textContent = message;
    document.getElementById("playbackStatus").textContent = message;
  }

  function startTrack(track) {
    const output = audioCtx.createGain();
    const motion = audioCtx.createGain();
    const gate = audioCtx.createGain();
    const arrangement = playbackMode === "mix" ? grooveSession : null;
    const firstEntry = arrangement?.add(track.id, track.category);
    output.gain.value = track.volume;
    motion.gain.value = arrangement ? arrangement.sample(track.id, audioCtx.currentTime).gain : 1;
    gate.gain.value = 0;
    output.connect(motion).connect(gate).connect(mixInput);
    const scope = AsmrRuntime.createScope(audioCtx, scheduler);
    const voice = createVoice({ ...initialState, ...track.config, activeCategory: track.category,
      userLowpass: state.userLowpass, stereoWidth: state.stereoWidth }, scope, output, track.id, arrangement);
    const branch = { voice, output, motion, gate, until: null };
    try { voice.start(audioCtx.currentTime + 0.02 + (firstEntry ? arrangement.entry(track.id) : 0)); }
    catch (error) { voice.dispose(); output.disconnect(); motion.disconnect(); gate.disconnect(); arrangement?.remove(track.id); throw error; }
    track.branch = branch;
  }

  function releaseBranch(branch) {
    branch.voice.dispose();
    branch.output.disconnect();
    branch.motion.disconnect();
    branch.gate.disconnect();
    retiring.delete(branch);
  }

  function cleanRetiring() {
    for (const branch of retiring) {
      if (audioCtx.state !== "running" || audioCtx.currentTime >= branch.until) releaseBranch(branch);
    }
    if (!retiring.size && cleanupTimer !== null) { clearInterval(cleanupTimer); cleanupTimer = null; }
  }

  function retireTrack(track) {
    clearTimeout(track.replaceTimer);
    track.replaceTimer = null;
    track.pendingTopology = false;
    const branch = track.branch;
    if (!branch) return;
    track.branch = null;
    branch.voice.stop();
    AsmrRuntime.ramp(branch.gate.gain, 0, audioCtx.currentTime, 0.4);
    branch.until = audioCtx.currentTime + 0.42;
    retiring.add(branch);
    if (cleanupTimer === null) cleanupTimer = setInterval(cleanRetiring, 50);
  }

  function isAudible(track) {
    if (track === independentTrack) return true;
    return !track.muted && (!tracks.some(t => t.solo) || track.solo);
  }

  function updateGates() {
    if (!audioCtx) return;
    grooveSession?.setActive(tracks.filter(track => isAudible(track) && track.volume > 0).map(track => track.id));
    for (const track of tracks) {
      if (track.branch) AsmrRuntime.ramp(track.branch.gate.gain, isAudible(track) ? 1 : 0, audioCtx.currentTime, 0.4);
    }
    if (independentTrack?.branch) AsmrRuntime.ramp(independentTrack.branch.gate.gain, 1, audioCtx.currentTime, 0.4);
  }

  function addTrack() {
    if (tracks.length >= 4) { announce("最多同时混合 4 轨，请先移除一个声音。"); return; }
    if (audioCtx) cleanRetiring();
    if (playbackMode === "mix" && transportState === "playing" && retiring.size >= 4) { announce("声音正在平滑退出，请稍后再加入。"); return; }
    const track = { id: crypto.randomUUID(), category: state.activeCategory,
      config: configFrom(state), volume: 0.65, muted: false, solo: false, branch: null };
    tracks.push(track);
    if (playbackMode === "mix" && transportState === "playing") {
      try { startTrack(track); updateGates(); }
      catch (error) { tracks.pop(); announce("声音加入失败：" + error.message); return; }
    }
    renderMixer();
    generatePrompt();
    announce("已加入：" + trackName(track));
  }

  async function startAudio(mode = "independent") {
    if ((transportState === "starting" || transportState === "playing") && playbackMode === mode) return;
    const switchingMode = playbackMode && playbackMode !== mode;
    if (transportState === "starting" || transportState === "playing") stopAudio();
    const version = ++playVersion;
    transportState = "starting";
    playbackMode = mode;
    announce(mode === "mix" ? "正在启动混音…" : "正在启动独立播放…");
    updateUIPlayState();
    try {
      initAudioEngine();
      await changeContext("resume", version);
      if (version !== playVersion) return;
      if (audioCtx.state !== "running") throw new Error("音频未能启动，请再次点击播放");
      while (retiring.size > (switchingMode ? 0 : 4)) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (version !== playVersion) return;
        cleanRetiring();
      }
      if (audioCtx.state !== "running") throw new Error("音频在切换期间被中断，请再次点击播放");
      if (mode === "mix") {
        grooveSession = AsmrGroove.create(audioCtx.currentTime, crypto.getRandomValues(new Uint32Array(1))[0]);
        grooveSession.setEnabled(grooveEnabled);
        grooveScope = AsmrRuntime.createScope(audioCtx, scheduler);
        if (!tracks.length) addTrack();
        for (const track of tracks) startTrack(track);
      } else {
        independentTrack = { id: "independent-" + version, category: state.activeCategory,
          config: configFrom(state), volume: 1, muted: false, solo: false, branch: null };
        startTrack(independentTrack);
      }
      state.isPlaying = true;
      transportState = "playing";
      if (state.sleepTimerMinutes > 0) state.sleepTimerEnd = Date.now() + state.sleepTimerMinutes * 60000;
      updateGates();
      if (mode === "mix") startGrooveClock();
      mixInput.gain.setTargetAtTime(mode === "mix" ? 0.45 : 1, audioCtx.currentTime, 0.08);
      AsmrRuntime.ramp(masterGain.gain, state.masterVol, audioCtx.currentTime, 0.4);
      scheduler.start();
      updateSleepTimer();
      announce(mode === "mix" ? "正在播放 " + tracks.length + " 轨混音 · 独立播放已关闭" : "正在独立播放 · 混音已关闭");
    } catch (error) {
      if (version !== playVersion) return;
      stopAudio();
      announce("播放失败：" + error.message);
    }
    updateUIPlayState();
    renderMixer();
  }

  function stopAudio() {
    const previousMode = playbackMode;
    const version = ++playVersion;
    state.isPlaying = false;
    transportState = "pausing";
    if (scheduler) scheduler.stop();
    stopGrooveClock();
    clearTimeout(sleepTimerTickId);
    sleepTimerTickId = null;
    for (const track of tracks) retireTrack(track);
    if (independentTrack) retireTrack(independentTrack);
    independentTrack = null;
    playbackMode = null;
    if (previousMode) announce(previousMode === "mix" ? "混音已暂停" : "独立播放已暂停");
    if (audioCtx) {
      AsmrRuntime.ramp(masterGain.gain, 0, audioCtx.currentTime, 0.4);
      setTimeout(async () => {
        if (version !== playVersion) return;
        for (const branch of [...retiring]) releaseBranch(branch);
        try { await changeContext("suspend", version); } catch (_) { /* interruption may already have suspended it */ }
        if (version === playVersion) { transportState = "stopped"; updateUIPlayState(); }
      }, 450);
    } else transportState = "stopped";
    updateUIPlayState();
    renderMixer();
  }

  function updateAcousticNodes() {
    if (!audioCtx) return;
    masterFilter.frequency.setTargetAtTime(state.userLowpass, audioCtx.currentTime, 0.08);
    for (const track of tracks) if (track.branch) track.branch.voice.update({ userLowpass: state.userLowpass, stereoWidth: state.stereoWidth });
    if (independentTrack?.branch) independentTrack.branch.voice.update({ userLowpass: state.userLowpass, stereoWidth: state.stereoWidth });
  }

  function applyTrackConfig(track, topologyChanged) {
    if (!track.branch || transportState !== "playing") return;
    if (!topologyChanged && !track.pendingTopology) { track.branch.voice.update(track.config); return; }
    clearTimeout(track.replaceTimer);
    cleanRetiring();
    const capacityAt = retiring.size >= 4 ? Math.min(...[...retiring].map(branch => branch.until)) : 0;
    const remaining = Math.max(track.transitionUntil || 0, capacityAt) - audioCtx.currentTime;
    if (remaining > 0) {
      // Coalesce rapid material changes instead of cutting an in-flight fade.
      track.pendingTopology = true;
      track.replaceTimer = setTimeout(() => applyTrackConfig(track, true), remaining * 1000 + 20);
      return;
    }
    cleanRetiring();
    retireTrack(track);
    try { startTrack(track); updateGates(); track.transitionUntil = audioCtx.currentTime + 0.42; }
    catch (error) { announce("更新声音失败：" + error.message); }
  }

  function syncIndependentConfig() {
    if (playbackMode !== "independent" || !independentTrack) return;
    const next = configFrom(state);
    const topologyChanged = PARAM_BUTTONS.some(([, key]) => next[key] !== independentTrack.config[key]);
    independentTrack.config = next;
    applyTrackConfig(independentTrack, topologyChanged);
  }

  function syncEditor(config, category) {
    syncingEditor = true;
    try {
      Object.assign(state, config);
      switchCategory(category);
      for (const [selector, key, attribute] of PARAM_BUTTONS) {
        for (const button of document.querySelectorAll(selector)) {
          const active = button.getAttribute(attribute) === state[key];
          button.classList.toggle("active", active);
          button.setAttribute("aria-checked", String(active));
        }
      }
      for (const [id, key] of PARAM_RANGES) {
        const range = document.getElementById(id);
        range.value = state[key];
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } finally { syncingEditor = false; }
    syncIndependentConfig();
    generatePrompt();
  }

  function leaveTrackEditor() {
    if (!selectedTrackId) return;
    selectedTrackId = null;
    const draft = browserDraft;
    browserDraft = null;
    if (draft) syncEditor(draft.config, draft.category);
    renderMixer();
  }

  function editTrack(track) {
    if (!selectedTrackId) browserDraft = { config: configFrom(state), category: state.activeCategory };
    selectedTrackId = track.id;
    syncEditor(track.config, track.category);
    renderMixer();
    document.getElementById("mixerEditorLabel").focus({ preventScroll: true });
  }

  function auditionTrack(azimuth) {
    if (playbackMode === "independent") {
      independentTrack?.branch?.voice.audition(azimuth);
      return;
    }
    const track = tracks.find(t => t.id === selectedTrackId) || tracks.find(t => t.category === state.activeCategory && isAudible(t));
    if (track && track.branch && isAudible(track)) track.branch.voice.audition(azimuth);
    else announce("请先将当前声音加入混音，或选择一个正在播放的轨道。");
  }

  function renderMixer() {
    const list = document.getElementById("mixerTracks");
    const focused = document.activeElement;
    const focusTrack = focused?.closest("[data-track]")?.dataset.track;
    const focusAction = focused?.dataset.action;
    list.replaceChildren();
    for (const track of tracks) {
      const row = document.createElement("li");
      row.className = "mixer-track";
      row.dataset.track = track.id;
      row.dataset.audible = String(isAudible(track));
      const title = document.createElement("strong");
      title.textContent = trackName(track);
      const label = document.createElement("label");
      label.textContent = "音量 ";
      const range = document.createElement("input");
      range.type = "range"; range.min = "0"; range.max = "1"; range.step = "0.01";
      range.value = track.volume; range.dataset.action = "volume";
      range.setAttribute("aria-label", trackName(track) + "音量");
      const value = document.createElement("output");
      value.textContent = Math.round(track.volume * 100) + "%";
      range.addEventListener("input", () => {
        track.volume = Number(range.value);
        value.textContent = Math.round(track.volume * 100) + "%";
        if (track.branch) AsmrRuntime.ramp(track.branch.output.gain, track.volume, audioCtx.currentTime, 0.05);
      });
      range.addEventListener("change", generatePrompt);
      label.append(range, value);
      const actions = document.createElement("div");
      actions.className = "mixer-track-actions";
      for (const [action, text] of [["muted", "静音"], ["solo", "独听"], ["edit", "编辑"], ["remove", "移除"]]) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = text; button.dataset.action = action;
        button.setAttribute("aria-label", text + "：" + trackName(track));
        if (action === "muted" || action === "solo") button.setAttribute("aria-pressed", String(track[action]));
        if (action === "edit") button.setAttribute("aria-pressed", String(selectedTrackId === track.id));
        button.addEventListener("click", () => {
          if (action === "edit") { editTrack(track); return; }
          if (action === "remove") {
            if (selectedTrackId === track.id) leaveTrackEditor();
            retireTrack(track);
            tracks.splice(tracks.indexOf(track), 1);
            grooveSession?.remove(track.id);
            if (!tracks.length && playbackMode === "mix") stopAudio();
            announce("已移除：" + trackName(track));
          } else track[action] = !track[action];
          updateGates(); renderMixer(); generatePrompt();
          if (action === "remove") document.getElementById("btnAddToMix").focus({ preventScroll: true });
        });
        actions.append(button);
      }
      row.append(title, label, actions);
      list.append(row);
    }
    const selected = tracks.find(t => t.id === selectedTrackId);
    document.getElementById("mixerEditorLabel").textContent = selected ? "正在编辑：" + trackName(selected) : "浏览声音 · 选择后加入混音";
    document.getElementById("btnLeaveTrackEditor").hidden = !selected;
    document.getElementById("mixerTrackCount").textContent = tracks.length + " / 4 轨";
    document.getElementById("btnAddToMix").setAttribute("aria-disabled", String(tracks.length >= 4));
    updateUIPlayState();
    if (focusTrack && focusAction) list.querySelector(`[data-track="${focusTrack}"] [data-action="${focusAction}"]`)?.focus({ preventScroll: true });
  }

  function setupMixer() {
    const toggle = document.getElementById("btnMixerToggle");
    const body = document.getElementById("mixerBody");
    const setExpanded = expanded => {
      body.hidden = !expanded;
      toggle.setAttribute("aria-expanded", String(expanded));
      document.getElementById("mixerDock").dataset.expanded = String(expanded);
      document.getElementById("mixerToggleLabel").textContent = expanded ? "收纳混音" : "展开混音";
      if (!expanded) { leaveTrackEditor(); toggle.focus({ preventScroll: true }); }
    };
    toggle.addEventListener("click", () => setExpanded(toggle.getAttribute("aria-expanded") !== "true"));
    document.getElementById("mixerDock").addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
    });
    document.getElementById("btnMixPlay").addEventListener("click", () => {
      if (playbackMode === "mix" && (state.isPlaying || transportState === "starting")) stopAudio();
      else startAudio("mix");
    });
    document.getElementById("btnMixGroove").addEventListener("click", event => {
      grooveEnabled = !grooveEnabled;
      grooveSession?.setEnabled(grooveEnabled);
      event.currentTarget.setAttribute("aria-pressed", String(grooveEnabled));
      event.currentTarget.textContent = "自然律动：" + (grooveEnabled ? "开" : "关");
    });
    document.getElementById("btnAddToMix").addEventListener("click", addTrack);
    document.getElementById("btnLeaveTrackEditor").addEventListener("click", leaveTrackEditor);
    const paramSelector = [...PARAM_BUTTONS.map(p => p[0]), ...PARAM_RANGES.map(p => "#" + p[0])].join(",");
    const changed = event => {
      if (syncingEditor) return;
      if (event.target.id === "rangeStereoWidth") updateAcousticNodes();
      if (!event.target.closest(paramSelector)) return;
      const track = tracks.find(t => t.id === selectedTrackId);
      if (track) {
        const next = configFrom(state);
        const topologyChanged = PARAM_BUTTONS.some(([, key]) => next[key] !== track.config[key]);
        track.config = next;
        applyTrackConfig(track, topologyChanged);
        if (event.type === "click") renderMixer();
      }
      syncIndependentConfig();
      generatePrompt();
    };
    document.querySelector(".asmr-lab-page").addEventListener("click", changed);
    document.querySelector(".asmr-lab-page").addEventListener("input", changed);
    document.addEventListener("visibilitychange", () => {
      if (state.isPlaying) {
        if (state.sleepTimerMinutes > 0 && Date.now() >= state.sleepTimerEnd) stopAudio();
        else updateSleepTimer();
      }
    });
    window.addEventListener("pagehide", () => {
      stopAudio();
      for (const branch of [...retiring]) releaseBranch(branch);
    });
    renderMixer();
  }

  // --------------------------------------------------------------------------
  // C. Canvas 动画渲染引擎 (雨丝/敲击波纹/3Dio 声场环)
  // --------------------------------------------------------------------------
  const canvas = document.getElementById("asmrCanvas");
  const ctx = canvas.getContext("2d");
  let rainParticles = [];
  let rippleParticles = [];
  let tapShockwaves = [];
  let fricStrokes = [];
  let fricParticles = [];
  let waterBubbles = [];
  let waterRipples = [];
  let waterWaveOffset = 0;
  let bowlRings = [];
  let chimeSparkles = [];
  let toolVisualEvents = [];
  let bowlRimAngle = 0;
  let earWavesL = [];
  let earWavesR = [];
  let animFrameId = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compactViewport = window.matchMedia("(max-width: 760px)");
  let lastRenderTime = 0;

  // 3Dio 双耳空间全景声学雷达与实时声场监视器状态
  let radarSweepAngle = -Math.PI / 2;
  let radarBeacons = []; // 实时声源信标
  let earDiffractionL = []; // 左耳 HRTF 衍射光环
  let earDiffractionR = []; // 右耳 HRTF 衍射光环
  let meterLevelL = 0; // 左声道声压 (0~1)
  let meterLevelR = 0; // 右声道声压 (0~1)
  let meterPeakL = 0;  // 左声道峰值
  let meterPeakR = 0;  // 右声道峰值
  let meterPeakHoldTimerL = 0;
  let meterPeakHoldTimerR = 0;
  let goniometerAngle = 0;

  let logicalWidth = 960;
  let logicalHeight = 380;
  let dpr = 1;

  // 检测全局站点是否处于深色主题模式 (联动 theme.js / base.css / system)
  function isDarkThemeActive() {
    const theme = document.documentElement.dataset.theme;
    if (theme === "dark" || theme === "hud") return true;
    if (theme === "light" || theme === "swiss" || theme === "mono") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // 雨丝粒子类
  class RainStreak {
    constructor() {
      this.reset(true);
    }
    reset(randomY = false) {
      this.x = Math.random() * (logicalWidth + 60) - 30;
      this.y = randomY ? Math.random() * logicalHeight : -20;
      this.len = 10 + Math.random() * 20;
      this.speed = 3.5 + Math.random() * 6.5;
      this.wind = -0.5 + Math.random() * 1.0;
      this.alpha = 0.15 + Math.random() * 0.35;
      this.width = 0.8 + Math.random() * 0.8;
    }
    update(windSpeed = 0) {
      this.y += this.speed;
      this.x += this.wind + windSpeed * 0.8;
      if (this.y > logicalHeight - 35) {
        if (Math.random() < 0.22 && rippleParticles.length < 45) {
          rippleParticles.push({
            x: this.x,
            y: logicalHeight - 35 + (Math.random() * 20 - 10),
            rx: 2,
            ry: 0.8,
            maxR: 12 + Math.random() * 14,
            alpha: 0.45,
            color: isDarkThemeActive() ? "rgba(45, 212, 191," : "rgba(13, 148, 136,"
          });
        }
        this.reset(false);
      }
    }
    draw(context) {
      context.beginPath();
      context.moveTo(this.x, this.y);
      context.lineTo(this.x + this.wind * 1.8, this.y + this.len);
      const isDark = isDarkThemeActive();
      context.strokeStyle = (isDark ? "rgba(186, 230, 253, " : "rgba(14, 116, 144, ") + this.alpha.toFixed(2) + ")";
      context.lineWidth = this.width;
      context.stroke();
    }
  }

  function initParticles() {
    rainParticles = [];
    const count = Math.round(Math.min(110, Math.max(35, logicalWidth / 8)));
    for (let i = 0; i < count; i++) {
      rainParticles.push(new RainStreak());
    }
  }

  // 统一声学事件注册（驱动 3Dio 声学雷达、双耳电平表、示波器）
  function registerAcousticEvent(azimuth, vel, category = "ambient", label = "Sound") {
    if (document.hidden || reducedMotion.matches) return;
    const isDark = isDarkThemeActive();
    const az = Math.max(-1, Math.min(1, azimuth));
    const leftWeight = Math.max(0.15, (1 - az) / 2);
    const rightWeight = Math.max(0.15, (1 + az) / 2);
    const energyL = Math.min(1.0, vel * leftWeight * 1.6);
    const energyR = Math.min(1.0, vel * rightWeight * 1.6);

    meterLevelL = Math.max(meterLevelL, energyL);
    meterLevelR = Math.max(meterLevelR, energyR);

    if (meterLevelL > meterPeakL) {
      meterPeakL = meterLevelL;
      meterPeakHoldTimerL = 24;
    }
    if (meterLevelR > meterPeakR) {
      meterPeakR = meterLevelR;
      meterPeakHoldTimerR = 24;
    }

    // 激发 3Dio 假人头左右耳廓的 HRTF 空间声波衍射光环
    if (energyL > 0.12 && earDiffractionL.length < 14) {
      earDiffractionL.push({ r: 6, maxR: 35 + energyL * 45, alpha: 0.9, speed: 1.6 + energyL * 1.4 });
    }
    if (energyR > 0.12 && earDiffractionR.length < 14) {
      earDiffractionR.push({ r: 6, maxR: 35 + energyR * 45, alpha: 0.9, speed: 1.6 + energyR * 1.4 });
    }

    // 在 3Dio 极坐标雷达上投射高精声源信标 (Acoustic Beacon)
    if (radarBeacons.length < 22) {
      const radarAngle = -Math.PI / 2 + az * (Math.PI * 0.48);
      const radarDist = 65 + (1 - Math.min(1, vel * 0.7)) * 80 + (Math.random() * 16 - 8);

      let beaconColor = isDark ? "rgba(45, 212, 191, " : "rgba(13, 148, 136, ";
      if (az < -0.25) {
        beaconColor = isDark ? "rgba(45, 212, 191, " : "rgba(13, 148, 136, ";
      } else if (az > 0.25) {
        beaconColor = isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, ";
      } else {
        beaconColor = isDark ? "rgba(251, 191, 36, " : "rgba(217, 119, 6, ";
      }

      radarBeacons.push({
        angle: radarAngle,
        dist: radarDist,
        azimuth: az,
        vel,
        label: label || category || "Sound",
        alpha: 1.0,
        color: beaconColor,
        waveR: 4,
        maxWaveR: 48 + vel * 36
      });
    }
  }

  // 接收 Web Audio 触发可视化事件 (主题自适应高对比色调)
  function createVisualEvent(azimuth, vel, type = "rain") {
    if (document.hidden || reducedMotion.matches) return;
    registerAcousticEvent(azimuth, vel, type, type === "rain" ? "Raindrop" : "Tapping");

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.82) + (logicalWidth * 0.09);
    const isLeft = azimuth < 0;
    const rainColorPrefix = isLeft
      ? (isDark ? "rgba(45, 212, 191," : "rgba(13, 148, 136,")
      : (isDark ? "rgba(56, 189, 248," : "rgba(2, 132, 199,");

    if (type === "rain") {
      if (rippleParticles.length < 50) {
        rippleParticles.push({
          x: posX,
          y: logicalHeight - 45 + (Math.random() * 25 - 12),
          rx: 2,
          ry: 0.7,
          maxR: 24 + vel * 32,
          alpha: 0.65,
          color: rainColorPrefix
        });
      }
    } else {
      // 敲击声专属共鸣波纹 (Tapping Shockwave)
      if (tapShockwaves.length < 35) {
        tapShockwaves.push({
          x: posX,
          y: logicalHeight - 55,
          r: 4,
          maxR: 35 + vel * 45,
          alpha: 0.85,
          color: isLeft
            ? (isDark ? "rgba(45, 212, 191," : "rgba(13, 148, 136,")
            : (isDark ? "rgba(241, 166, 90," : "rgba(217, 119, 6,")
        });
      }
    }

    // 3Dio 耳部声波辐射
    if (isLeft) {
      earWavesL.push({ r: 8, maxR: 45 + vel * 35, alpha: 0.8 });
    } else {
      earWavesR.push({ r: 8, maxR: 45 + vel * 35, alpha: 0.8 });
    }
  }

  function createFrictionVisualStroke(panStart, panEnd, duration, matKey, styleKey, velScale = 0.85, panMid = null) {
    if (document.hidden || reducedMotion.matches) return;
    const midPan = panMid !== null ? panMid : (panStart + panEnd) / 2;
    const normVel = Math.max(0.35, Math.min(1.0, velScale * 0.82));
    registerAcousticEvent(midPan, normVel, "friction", "Friction · " + matKey);

    const isDark = isDarkThemeActive();
    const x1 = ((panStart + 1) / 2) * (logicalWidth * 0.72) + (logicalWidth * 0.14);
    const x2 = ((panEnd + 1) / 2) * (logicalWidth * 0.72) + (logicalWidth * 0.14);
    const xMid = ((midPan + 1) / 2) * (logicalWidth * 0.72) + (logicalWidth * 0.14);
    const yCenter = logicalHeight / 2 - 12;
    const yOffset = (Math.random() * 44 - 22);

    const darkColors = {
      brush: "rgba(251, 191, 160,",
      velvet: "rgba(244, 114, 182,",
      microsand: "rgba(251, 191, 36,",
      finger: "rgba(253, 186, 116,",
      bookpage: "rgba(254, 240, 138,",
      silk_ribbon: "rgba(196, 181, 253,",
      bamboo_mat: "rgba(110, 231, 183,",
      leather_pad: "rgba(217, 119, 6,"
    };
    const lightColors = {
      brush: "rgba(225, 112, 85,",
      velvet: "rgba(190, 24, 93,",
      microsand: "rgba(180, 83, 9,",
      finger: "rgba(194, 65, 12,",
      bookpage: "rgba(161, 98, 7,",
      silk_ribbon: "rgba(109, 40, 217,",
      bamboo_mat: "rgba(5, 150, 105,",
      leather_pad: "rgba(146, 64, 14,"
    };
    const matColors = isDark ? darkColors : lightColors;
    const color = matColors[matKey] || (isDark ? "rgba(251, 191, 160," : "rgba(225, 112, 85,");

    if (fricStrokes.length < 18) {
      const arcLift = styleKey === "circle"
        ? ((panStart < panEnd ? -1 : 1) * (34 + Math.random() * 24))
        : (yOffset + (Math.random() * 28 - 14));
      fricStrokes.push({
        x1,
        y1: yCenter + yOffset,
        x2,
        y2: yCenter + yOffset + (Math.random() * 26 - 13),
        cx: xMid,
        cy: yCenter + arcLift,
        progress: 0,
        speed: 1 / Math.max(10, duration * 60),
        alpha: Math.min(0.95, 0.52 + normVel * 0.42),
        lineWidth: 1.8 + normVel * 2.4,
        color
      });
    }

    if (panStart < -0.18 || panEnd < -0.18 || midPan < -0.22) {
      earWavesL.push({ r: 6, maxR: 32 + normVel * 24, alpha: Math.min(0.9, 0.55 + normVel * 0.3) });
    }
    if (panStart > 0.18 || panEnd > 0.18 || midPan > 0.22) {
      earWavesR.push({ r: 6, maxR: 32 + normVel * 24, alpha: Math.min(0.9, 0.55 + normVel * 0.3) });
    }

    if (fricParticles.length < 72) {
      const pCount = Math.max(4, Math.min(11, Math.round(5 + normVel * 5)));
      for (let i = 0; i < pCount; i++) {
        fricParticles.push({
          x: x1 + (Math.random() * 36 - 18),
          y: yCenter + yOffset + (Math.random() * 34 - 17),
          vx: (panEnd - panStart) * (0.45 + Math.random() * 0.95) + (Math.random() * 0.4 - 0.2),
          vy: Math.random() * 1.2 - 0.6,
          alpha: (0.55 + Math.random() * 0.35) * normVel,
          decay: 0.935 + Math.random() * 0.038,
          size: (0.8 + Math.random() * 1.8) * (0.8 + normVel * 0.35),
          color
        });
      }
    }
  }

  function createWaterVisualEvent(azimuth, vel, baseFreq, isClack = false, visualKind = "bubble") {
    if (document.hidden || reducedMotion.matches) return;
    const labelMap = {
      clack: "Shishi-odoshi",
      ripple: "Water Ripple · " + Math.round(baseFreq || 480) + "Hz",
      bubble: "Bubble · " + Math.round(baseFreq || 520) + "Hz"
    };
    const resolvedKind = isClack ? "clack" : visualKind;
    registerAcousticEvent(azimuth, vel, "water", labelMap[resolvedKind] || "Water Flow");

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.78) + (logicalWidth * 0.11);
    const isLeft = azimuth < 0;
    const colorPrefix = isLeft
      ? (isDark ? "rgba(45, 212, 191," : "rgba(13, 148, 136,")
      : (isDark ? "rgba(56, 189, 248," : "rgba(2, 132, 199,");

    const centerY = logicalHeight / 2 + 15;

    if (isClack) {
      // 添水竹筒叩石专属沉稳大涟漪
      if (waterRipples.length < 45) {
        waterRipples.push({
          x: posX,
          y: centerY,
          rx: 4,
          ry: 1.5,
          maxR: 52 + vel * 32,
          alpha: 0.9,
          color: isDark ? "rgba(94, 234, 212," : "rgba(15, 118, 110,"
        });
      }
    } else if (visualKind === "ripple") {
      // 水舌滑移、卵石分流、方冰晃动或水珠轻滴：生成水平扩散水纹涟漪（不产生多余上升气泡）
      if (waterRipples.length < 45) {
        waterRipples.push({
          x: posX + (Math.random() * 20 - 10),
          y: centerY + (Math.random() * 26 - 13),
          rx: 2.5,
          ry: 0.9,
          maxR: 20 + vel * 24,
          alpha: 0.72,
          color: colorPrefix
        });
      }
    } else {
      // 真实 Minnaert 气泡事件：根据频率反比映射物理气泡半径（低频大泡慢升、高频微泡细小轻盈）
      if (waterBubbles.length < 40) {
        const freqClamped = Math.max(160, Math.min(1150, baseFreq || 520));
        const invSize = 1 - (freqClamped - 160) / 990; // 1 = 低频大泡, 0 = 高频微泡
        const bubbleR = 2.2 + invSize * 5.2 + vel * 2.2;
        waterBubbles.push({
          x: posX + (Math.random() * 24 - 12),
          y: centerY + 25 + (Math.random() * 35),
          targetY: centerY - 25 - (Math.random() * 20),
          r: bubbleR,
          vy: 0.75 + (1 - invSize) * 0.65 + Math.random() * 0.55,
          wobblePhase: Math.random() * Math.PI * 2,
          alpha: 0.85,
          color: colorPrefix
        });
      }
    }

    if (isLeft) {
      earWavesL.push({ r: 6, maxR: 44 + vel * 28, alpha: 0.75 });
    } else {
      earWavesR.push({ r: 6, maxR: 44 + vel * 28, alpha: 0.75 });
    }
  }

  function createBowlVisualEvent(azimuth, vel, baseFreq) {
    if (document.hidden || reducedMotion.matches) return;
    registerAcousticEvent(azimuth, vel, "bowls", "Bowl · " + Math.round(baseFreq) + "Hz");

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.74) + (logicalWidth * 0.13);
    const centerY = logicalHeight / 2 - 12;
    const isLeft = azimuth < 0;

    let ringColor = "";
    if (baseFreq < 300) {
      ringColor = isDark ? "rgba(245, 158, 11," : "rgba(217, 119, 6,"; // 颂钵黄金辉光
    } else if (baseFreq < 600) {
      ringColor = isDark ? "rgba(168, 85, 247," : "rgba(124, 58, 237,"; // 432Hz/528Hz 灵性紫晶光
    } else {
      ringColor = isDark ? "rgba(56, 189, 248," : "rgba(2, 132, 199,"; // 清越风铃天青色
    }

    if (bowlRings.length < 25) {
      bowlRings.push({
        x: posX,
        y: centerY + (Math.random() * 20 - 10),
        r: 6,
        maxR: 125 + vel * 85,
        expandSpeed: 0.9 + vel * 0.65,
        alpha: 0.88,
        width: 1.8,
        color: ringColor
      });
    }

    // 激发微光星尘微粒
    if (chimeSparkles.length < 45) {
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.4 + Math.random() * 0.9;
        chimeSparkles.push({
          x: posX + (Math.random() * 16 - 8),
          y: centerY + (Math.random() * 16 - 8),
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 0.25,
          size: 1.2 + Math.random() * 2.0,
          phase: Math.random() * Math.PI,
          alpha: 0.85,
          decay: 0.965 + Math.random() * 0.02,
          color: ringColor
        });
      }
    }

    if (isLeft) {
      earWavesL.push({ r: 8, maxR: 48 + vel * 35, alpha: 0.8 });
    } else {
      earWavesR.push({ r: 8, maxR: 48 + vel * 35, alpha: 0.8 });
    }
  }

  function createToolVisualEvent(type, azimuth, vel) {
    if (document.hidden || reducedMotion.matches) return;
    registerAcousticEvent(azimuth, vel, "tools", "Tool · " + type);

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.74) + (logicalWidth * 0.13);
    const centerY = logicalHeight / 2 - 12;
    const isLeft = azimuth < 0;

    let baseColor = isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, "; // 银青/天蓝沙龙色
    if (type === "pencil" || type === "fountain_pen") {
      baseColor = isDark ? "rgba(203, 213, 225, " : "rgba(71, 85, 105, "; // 石墨/钢笔墨灰
    } else if (type === "typewriter" || type === "music_box") {
      baseColor = isDark ? "rgba(251, 191, 36, " : "rgba(217, 119, 6, "; // 复古黄铜琥珀
    } else if (type === "comb" || type === "sandalwood_fan") {
      baseColor = isDark ? "rgba(244, 114, 182, " : "rgba(219, 39, 119, "; // 柔和檀木玫瑰粉
    } else if (type === "spray") {
      baseColor = isDark ? "rgba(45, 212, 191, " : "rgba(15, 118, 110, "; // 清爽水雾青
    }

    if (type === "scissors") {
      // 剪刀开合剪切线
      if (toolVisualEvents.length < 35) {
        toolVisualEvents.push({
          type: "scissors",
          x: posX,
          y: centerY + (Math.random() * 24 - 12),
          angle: (Math.random() - 0.5) * 0.6,
          len: 26 + vel * 18,
          progress: 0,
          alpha: 0.95,
          color: baseColor
        });
      }
    } else if (type === "comb" || type === "sandalwood_fan") {
      // 梳齿/扇骨细条波纹
      if (toolVisualEvents.length < 35) {
        toolVisualEvents.push({
          type: "comb",
          x: posX,
          y: centerY - 15,
          teeth: type === "sandalwood_fan" ? 7 : 5,
          spacing: type === "sandalwood_fan" ? 6 : 7,
          progress: 0,
          alpha: 0.9,
          color: baseColor
        });
      }
    } else if (type === "pencil" || type === "fountain_pen") {
      // 铅笔/钢笔素描微弧
      if (toolVisualEvents.length < 35) {
        toolVisualEvents.push({
          type: "pencil",
          x: posX,
          y: centerY + (Math.random() * 30 - 15),
          len: 30 + vel * 20,
          angle: (Math.random() - 0.5) * 1.2,
          alpha: 0.88,
          color: baseColor
        });
      }
    } else if (type === "typewriter" || type === "music_box") {
      // 打字机/八音盒谐波光环
      if (toolVisualEvents.length < 35) {
        toolVisualEvents.push({
          type: "typewriter",
          x: posX,
          y: centerY + (type === "music_box" ? (Math.random() * 24 - 12) : 0),
          r: 5,
          maxR: (type === "music_box" ? 45 : 35) + vel * 25,
          alpha: 0.95,
          color: baseColor
        });
      }
    } else if (type === "spray") {
      // 雾化水滴群 (10~15 颗水雾)
      for (let i = 0; i < 12; i++) {
        const spreadAngle = (Math.random() - 0.5) * 0.9;
        const dir = isLeft ? 1 : -1;
        const spd = 1.2 + Math.random() * 2.4;
        toolVisualEvents.push({
          type: "spray_drop",
          x: posX,
          y: centerY + (Math.random() * 16 - 8),
          vx: Math.cos(spreadAngle) * spd * dir,
          vy: Math.sin(spreadAngle) * spd,
          r: 0.8 + Math.random() * 1.4,
          alpha: 0.85,
          decay: 0.95,
          color: baseColor
        });
      }
    }

    if (isLeft) {
      earWavesL.push({ r: 6, maxR: 42 + vel * 28, alpha: 0.85 });
    } else {
      earWavesR.push({ r: 6, maxR: 42 + vel * 28, alpha: 0.85 });
    }
  }

  function createFireVisualEvent(type, azimuth, vel, visualKind = "spark") {
    if (document.hidden || reducedMotion.matches) return;
    const labelSuffix = visualKind === "glow" ? "Warm Draft" : "Micro-Fracture";
    registerAcousticEvent(azimuth, vel, "fire", "Fire · " + type + " (" + labelSuffix + ")");

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.74) + (logicalWidth * 0.13);
    const centerY = logicalHeight / 2 - 12;
    const isLeft = azimuth < 0;

    let emberColor = isDark ? "rgba(249, 115, 22, " : "rgba(194, 65, 12, "; // 暖炉炭橙
    if (type === "leaves" || type === "dry_twigs") {
      emberColor = isDark ? "rgba(217, 119, 6, " : "rgba(180, 83, 9, "; // 枫叶/枯枝琥珀金
    } else if (type === "embers" || type === "roast_chestnut") {
      emberColor = isDark ? "rgba(239, 68, 68, " : "rgba(185, 28, 28, "; // 营火/糖炒板栗赤红
    } else if (type === "pinecone") {
      emberColor = isDark ? "rgba(245, 158, 11, " : "rgba(161, 98, 7, "; // 松果木金
    } else if (type === "charcoal") {
      emberColor = isDark ? "rgba(251, 146, 60, " : "rgba(234, 88, 12, "; // 备长炭微光
    } else if (type === "sauna_steam") {
      emberColor = isDark ? "rgba(148, 163, 184, " : "rgba(100, 116, 139, "; // 桑拿热石白雾
    }

    // 区分舒缓热浪微尘 (glow: 1~2 颗慢速升腾暖光微粒) 与偶发微爆火星 (spark: 2~4 颗轻柔星尘)
    if (fireEmbers.length < 55) {
      const isGlow = visualKind === "glow" || type === "sauna_steam";
      const sparkCount = isGlow ? 2 : 3;
      for (let i = 0; i < sparkCount; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (isGlow ? 0.85 : 1.25);
        const spd = isGlow ? (0.35 + Math.random() * 0.65) : (0.65 + Math.random() * 1.45);
        fireEmbers.push({
          x: posX + (Math.random() * 24 - 12),
          y: centerY + (Math.random() * 16 - 8),
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - (isGlow ? 0.32 : 0.52),
          size: (isGlow ? 2.0 : 1.1) + Math.random() * (isGlow ? 2.4 : 1.8) * vel,
          wobblePhase: Math.random() * Math.PI * 2,
          alpha: isGlow ? 0.68 : 0.88,
          decay: isGlow ? (0.968 + Math.random() * 0.016) : (0.955 + Math.random() * 0.022),
          color: emberColor
        });
      }
    }

    if (isLeft) {
      earWavesL.push({ r: 6, maxR: 40 + vel * 26, alpha: visualKind === "glow" ? 0.65 : 0.82 });
    } else {
      earWavesR.push({ r: 6, maxR: 40 + vel * 26, alpha: visualKind === "glow" ? 0.65 : 0.82 });
    }
  }

  function createSquishVisualEvent(type, azimuth, vel) {
    if (document.hidden || reducedMotion.matches) return;
    registerAcousticEvent(azimuth, vel, "squish", "Squish · " + type);

    const isDark = isDarkThemeActive();
    const posX = ((azimuth + 1) / 2) * (logicalWidth * 0.74) + (logicalWidth * 0.13);
    const centerY = logicalHeight / 2 - 12;
    const isLeft = azimuth < 0;

    // 粘弹性形变物理脉冲 (Squash & Stretch)
    squishCompression = Math.min(1.0, squishCompression + 0.65 * vel);

    let gelColor = isDark ? "rgba(52, 211, 153, " : "rgba(5, 150, 105, "; // 记忆海绵/翡翠薄荷绿
    if (type === "warm_beeswax" || type === "sourdough_knead") {
      gelColor = isDark ? "rgba(245, 158, 11, " : "rgba(217, 119, 6, "; // 蜂蜡/面团金琥珀
    } else if (type === "soft_slime" || type === "silicone_pop") {
      gelColor = isDark ? "rgba(167, 139, 250, " : "rgba(124, 58, 237, "; // 水晶泥/硅胶丁香紫
    } else if (type === "linen_parchment") {
      gelColor = isDark ? "rgba(251, 191, 36, " : "rgba(180, 83, 9, "; // 亚麻暖沙金
    } else if (type === "kinetic_sand") {
      gelColor = isDark ? "rgba(251, 146, 60, " : "rgba(194, 65, 12, "; // 流沙珊瑚橙
    } else if (type === "bubble_wrap") {
      gelColor = isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, "; // 气泡膜冰晶蓝
    }

    // 产生形变微泡与粘滞凝胶水珠 (Viscous Micro-Blobs & Beads)
    if (squishBlobs.length < 60) {
      const beadCount = (type === "soft_slime" || type === "bubble_wrap") ? 8 : (type === "memory_foam" ? 6 : 5);
      for (let i = 0; i < beadCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 1.0 + Math.random() * 2.2 * vel;
        squishBlobs.push({
          x: posX + (Math.random() * 24 - 12),
          y: centerY + (Math.random() * 24 - 12),
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          r: 2.6 + Math.random() * 3.8 * vel,
          alpha: 0.95,
          decay: 0.95 + Math.random() * 0.02,
          color: gelColor
        });
      }
    }

    // 产生柔润粘弹性形变扩散环 (Viscoelastic Soft Rebound Rings)
    if (squishRipples.length < 15) {
      squishRipples.push({
        x: posX,
        y: centerY,
        rx: 16,
        ry: 10,
        maxR: 90 + vel * 50,
        alpha: 0.85,
        expandSpeed: 2.0 + vel * 1.5,
        color: gelColor
      });
    }

    if (isLeft) {
      earWavesL.push({ r: 6, maxR: 44 + vel * 30, alpha: 0.85 });
    } else {
      earWavesR.push({ r: 6, maxR: 44 + vel * 30, alpha: 0.85 });
    }
  }

  // ==========================================================================
  // 模式 1: 3Dio 双耳空间全景声学雷达监视器 (3Dio Acoustic Radar & Vectorscope)
  // ==========================================================================
  function draw3DioRadarScope(context, isDark) {
    const centerX = logicalWidth / 2;
    const centerY = logicalHeight / 2 - 10;
    const maxR = Math.min(160, logicalHeight * 0.40, logicalWidth * 0.30);

    // 0. 电平表阻尼回落与峰值衰减
    meterLevelL *= 0.91;
    meterLevelR *= 0.91;
    if (meterPeakHoldTimerL > 0) {
      meterPeakHoldTimerL--;
    } else {
      meterPeakL = Math.max(0, meterPeakL - 0.015);
    }
    if (meterPeakHoldTimerR > 0) {
      meterPeakHoldTimerR--;
    } else {
      meterPeakR = Math.max(0, meterPeakR - 0.015);
    }

    // 1. 雷达极坐标背景网格与同心圈
    context.save();
    const ringRadii = [maxR * 0.32, maxR * 0.58, maxR * 0.82, maxR];
    const ringLabels = ["-18 dB", "-12 dB", "-6 dB", "0 dB PEAK"];

    for (let i = 0; i < ringRadii.length; i++) {
      const r = ringRadii[i];
      context.beginPath();
      context.arc(centerX, centerY, r, 0, Math.PI * 2);
      context.strokeStyle = isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(13, 148, 136, 0.22)";
      context.lineWidth = i === ringRadii.length - 1 ? 1.4 : 1;
      if (i < ringRadii.length - 1) {
        context.setLineDash([3, 5]);
      } else {
        context.setLineDash([]);
      }
      context.stroke();

      // 同心圆分贝标签
      context.font = "9px monospace";
      context.fillStyle = isDark ? "rgba(45, 212, 191, 0.5)" : "rgba(13, 148, 136, 0.6)";
      context.fillText(ringLabels[i], centerX + 6, centerY - r + 11);
    }
    context.setLineDash([]);

    // 2. 方位角经线与刻度短线
    const angles = [
      { a: -Math.PI / 2, label: "0° FRONT" },
      { a: -Math.PI * 0.75, label: "-45° L" },
      { a: -Math.PI, label: "-90° L-EAR" },
      { a: -Math.PI * 0.25, label: "+45° R" },
      { a: 0, label: "+90° R-EAR" },
      { a: Math.PI / 2, label: "180° REAR" }
    ];

    for (const ang of angles) {
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(centerX + Math.cos(ang.a) * maxR, centerY + Math.sin(ang.a) * maxR);
      context.strokeStyle = isDark ? "rgba(45, 212, 191, 0.12)" : "rgba(13, 148, 136, 0.16)";
      context.lineWidth = 1;
      context.setLineDash([2, 6]);
      context.stroke();

      // 文本方位角标签
      const tx = centerX + Math.cos(ang.a) * (maxR + 16);
      const ty = centerY + Math.sin(ang.a) * (maxR + 16);
      context.font = "9px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = isDark ? "rgba(148, 163, 184, 0.65)" : "rgba(71, 85, 105, 0.75)";
      context.fillText(ang.label, tx, ty);
    }
    context.setLineDash([]);

    // 外圈细微刻度 (Ticks every 10 deg)
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 30 === 0;
      const len = isMajor ? 6 : 3;
      context.beginPath();
      context.moveTo(centerX + Math.cos(rad) * maxR, centerY + Math.sin(rad) * maxR);
      context.lineTo(centerX + Math.cos(rad) * (maxR + len), centerY + Math.sin(rad) * (maxR + len));
      context.strokeStyle = isDark ? "rgba(45, 212, 191, 0.25)" : "rgba(13, 148, 136, 0.30)";
      context.lineWidth = isMajor ? 1.2 : 0.8;
      context.stroke();
    }

    // 3. 雷达 360° 旋转相控阵扫描光束 (Radar Beam Sweep with Phosphor Afterglow)
    radarSweepAngle = (radarSweepAngle + 0.024) % (Math.PI * 2);
    const sweepWedge = Math.PI * 0.25; // 45 度扫描扇区
    const wedgeSegments = 14;
    for (let i = 0; i < wedgeSegments; i++) {
      const aStart = radarSweepAngle - (sweepWedge * (i + 1)) / wedgeSegments;
      const aEnd = radarSweepAngle - (sweepWedge * i) / wedgeSegments;
      const alpha = (1 - i / wedgeSegments) * (isDark ? 0.16 : 0.14);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.arc(centerX, centerY, maxR, aStart, aEnd);
      context.closePath();
      context.fillStyle = isDark
        ? "rgba(45, 212, 191, " + alpha + ")"
        : "rgba(13, 148, 136, " + alpha + ")";
      context.fill();
    }
    // 扫描线前锋
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + Math.cos(radarSweepAngle) * maxR, centerY + Math.sin(radarSweepAngle) * maxR);
    context.strokeStyle = isDark ? "rgba(94, 234, 212, 0.85)" : "rgba(15, 118, 110, 0.92)";
    context.lineWidth = 1.6;
    context.stroke();

    // 4. 绘制实时声源信标 (Acoustic Beacons & Wavefronts)
    for (let i = radarBeacons.length - 1; i >= 0; i--) {
      const b = radarBeacons[i];
      const bx = centerX + Math.cos(b.angle) * b.dist;
      const by = centerY + Math.sin(b.angle) * b.dist;

      // 扩散波环向假人头传递
      b.waveR += 1.8;
      context.beginPath();
      context.arc(bx, by, b.waveR, 0, Math.PI * 2);
      context.strokeStyle = b.color + (b.alpha * 0.5 * Math.max(0, 1 - b.waveR / b.maxWaveR)).toFixed(3) + ")";
      context.lineWidth = 1.2;
      context.stroke();

      // 声波到 3Dio 机身对应耳部的连接射线 (ITD Arrival Path)
      const targetEarX = b.azimuth < 0 ? centerX - 46 : centerX + 46;
      context.beginPath();
      context.moveTo(bx, by);
      context.lineTo(targetEarX, centerY);
      context.strokeStyle = b.color + (b.alpha * 0.22).toFixed(3) + ")";
      context.lineWidth = 1;
      context.setLineDash([2, 4]);
      context.stroke();
      context.setLineDash([]);

      // 十字准星瞄准标记
      const crossSize = 5;
      context.beginPath();
      context.moveTo(bx - crossSize, by);
      context.lineTo(bx + crossSize, by);
      context.moveTo(bx, by - crossSize);
      context.lineTo(bx, by + crossSize);
      context.strokeStyle = b.color + b.alpha.toFixed(3) + ")";
      context.lineWidth = 1.5;
      context.stroke();

      // 声源核心亮斑
      context.beginPath();
      context.arc(bx, by, 3, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();

      // 信标小文本
      context.font = "9px monospace";
      context.textAlign = bx > centerX ? "left" : "right";
      context.fillStyle = b.color + (b.alpha * 0.9).toFixed(3) + ")";
      const offsetSign = bx > centerX ? 8 : -8;
      context.fillText(b.label, bx + offsetSign, by - 4);

      b.alpha *= 0.955;
      if (b.alpha < 0.02 || b.waveR > b.maxWaveR) {
        radarBeacons.splice(i, 1);
      }
    }

    // 5. 居中绘制 3Dio Free Space 仿真假人头硬件模型
    // 5.1 铝合金机身中控箱 (Free Space Chassis)
    const boxW = 66;
    const boxH = 40;
    const boxX = centerX - boxW / 2;
    const boxY = centerY - boxH / 2;
    const boxRadius = 6;

    const metalGrad = context.createLinearGradient(boxX, boxY, boxX, boxY + boxH);
    if (isDark) {
      metalGrad.addColorStop(0, "#2c3b42");
      metalGrad.addColorStop(0.2, "#1e292e");
      metalGrad.addColorStop(0.8, "#141c20");
      metalGrad.addColorStop(1, "#0d1316");
    } else {
      metalGrad.addColorStop(0, "#f8fafc");
      metalGrad.addColorStop(0.2, "#e2e8f0");
      metalGrad.addColorStop(0.8, "#cbd5e1");
      metalGrad.addColorStop(1, "#94a3b8");
    }

    context.beginPath();
    context.roundRect(boxX, boxY, boxW, boxH, boxRadius);
    context.fillStyle = metalGrad;
    context.fill();
    context.strokeStyle = isDark ? "rgba(94, 234, 212, 0.45)" : "rgba(15, 118, 110, 0.55)";
    context.lineWidth = 1.4;
    context.stroke();

    // 3Dio 铭牌印字
    context.font = "bold 11px sans-serif";
    context.textAlign = "center";
    context.fillStyle = isDark ? "#f1f5f9" : "#0f172a";
    context.fillText("3Dio", centerX, centerY - 2);

    context.font = "7px monospace";
    context.fillStyle = isDark ? "rgba(94, 234, 212, 0.85)" : "rgba(15, 118, 110, 0.9)";
    context.fillText("FREE SPACE", centerX, centerY + 8);

    // 电源与工作状态指示灯 (LED)
    const ledY = centerY + 14;
    context.beginPath();
    context.arc(centerX, ledY, 2.5, 0, Math.PI * 2);
    context.fillStyle = "#34d399";
    context.fill();
    const ledPulse = Math.sin(Date.now() / 350) * 0.3 + 0.7;
    context.beginPath();
    context.arc(centerX, ledY, 5 * ledPulse, 0, Math.PI * 2);
    context.fillStyle = "rgba(52, 211, 153, " + (0.4 * ledPulse) + ")";
    context.fill();

    // 5.2 绘制高保真仿真硅胶人耳 (Left & Right Silicone Pinnae)
    function drawPinna(earX, earY, isLeft) {
      context.save();
      context.translate(earX, earY);
      if (!isLeft) context.scale(-1, 1);

      context.beginPath();
      context.moveTo(-2, -18);
      context.bezierCurveTo(-14, -18, -17, -8, -16, 2);
      context.bezierCurveTo(-15, 10, -11, 17, -4, 18);
      context.bezierCurveTo(0, 18, 2, 14, 0, 8);
      context.bezierCurveTo(-1, 2, 2, -4, 2, -10);
      context.bezierCurveTo(2, -16, 1, -18, -2, -18);
      context.closePath();

      const pinnaGrad = context.createLinearGradient(-15, -18, 0, 18);
      if (isDark) {
        pinnaGrad.addColorStop(0, "rgba(45, 212, 191, 0.45)");
        pinnaGrad.addColorStop(0.5, "rgba(22, 78, 99, 0.85)");
        pinnaGrad.addColorStop(1, "rgba(15, 23, 42, 0.95)");
      } else {
        pinnaGrad.addColorStop(0, "rgba(204, 251, 241, 0.95)");
        pinnaGrad.addColorStop(0.5, "rgba(153, 246, 228, 0.85)");
        pinnaGrad.addColorStop(1, "rgba(94, 234, 212, 0.75)");
      }
      context.fillStyle = pinnaGrad;
      context.fill();
      context.strokeStyle = isDark ? "rgba(94, 234, 212, 0.65)" : "rgba(15, 118, 110, 0.75)";
      context.lineWidth = 1.2;
      context.stroke();

      // 内对耳轮立体凹陷 (Antihelix & Concha)
      context.beginPath();
      context.moveTo(-6, -11);
      context.bezierCurveTo(-10, -5, -9, 3, -4, 7);
      context.strokeStyle = isDark ? "rgba(6, 182, 212, 0.5)" : "rgba(14, 116, 144, 0.6)";
      context.lineWidth = 1.4;
      context.stroke();

      // 耳道开口 (Ear Canal Hole)
      context.beginPath();
      context.ellipse(-3, 1, 2.5, 4, -0.2, 0, Math.PI * 2);
      context.fillStyle = isDark ? "#020617" : "#0f766e";
      context.fill();

      context.restore();
    }

    drawPinna(centerX - 46, centerY, true);
    drawPinna(centerX + 46, centerY, false);

    // 左右耳标注标签 [ L ] / [ R ]
    context.font = "bold 9px monospace";
    context.textAlign = "center";
    context.fillStyle = isDark ? "#2dd4bf" : "#0f766e";
    context.fillText("L", centerX - 46, centerY - 24);
    context.fillStyle = isDark ? "#38bdf8" : "#0284c7";
    context.fillText("R", centerX + 46, centerY - 24);

    // 5.3 绘制双耳 HRTF 空间衍射光环 (Ear Diffraction Wavefronts)
    for (let i = earDiffractionL.length - 1; i >= 0; i--) {
      const ed = earDiffractionL[i];
      ed.r += ed.speed;
      ed.alpha *= 0.93;
      context.beginPath();
      context.arc(centerX - 46, centerY, ed.r, Math.PI * 0.45, Math.PI * 1.55);
      context.strokeStyle = (isDark ? "rgba(45, 212, 191, " : "rgba(13, 148, 136, ") + ed.alpha.toFixed(3) + ")";
      context.lineWidth = 1.6;
      context.stroke();
      if (ed.alpha < 0.02 || ed.r > ed.maxR) earDiffractionL.splice(i, 1);
    }

    for (let i = earDiffractionR.length - 1; i >= 0; i--) {
      const ed = earDiffractionR[i];
      ed.r += ed.speed;
      ed.alpha *= 0.93;
      context.beginPath();
      context.arc(centerX + 46, centerY, ed.r, -Math.PI * 0.55, Math.PI * 0.55);
      context.strokeStyle = (isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, ") + ed.alpha.toFixed(3) + ")";
      context.lineWidth = 1.6;
      context.stroke();
      if (ed.alpha < 0.02 || ed.r > ed.maxR) earDiffractionR.splice(i, 1);
    }

    // 6. 左右两侧声学 VU 实时电平表 (Binaural Peak Meters)
    function drawVUMeter(x, y, h, level, peak, isLeftChannel) {
      const segments = 14;
      const segW = 10;
      const segH = (h - (segments - 1) * 2) / segments;
      const litCount = Math.round(level * segments);

      context.save();
      // 外框底槽
      context.beginPath();
      context.roundRect(x - 2, y - 2, segW + 4, h + 4, 3);
      context.fillStyle = isDark ? "rgba(15, 23, 42, 0.65)" : "rgba(241, 245, 249, 0.85)";
      context.fill();
      context.strokeStyle = isDark ? "rgba(51, 65, 85, 0.5)" : "rgba(203, 213, 225, 0.8)";
      context.lineWidth = 1;
      context.stroke();

      for (let s = 0; s < segments; s++) {
        const segY = y + h - (s + 1) * (segH + 2);
        const isLit = s < litCount;
        let segColor = "";

        if (s < 9) {
          segColor = isLit ? "#10b981" : (isDark ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.2)");
        } else if (s < 12) {
          segColor = isLit ? "#f59e0b" : (isDark ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.2)");
        } else {
          segColor = isLit ? "#ef4444" : (isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.2)");
        }

        context.fillStyle = segColor;
        context.fillRect(x, segY, segW, segH);
      }

      // 峰值悬停横线 (Peak Hold Line)
      if (peak > 0.05) {
        const peakSeg = Math.min(segments - 1, Math.floor(peak * segments));
        const peakY = y + h - (peakSeg + 1) * (segH + 2);
        context.fillStyle = "#ef4444";
        context.fillRect(x - 1, peakY - 1, segW + 2, 2.5);
      }

      context.font = "bold 9px monospace";
      context.textAlign = "center";
      context.fillStyle = isDark ? (isLeftChannel ? "#2dd4bf" : "#38bdf8") : (isLeftChannel ? "#0f766e" : "#0284c7");
      context.fillText(isLeftChannel ? "CH-L" : "CH-R", x + segW / 2, y - 8);

      const dbVal = level > 0.01 ? (20 * Math.log10(level)).toFixed(0) + "dB" : "-inf";
      context.font = "8px monospace";
      context.fillStyle = isDark ? "rgba(148, 163, 184, 0.65)" : "rgba(71, 85, 105, 0.75)";
      context.fillText(dbVal, x + segW / 2, y + h + 12);

      context.restore();
    }

    const meterH = 125;
    const meterY = centerY - meterH / 2;
    drawVUMeter(26, meterY, meterH, meterLevelL, meterPeakL, true);
    drawVUMeter(logicalWidth - 36, meterY, meterH, meterLevelR, meterPeakR, false);

    // 7. 中央假人头正下方：双耳李萨如矢量示波器 (Binaural Lissajous Goniometer)
    context.save();
    const gonioW = 100;
    const gonioH = 26;
    const gonioX = centerX - gonioW / 2;
    const gonioY = centerY + maxR * 0.68;

    context.beginPath();
    context.roundRect(gonioX, gonioY, gonioW, gonioH, 4);
    context.fillStyle = isDark ? "rgba(15, 23, 42, 0.55)" : "rgba(241, 245, 249, 0.65)";
    context.fill();
    context.strokeStyle = isDark ? "rgba(45, 212, 191, 0.25)" : "rgba(13, 148, 136, 0.35)";
    context.lineWidth = 1;
    context.stroke();

    context.beginPath();
    context.moveTo(centerX - 15, gonioY + gonioH / 2);
    context.lineTo(centerX + 15, gonioY + gonioH / 2);
    context.moveTo(centerX, gonioY + 4);
    context.lineTo(centerX, gonioY + gonioH - 4);
    context.strokeStyle = isDark ? "rgba(148, 163, 184, 0.2)" : "rgba(71, 85, 105, 0.25)";
    context.lineWidth = 0.8;
    context.stroke();

    context.beginPath();
    goniometerAngle += 0.08;
    const radX = Math.max(3, (meterLevelL + 0.05) * 35);
    const radY = Math.max(2, (meterLevelR + 0.05) * 9);
    const rot = (meterLevelR - meterLevelL) * 0.8;
    context.ellipse(centerX, gonioY + gonioH / 2, radX, radY, rot, 0, Math.PI * 2);
    context.strokeStyle = isDark ? "rgba(94, 234, 212, 0.75)" : "rgba(15, 118, 110, 0.85)";
    context.lineWidth = 1.2;
    context.stroke();

    context.font = "8px monospace";
    context.textAlign = "center";
    context.fillStyle = isDark ? "rgba(148, 163, 184, 0.55)" : "rgba(71, 85, 105, 0.65)";
    context.fillText("STEREO GONIOMETER", centerX, gonioY + gonioH + 9);

    context.restore();

    // 8. 四角微科技 HUD 声学参数标注 (Acoustic Telemetry Overlay)
    context.font = "9px monospace";
    context.fillStyle = isDark ? "rgba(148, 163, 184, 0.5)" : "rgba(71, 85, 105, 0.65)";
    context.textAlign = "left";
    context.fillText(logicalWidth < 600 ? "3Dio RADAR" : "● 3Dio ACOUSTIC RADAR // 360° SPATIAL TRACKER", 54, 24);
    if (logicalWidth >= 600) context.fillText("SAMPLING: 48kHz 32-BIT // ITD ACTIVE", 54, 38);

    context.textAlign = "right";
    const widthPct = state.stereoWidth || 100;
    context.fillText(logicalWidth < 600 ? widthPct + "% HRTF" : "STEREO WIDTH: " + widthPct + "% // HRTF ENGAGED", logicalWidth - 54, 24);
    if (logicalWidth >= 600) context.fillText("ACTIVE SOURCES: " + radarBeacons.length + " BEACONS", logicalWidth - 54, 38);

    context.restore();
  }

  // ==========================================================================
  // 模式 2: 极简休眠暗光模式 (Minimal Sleep & Calming Ambient Glow)
  // ==========================================================================
  function drawMinimalSleepView(context, isDark) {
    const centerX = logicalWidth / 2;
    const centerY = logicalHeight / 2 - 10;
    const breath = Math.sin(Date.now() / 2500) * 0.5 + 0.5; // 0 ~ 1, 周期 5s
    const maxR = 120 + breath * 25;

    context.save();
    const grad = context.createRadialGradient(centerX, centerY, 5, centerX, centerY, maxR);
    if (isDark) {
      grad.addColorStop(0, "rgba(45, 212, 191, " + (0.04 + breath * 0.05) + ")");
      grad.addColorStop(0.5, "rgba(15, 23, 42, " + (0.02 + breath * 0.02) + ")");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    } else {
      grad.addColorStop(0, "rgba(13, 148, 136, " + (0.05 + breath * 0.06) + ")");
      grad.addColorStop(0.5, "rgba(203, 213, 225, " + (0.03 + breath * 0.02) + ")");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    }
    context.fillStyle = grad;
    context.beginPath();
    context.arc(centerX, centerY, maxR, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(centerX, centerY, 18 + breath * 4, 0, Math.PI * 2);
    context.strokeStyle = isDark ? "rgba(94, 234, 212, " + (0.12 + breath * 0.15) + ")" : "rgba(15, 118, 110, " + (0.18 + breath * 0.18) + ")";
    context.lineWidth = 1;
    context.stroke();

    context.font = "10px sans-serif";
    context.textAlign = "center";
    context.fillStyle = isDark ? "rgba(148, 163, 184, 0.45)" : "rgba(71, 85, 105, 0.55)";
    context.fillText("🌙 极简休眠 · 静心助眠", centerX, centerY + 42);

    context.restore();
  }

  // ==========================================================================
  // 模式 3: 沉浸拟物粒子模式 (Scenic Physical Particle Soundstage)
  // ==========================================================================
  function drawScenicParticleView(context, isDark) {
    const isPlaying = state.isPlaying;

    if (state.activeCategory === "rain") {
      const rain = RAIN_PRESETS[state.currentRain];
      const activeCount = isPlaying
        ? Math.floor(rainParticles.length * (rain.dropRate / 100))
        : 25;

      const limit = Math.min(rainParticles.length, Math.max(18, activeCount));
      for (let i = 0; i < limit; i++) {
        const p = rainParticles[i];
        p.update(rain.windSpeed);
        p.draw(context);
      }
    } else if (state.activeCategory === "tapping") {
      context.save();
      const padY = logicalHeight - 50;
      context.beginPath();
      context.moveTo(logicalWidth * 0.08, padY);
      context.lineTo(logicalWidth * 0.92, padY);
      context.strokeStyle = isDark ? "rgba(45, 212, 191, 0.25)" : "rgba(15, 129, 141, 0.35)";
      context.lineWidth = 2;
      context.setLineDash([4, 6]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "friction") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 12;
      const bgGrad = context.createRadialGradient(centerX, centerY, 30, centerX, centerY, logicalWidth * 0.38);
      if (isDark) {
        bgGrad.addColorStop(0, "rgba(244, 114, 182, 0.08)");
        bgGrad.addColorStop(0.5, "rgba(45, 212, 191, 0.03)");
      } else {
        bgGrad.addColorStop(0, "rgba(219, 39, 119, 0.09)");
        bgGrad.addColorStop(0.5, "rgba(13, 148, 136, 0.04)");
      }
      bgGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = bgGrad;
      context.beginPath();
      context.ellipse(centerX, centerY, logicalWidth * 0.38, 95, 0, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.ellipse(centerX, centerY, logicalWidth * 0.34, 75, 0, 0, Math.PI * 2);
      context.strokeStyle = isDark ? "rgba(244, 114, 182, 0.16)" : "rgba(219, 39, 119, 0.25)";
      context.lineWidth = 1;
      context.setLineDash([3, 7]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "water") {
      context.save();
      waterWaveOffset += 0.024 * state.waterSpeedMultiplier;
      const centerY = logicalHeight / 2 + 10;

      const waveLayers = [
        { yOff: -28, amp: 13, freq: 0.007, speed: 1.0, alpha: isDark ? 0.22 : 0.28 },
        { yOff: 0, amp: 18, freq: 0.005, speed: 0.75, alpha: isDark ? 0.32 : 0.35 },
        { yOff: 28, amp: 15, freq: 0.008, speed: 1.15, alpha: isDark ? 0.25 : 0.28 }
      ];

      for (const layer of waveLayers) {
        context.beginPath();
        context.moveTo(0, logicalHeight);
        for (let x = 0; x <= logicalWidth; x += 15) {
          const waveY = centerY + layer.yOff + Math.sin(x * layer.freq + waterWaveOffset * layer.speed) * layer.amp;
          context.lineTo(x, waveY);
        }
        context.lineTo(logicalWidth, logicalHeight);
        context.closePath();

        const grad = context.createLinearGradient(0, centerY + layer.yOff - 20, 0, logicalHeight);
        if (isDark) {
          grad.addColorStop(0, "rgba(45, 212, 191, " + layer.alpha + ")");
          grad.addColorStop(0.5, "rgba(56, 189, 248, " + (layer.alpha * 0.6) + ")");
          grad.addColorStop(1, "rgba(10, 17, 20, 0.1)");
        } else {
          grad.addColorStop(0, "rgba(13, 148, 136, " + layer.alpha + ")");
          grad.addColorStop(0.5, "rgba(2, 132, 199, " + (layer.alpha * 0.7) + ")");
          grad.addColorStop(1, "rgba(237, 245, 246, 0.2)");
        }
        context.fillStyle = grad;
        context.fill();

        context.beginPath();
        for (let x = 0; x <= logicalWidth; x += 15) {
          const waveY = centerY + layer.yOff + Math.sin(x * layer.freq + waterWaveOffset * layer.speed) * layer.amp;
          if (x === 0) context.moveTo(x, waveY);
          else context.lineTo(x, waveY);
        }
        context.strokeStyle = isDark ? "rgba(94, 234, 212, " + (layer.alpha * 1.5) + ")" : "rgba(15, 118, 110, " + (layer.alpha * 1.6) + ")";
        context.lineWidth = 1.5;
        context.stroke();
      }
      context.restore();
    } else if (state.activeCategory === "bowls") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 12;
      bowlRimAngle += 0.012;

      const auraGrad = context.createRadialGradient(centerX, centerY, 15, centerX, centerY, logicalWidth * 0.36);
      if (isDark) {
        auraGrad.addColorStop(0, "rgba(245, 158, 11, 0.12)");
        auraGrad.addColorStop(0.45, "rgba(168, 85, 247, 0.06)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        auraGrad.addColorStop(0, "rgba(217, 119, 6, 0.12)");
        auraGrad.addColorStop(0.45, "rgba(124, 58, 237, 0.06)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
      context.fillStyle = auraGrad;
      context.beginPath();
      context.arc(centerX, centerY, logicalWidth * 0.36, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(centerX, centerY, 85 + Math.sin(Date.now() / 850) * 4, 0, Math.PI * 2);
      context.strokeStyle = isDark ? "rgba(245, 158, 11, 0.22)" : "rgba(217, 119, 6, 0.32)";
      context.lineWidth = 1;
      context.setLineDash([4, 8]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "tools") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 12;

      const auraGrad = context.createRadialGradient(centerX, centerY, 20, centerX, centerY, logicalWidth * 0.38);
      if (isDark) {
        auraGrad.addColorStop(0, "rgba(56, 189, 248, 0.10)");
        auraGrad.addColorStop(0.5, "rgba(148, 163, 184, 0.04)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        auraGrad.addColorStop(0, "rgba(2, 132, 199, 0.09)");
        auraGrad.addColorStop(0.5, "rgba(71, 85, 105, 0.03)");
        auraGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
      context.fillStyle = auraGrad;
      context.beginPath();
      context.arc(centerX, centerY, logicalWidth * 0.38, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.moveTo(centerX - 100, centerY);
      context.lineTo(centerX + 100, centerY);
      context.moveTo(centerX, centerY - 60);
      context.lineTo(centerX, centerY + 60);
      context.strokeStyle = isDark ? "rgba(56, 189, 248, 0.12)" : "rgba(2, 132, 199, 0.18)";
      context.lineWidth = 1;
      context.setLineDash([3, 6]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "fire") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 12;

      const fireGrad = context.createRadialGradient(centerX, centerY, 15, centerX, centerY, logicalWidth * 0.38);
      if (isDark) {
        fireGrad.addColorStop(0, "rgba(249, 115, 22, 0.16)");
        fireGrad.addColorStop(0.45, "rgba(239, 68, 68, 0.06)");
        fireGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      } else {
        fireGrad.addColorStop(0, "rgba(234, 88, 12, 0.14)");
        fireGrad.addColorStop(0.45, "rgba(185, 28, 28, 0.05)");
        fireGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
      context.fillStyle = fireGrad;
      context.beginPath();
      context.arc(centerX, centerY, logicalWidth * 0.38, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(centerX, centerY, 90 + Math.sin(Date.now() / 650) * 5, 0, Math.PI * 2);
      context.strokeStyle = isDark ? "rgba(249, 115, 22, 0.25)" : "rgba(194, 65, 12, 0.35)";
      context.lineWidth = 1;
      context.setLineDash([5, 8]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "squish") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 12;
      squishCompression *= 0.945;

      let coreColor1 = isDark ? "rgba(52, 211, 153, " : "rgba(5, 150, 105, ";
      let coreColor2 = isDark ? "rgba(167, 139, 250, " : "rgba(124, 58, 237, ";
      if (state.currentSquishMat === "warm_beeswax" || state.currentSquishMat === "sourdough_knead") {
        coreColor1 = isDark ? "rgba(245, 158, 11, " : "rgba(217, 119, 6, ";
        coreColor2 = isDark ? "rgba(251, 146, 60, " : "rgba(194, 65, 12, ";
      } else if (state.currentSquishMat === "soft_slime" || state.currentSquishMat === "silicone_pop") {
        coreColor1 = isDark ? "rgba(167, 139, 250, " : "rgba(124, 58, 237, ";
        coreColor2 = isDark ? "rgba(236, 72, 153, " : "rgba(219, 39, 119, ";
      } else if (state.currentSquishMat === "linen_parchment") {
        coreColor1 = isDark ? "rgba(251, 191, 36, " : "rgba(180, 83, 9, ";
        coreColor2 = isDark ? "rgba(217, 119, 6, " : "rgba(161, 98, 7, ";
      } else if (state.currentSquishMat === "kinetic_sand") {
        coreColor1 = isDark ? "rgba(251, 146, 60, " : "rgba(194, 65, 12, ";
        coreColor2 = isDark ? "rgba(245, 158, 11, " : "rgba(217, 119, 6, ";
      } else if (state.currentSquishMat === "bubble_wrap") {
        coreColor1 = isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, ";
        coreColor2 = isDark ? "rgba(45, 212, 191, " : "rgba(13, 148, 136, ";
      }

      const tSec = Date.now() / 1000;
      const breath = Math.sin(tSec * 0.92) * 3.0 + Math.sin(tSec * 0.57 * Math.SQRT2 + 1.2) * 2.2;
      const focusShiftX = (state.squishFocusAz || 0) * 38;
      const gelGrad = context.createRadialGradient(centerX + focusShiftX * 0.5, centerY, 15, centerX, centerY, logicalWidth * 0.36);
      gelGrad.addColorStop(0, coreColor1 + (isDark ? "0.16)" : "0.14)"));
      gelGrad.addColorStop(0.45, coreColor2 + (isDark ? "0.06)" : "0.05)"));
      gelGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

      context.fillStyle = gelGrad;
      context.beginPath();
      const radiusX = (logicalWidth * 0.34 + breath) * (1 + squishCompression * 0.22);
      const radiusY = Math.max(20, (78 - breath * 0.5) * (1 - squishCompression * 0.25));
      context.ellipse(centerX + focusShiftX * 0.35, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.ellipse(centerX + focusShiftX * 0.45, centerY, (88 + breath * 0.8) * (1 + squishCompression * 0.28), Math.max(15, (65 - breath * 0.4) * (1 - squishCompression * 0.28)), 0, 0, Math.PI * 2);
      context.strokeStyle = coreColor1 + (isDark ? "0.32)" : "0.42)");
      context.lineWidth = 1.4;
      context.setLineDash([4, 6]);
      context.stroke();
      context.restore();
    } else if (state.activeCategory === "keyboard") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 10;

      // 绘制流线型键盘机身底座
      const kbW = Math.min(logicalWidth * 0.65, 520);
      const kbH = 140;
      context.fillStyle = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(241, 245, 249, 0.85)";
      context.strokeStyle = isDark ? "rgba(71, 85, 105, 0.45)" : "rgba(203, 213, 225, 0.85)";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(centerX - kbW / 2, centerY - kbH / 2, kbW, kbH, 12);
      context.fill();
      context.stroke();

      // 绘制键帽涟漪脉冲
      for (let i = keycapVisualEvents.length - 1; i >= 0; i--) {
        const ev = keycapVisualEvents[i];
        ev.radius += 1.8;
        ev.alpha *= 0.94;
        context.beginPath();
        context.arc(ev.x, ev.y, ev.radius, 0, Math.PI * 2);
        context.strokeStyle = ev.color;
        context.globalAlpha = Math.max(0, ev.alpha);
        context.lineWidth = 1.6;
        context.stroke();
        context.globalAlpha = 1.0;
        if (ev.alpha < 0.02 || ev.radius > ev.maxR) {
          keycapVisualEvents.splice(i, 1);
        }
      }
      context.restore();
    } else if (state.activeCategory === "ambient") {
      context.save();
      const centerX = logicalWidth / 2;
      const centerY = logicalHeight / 2 - 10;
      state.ambOrbitPhase = (state.ambOrbitPhase || 0) + 0.008;

      // 绘制深空次低频同心光环
      const med = AMBIENT_MEDIA[state.currentAmbMedia];
      const orbitR = 80 + Math.sin(state.ambOrbitPhase) * 12;
      const ambGrad = context.createRadialGradient(centerX, centerY, 15, centerX, centerY, logicalWidth * 0.38);
      if (isDark) {
        ambGrad.addColorStop(0, "rgba(99, 102, 241, 0.14)");
        ambGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.05)");
      } else {
        ambGrad.addColorStop(0, "rgba(79, 70, 229, 0.12)");
        ambGrad.addColorStop(0.5, "rgba(2, 132, 199, 0.04)");
      }
      ambGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = ambGrad;
      context.beginPath();
      context.arc(centerX, centerY, logicalWidth * 0.38, 0, Math.PI * 2);
      context.fill();

      // 绘制漫游脉冲
      for (let i = cosmicVisualEvents.length - 1; i >= 0; i--) {
        const ev = cosmicVisualEvents[i];
        ev.radius += 1.2;
        ev.alpha *= 0.95;
        context.beginPath();
        context.arc(ev.x, ev.y, ev.radius, 0, Math.PI * 2);
        context.strokeStyle = ev.color;
        context.globalAlpha = Math.max(0, ev.alpha);
        context.lineWidth = 1.5;
        context.stroke();
        context.globalAlpha = 1.0;
        if (ev.alpha < 0.02 || ev.radius > ev.maxR) {
          cosmicVisualEvents.splice(i, 1);
        }
      }
      context.restore();
    }

    // 绘制各分类动态粒子
    for (let i = bowlRings.length - 1; i >= 0; i--) {
      const ring = bowlRings[i];
      ring.r += ring.expandSpeed;
      ring.alpha *= 0.985;
      context.save();
      context.beginPath();
      context.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      context.strokeStyle = ring.color + ring.alpha.toFixed(3) + ")";
      context.lineWidth = ring.width;
      context.stroke();
      context.restore();
      if (ring.alpha < 0.015 || ring.r > ring.maxR) bowlRings.splice(i, 1);
    }

    for (let i = chimeSparkles.length - 1; i >= 0; i--) {
      const sp = chimeSparkles[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.alpha *= sp.decay;
      sp.phase += 0.08;
      const currentSize = sp.size * (0.8 + Math.sin(sp.phase) * 0.3);
      context.save();
      context.beginPath();
      context.arc(sp.x, sp.y, Math.max(0.6, currentSize), 0, Math.PI * 2);
      context.fillStyle = sp.color + sp.alpha.toFixed(3) + ")";
      context.fill();
      context.restore();
      if (sp.alpha < 0.02) chimeSparkles.splice(i, 1);
    }

    for (let i = toolVisualEvents.length - 1; i >= 0; i--) {
      const ev = toolVisualEvents[i];
      context.save();
      if (ev.type === "scissors") {
        ev.progress += 0.09;
        ev.alpha *= 0.94;
        const bladeAngle = Math.sin(ev.progress * Math.PI) * 0.32;
        context.translate(ev.x, ev.y);
        context.rotate(ev.angle);
        context.strokeStyle = ev.color + ev.alpha.toFixed(3) + ")";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(-15, 0);
        context.lineTo(ev.len * Math.cos(-bladeAngle), ev.len * Math.sin(-bladeAngle));
        context.moveTo(-15, 0);
        context.lineTo(ev.len * Math.cos(bladeAngle), ev.len * Math.sin(bladeAngle));
        context.stroke();
      } else if (ev.type === "comb") {
        ev.progress += 0.06;
        ev.alpha *= 0.95;
        context.strokeStyle = ev.color + ev.alpha.toFixed(3) + ")";
        context.lineWidth = 1.2;
        for (let t = 0; t < ev.teeth; t++) {
          const tx = ev.x + (t - ev.teeth / 2) * ev.spacing;
          context.beginPath();
          context.moveTo(tx, ev.y + ev.progress * 25);
          context.lineTo(tx, ev.y + 16 + ev.progress * 25);
          context.stroke();
        }
      } else if (ev.type === "pencil") {
        ev.alpha *= 0.94;
        context.strokeStyle = ev.color + ev.alpha.toFixed(3) + ")";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(ev.x, ev.y, ev.len, ev.angle, ev.angle + 0.5);
        context.stroke();
      } else if (ev.type === "typewriter") {
        ev.r += 2.2;
        ev.alpha *= 0.92;
        context.strokeStyle = ev.color + ev.alpha.toFixed(3) + ")";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(ev.x, ev.y, ev.r, 0, Math.PI * 2);
        context.stroke();
      } else if (ev.type === "spray_drop") {
        ev.x += ev.vx;
        ev.y += ev.vy;
        ev.alpha *= ev.decay;
        context.fillStyle = ev.color + ev.alpha.toFixed(3) + ")";
        context.beginPath();
        context.arc(ev.x, ev.y, ev.r, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      if (ev.alpha < 0.02) toolVisualEvents.splice(i, 1);
    }

    for (let i = fireEmbers.length - 1; i >= 0; i--) {
      const em = fireEmbers[i];
      em.x += em.vx + Math.sin(em.wobblePhase) * 0.4;
      em.y += em.vy;
      em.wobblePhase += 0.06;
      em.alpha *= em.decay;
      context.save();
      context.beginPath();
      context.arc(em.x, em.y, Math.max(0.8, em.size), 0, Math.PI * 2);
      context.fillStyle = em.color + em.alpha.toFixed(3) + ")";
      context.fill();
      context.restore();
      if (em.alpha < 0.02 || em.y < -10) fireEmbers.splice(i, 1);
    }

    for (let i = squishBlobs.length - 1; i >= 0; i--) {
      const sb = squishBlobs[i];
      sb.x += sb.vx;
      sb.y += sb.vy;
      sb.alpha *= sb.decay;
      sb.r = Math.max(0.5, sb.r * 0.985);
      context.save();
      context.beginPath();
      context.arc(sb.x, sb.y, sb.r, 0, Math.PI * 2);
      context.fillStyle = sb.color + sb.alpha.toFixed(3) + ")";
      context.fill();
      context.restore();
      if (sb.alpha < 0.02) squishBlobs.splice(i, 1);
    }

    for (let i = squishRipples.length - 1; i >= 0; i--) {
      const sr = squishRipples[i];
      sr.rx += sr.expandSpeed * 1.5;
      sr.ry += sr.expandSpeed * 0.9;
      sr.alpha *= 0.95;
      context.save();
      context.beginPath();
      context.ellipse(sr.x, sr.y, sr.rx, sr.ry, 0, 0, Math.PI * 2);
      context.strokeStyle = sr.color + sr.alpha.toFixed(3) + ")";
      context.lineWidth = 1.5;
      context.stroke();
      context.restore();
      if (sr.alpha < 0.02 || sr.rx > sr.maxR) squishRipples.splice(i, 1);
    }

    for (let i = waterBubbles.length - 1; i >= 0; i--) {
      const b = waterBubbles[i];
      b.y -= b.vy;
      b.wobblePhase += 0.08;
      const wobbleX = Math.sin(b.wobblePhase) * 1.5;
      b.alpha *= 0.985;
      context.beginPath();
      context.arc(b.x + wobbleX, b.y, b.r, 0, Math.PI * 2);
      context.strokeStyle = b.color + b.alpha.toFixed(3) + ")";
      context.lineWidth = 1.2;
      context.stroke();
      context.beginPath();
      context.arc(b.x + wobbleX - b.r * 0.3, b.y - b.r * 0.3, Math.max(0.8, b.r * 0.35), 0, Math.PI * 2);
      context.fillStyle = b.color + (b.alpha * 0.8).toFixed(3) + ")";
      context.fill();
      if (b.y <= b.targetY || b.alpha < 0.05) {
        if (waterRipples.length < 45) {
          waterRipples.push({
            x: b.x,
            y: b.targetY,
            rx: 2,
            ry: 0.8,
            maxR: 18 + b.r * 2.5,
            alpha: 0.75,
            color: b.color
          });
        }
        waterBubbles.splice(i, 1);
      }
    }

    for (let i = waterRipples.length - 1; i >= 0; i--) {
      const r = waterRipples[i];
      r.rx += 1.3;
      r.ry += 0.52;
      r.alpha *= 0.95;
      context.beginPath();
      context.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, Math.PI * 2);
      context.strokeStyle = r.color + r.alpha.toFixed(3) + ")";
      context.lineWidth = 1.2;
      context.stroke();
      if (r.alpha < 0.02 || r.rx > r.maxR) waterRipples.splice(i, 1);
    }

    for (let i = fricStrokes.length - 1; i >= 0; i--) {
      const s = fricStrokes[i];
      s.progress += s.speed;
      s.alpha *= 0.985;
      context.save();
      context.beginPath();
      context.moveTo(s.x1, s.y1);
      context.quadraticCurveTo(s.cx, s.cy, s.x1 + (s.x2 - s.x1) * Math.min(1, s.progress), s.y1 + (s.y2 - s.y1) * Math.min(1, s.progress));
      context.strokeStyle = s.color + s.alpha.toFixed(3) + ")";
      context.lineWidth = s.lineWidth || 3;
      context.lineCap = "round";
      context.stroke();
      context.restore();
      if (s.progress >= 1.2 || s.alpha < 0.02) fricStrokes.splice(i, 1);
    }

    for (let i = fricParticles.length - 1; i >= 0; i--) {
      const fp = fricParticles[i];
      fp.x += fp.vx;
      fp.y += fp.vy;
      fp.alpha *= fp.decay;
      context.beginPath();
      context.arc(fp.x, fp.y, fp.size, 0, Math.PI * 2);
      context.fillStyle = fp.color + fp.alpha.toFixed(3) + ")";
      context.fill();
      if (fp.alpha < 0.02) fricParticles.splice(i, 1);
    }

    for (let i = rippleParticles.length - 1; i >= 0; i--) {
      const rip = rippleParticles[i];
      rip.rx += 0.9;
      rip.ry += 0.35;
      rip.alpha *= 0.95;
      context.beginPath();
      context.ellipse(rip.x, rip.y, rip.rx, rip.ry, 0, 0, Math.PI * 2);
      context.strokeStyle = rip.color + rip.alpha.toFixed(2) + ")";
      context.lineWidth = 1.2;
      context.stroke();
      if (rip.alpha < 0.02 || rip.rx > rip.maxR) rippleParticles.splice(i, 1);
    }

    for (let i = tapShockwaves.length - 1; i >= 0; i--) {
      const s = tapShockwaves[i];
      s.r += 1.8;
      s.alpha *= 0.94;
      context.beginPath();
      context.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      context.strokeStyle = s.color + s.alpha.toFixed(3) + ")";
      context.lineWidth = 2;
      context.stroke();

      context.beginPath();
      context.arc(s.x, s.y, Math.max(1, 3 * s.alpha), 0, Math.PI * 2);
      context.fillStyle = s.color + s.alpha.toFixed(3) + ")";
      context.fill();
      if (s.alpha < 0.02 || s.r > s.maxR) tapShockwaves.splice(i, 1);
    }

    // 绘制中央 3Dio 轻量人耳位置示意
    const centerX = logicalWidth / 2;
    const centerY = logicalHeight / 2 - 12;

    context.save();
    context.translate(centerX, centerY);

    context.beginPath();
    context.ellipse(0, 0, 32, 44, 0, 0, Math.PI * 2);
    context.fillStyle = isDark ? "rgba(22, 38, 44, 0.75)" : "rgba(255, 255, 255, 0.92)";
    const headStrokeDark = {
      rain: "rgba(45, 212, 191, 0.28)",
      tapping: "rgba(241, 166, 90, 0.28)",
      friction: "rgba(244, 114, 182, 0.28)",
      water: "rgba(56, 189, 248, 0.35)",
      bowls: "rgba(245, 158, 11, 0.35)",
      tools: "rgba(56, 189, 248, 0.40)",
      fire: "rgba(249, 115, 22, 0.40)",
      squish: "rgba(52, 211, 153, 0.45)",
      keyboard: "rgba(167, 139, 250, 0.40)",
      ambient: "rgba(99, 102, 241, 0.45)"
    };
    const headStrokeLight = {
      rain: "rgba(15, 129, 141, 0.42)",
      tapping: "rgba(217, 119, 6, 0.42)",
      friction: "rgba(190, 24, 93, 0.42)",
      water: "rgba(2, 132, 199, 0.45)",
      bowls: "rgba(217, 119, 6, 0.45)",
      tools: "rgba(2, 132, 199, 0.50)",
      fire: "rgba(194, 65, 12, 0.50)",
      squish: "rgba(5, 150, 105, 0.50)",
      keyboard: "rgba(124, 58, 237, 0.45)",
      ambient: "rgba(79, 70, 229, 0.50)"
    };
    context.strokeStyle = isDark
      ? (headStrokeDark[state.activeCategory] || "rgba(52, 211, 153, 0.45)")
      : (headStrokeLight[state.activeCategory] || "rgba(5, 150, 105, 0.50)");
    context.lineWidth = 1.5;
    context.fill();
    context.stroke();

    context.beginPath();
    context.ellipse(-38, 0, 7, 16, 0, 0, Math.PI * 2);
    context.fillStyle = isDark ? "rgba(15, 118, 110, 0.85)" : "rgba(13, 148, 136, 0.92)";
    context.strokeStyle = isDark ? "#2dd4bf" : "#0f766e";
    context.lineWidth = 1.5;
    context.fill();
    context.stroke();

    context.beginPath();
    context.ellipse(38, 0, 7, 16, 0, 0, Math.PI * 2);
    context.fillStyle = isDark ? "rgba(3, 105, 161, 0.85)" : "rgba(2, 132, 199, 0.92)";
    context.strokeStyle = isDark ? "#38bdf8" : "#0284c7";
    context.lineWidth = 1.5;
    context.fill();
    context.stroke();

    for (let i = earWavesL.length - 1; i >= 0; i--) {
      const e = earWavesL[i];
      e.r += 1.4;
      e.alpha *= 0.93;
      context.beginPath();
      context.arc(-38, 0, e.r, Math.PI * 0.5, Math.PI * 1.5);
      context.strokeStyle = (isDark ? "rgba(45, 212, 191, " : "rgba(13, 148, 136, ") + e.alpha.toFixed(3) + ")";
      context.lineWidth = 1.5;
      context.stroke();
      if (e.alpha < 0.02 || e.r > e.maxR) earWavesL.splice(i, 1);
    }

    for (let i = earWavesR.length - 1; i >= 0; i--) {
      const e = earWavesR[i];
      e.r += 1.4;
      e.alpha *= 0.93;
      context.beginPath();
      context.arc(38, 0, e.r, -Math.PI * 0.5, Math.PI * 0.5);
      context.strokeStyle = (isDark ? "rgba(56, 189, 248, " : "rgba(2, 132, 199, ") + e.alpha.toFixed(3) + ")";
      context.lineWidth = 1.5;
      context.stroke();
      if (e.alpha < 0.02 || e.r > e.maxR) earWavesR.splice(i, 1);
    }

    context.restore();
  }

  // ==========================================================================
  // 主渲染循环调度器 (Master Animation Render Loop)
  // ==========================================================================
  function renderLoop(timestamp = 0) {
    flushTrackVisuals();
    animFrameId = null;
    if (document.hidden || reducedMotion.matches) return;
    animFrameId = requestAnimationFrame(renderLoop);
    // 小屏按 30fps 绘制，高刷设备也保持原有的 60fps 动画速度。
    const interval = compactViewport.matches ? 1000 / 30 : 1000 / 60;
    if (timestamp - lastRenderTime < interval - 1) return;
    lastRenderTime = timestamp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const isDark = isDarkThemeActive();

    if (state.visualMode === "radar") {
      draw3DioRadarScope(ctx, isDark);
    } else if (state.visualMode === "minimal") {
      drawMinimalSleepView(ctx, isDark);
    } else {
      drawScenicParticleView(ctx, isDark);
    }

  }

  function syncVisualPlayback() {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    lastRenderTime = 0;
    if (!document.hidden && !reducedMotion.matches) animFrameId = requestAnimationFrame(renderLoop);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    logicalWidth = rect.width || 960;
    logicalHeight = rect.height || 380;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(logicalWidth * dpr);
    canvas.height = Math.round(logicalHeight * dpr);

    initParticles();
  }

  // --------------------------------------------------------------------------
  // D. AI ASMR 提示词工坊与生成逻辑 (雨声 & 敲击声)
  // --------------------------------------------------------------------------
  function generatePrompt() {
    generateSinglePrompt();
    document.getElementById("promptCategoryBadge").textContent = selectedTrackId ? "当前轨道编辑 · 下方附混音组合" : "当前浏览声音 · 下方附混音组合";
    if (!tracks.length) return;
    const audible = tracks.filter(isAudible);
    const zh = audible.map(t => `${trackName(t)}（相对电平 ${Math.round(t.volume * 100)}%）`).join("；");
    const en = audible.map(t => `${t.category}: ${trackEnglishName(t)}, relative fader ${Math.round(t.volume * 100)}%`).join("; ");
    document.getElementById("txtGeneratedZhPrompt").value += "\n\n混音组合：" + (zh || "所有轨道已静音") + "。各轨保留独立双耳空间，背景持续自然演化，事件疏密错落，平滑进入与退出。电平百分比为推子设置，不代表感知响度比例。";
    document.getElementById("txtGeneratedEnPrompt").value += "\n\nMix layers: " + (en || "all layers muted") + ". Preserve each layer's binaural placement, continuously evolving ambience, organic event spacing and smooth transitions. Fader settings are not perceived loudness ratios.";
  }

  function trackEnglishName(track) {
    const c = track.config;
    const preset = { rain: RAIN_PRESETS[c.currentRain], tapping: TAPPING_MATERIALS[c.currentTapMat],
      friction: FRICTION_MATERIALS[c.currentFricMat], water: WATER_SCENARIOS[c.currentWaterScene],
      bowls: BOWLS_INSTRUMENTS[c.currentBowlInst], tools: TOOLS_INSTRUMENTS[c.currentToolInst],
      fire: FIRE_INSTRUMENTS[c.currentFireInst], squish: SQUISH_MATERIALS[c.currentSquishMat],
      keyboard: KEYBOARD_SWITCHES[c.currentKeySwitch], ambient: AMBIENT_MEDIA[c.currentAmbMedia] }[track.category];
    const style = trackStyle(track);
    return (preset.enName || preset.name) + (track.category === "rain" ? " on " + RAIN_SURFACES[c.currentSurface].enName : "") + (style ? ", " + (style.enName || style.name) : "");
  }

  function generateSinglePrompt() {
    let en = "";
    let zh = "";
    let neg = "";

    if (state.activeCategory === "rain") {
      const rain = RAIN_PRESETS[state.currentRain];
      const surf = RAIN_SURFACES[state.currentSurface];

      en = "ASMR, binaural 3Dio style recording, " + rain.enName + " naturally pattering with organic wind-swept micro-clusters onto " + surf.enName + ". ";
      en += "Varied droplet sizes from fine mist to occasional heavy coalesced eave drips, cushioned dull surface impacts, warm low-mid shelter enclosure resonance, non-repetitive hypnotic sleep ambience. ";
      en += "Extreme close-up proximity effect, zero high-frequency harshness, zero synthetic tonal beeps, zero sharp clicks.";
      if (rain.thunder) {
        en += " Distant muffled sub-bass thunder rumble rolling organically across the horizon, no sudden jumpscare cracks.";
      }

      zh = "ASMR双耳3Dio录音，" + rain.name + "打在" + surf.zhPrompt + "。";
      zh += "包含细雾雨滴、阵雨雨簇与偶发檐滴，阻尼钝感与掩体共鸣，避免机械循环感。";
      zh += "近场双耳声学，无尖锐高频，无电子合成滴答声。";
      if (rain.thunder) {
        zh += " 背景伴有远方低沉滚过的闷雷，无突兀炸裂声。";
      }

      neg = "harsh, sharp, shrill, piercing, metallic, synthetic sine beeps, cartoon bubble pops, mechanical metronome loop, robotic artifacts, digital phasing, sibilant, loud clicks, startling jumpscares, clipping, distortion, heavy cavernous reverb, white noise hiss";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = rain.name + " · " + surf.name;
      if (hudDesc) hudDesc.textContent = rain.desc;
    } else if (state.activeCategory === "tapping") {
      // 敲击声提示词
      const mat = TAPPING_MATERIALS[state.currentTapMat];
      const style = TAPPING_STYLES[state.currentTapStyle];

      en = "ASMR, binaural 3Dio style recording, " + style.enName + " on a " + mat.enName + " using soft flesh finger pads and gently trimmed fingernails. ";
      en += "Organic human five-finger timbre and velocity variations, natural center-to-edge hit spot resonance, warm cushioned low-mid body, and subtle finger-pad lift-off micro-textures. ";
      en += "Extreme intimate close-up ear-to-ear proximity effect, zero synthetic xylophone tones, zero sharp plastic clatter, dry studio acoustics, pure tactile sleep triggers.";

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在" + mat.zhPrompt + "上轻触。";
      zh += "包含手指力度微差、中心与边缘落点变化及抬指细节，避免机械木琴音色。";
      zh += "近场双耳立体声，无指甲刮擦声，消音室干燥声学。";

      neg = "harsh, sharp plastic clicks, synthetic xylophone notes, marimba tones, robotic drum roll, fingernail scraping, piercing clatter, loud smacks, metallic ticks, sudden jumpscares, cavernous reverb, clipping, noisy background hiss";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = mat.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = mat.desc;
    } else if (state.activeCategory === "friction") {
      // 摩擦声提示词
      const mat = FRICTION_MATERIALS[state.currentFricMat];
      const style = FRICTION_STYLES[state.currentFricStyle];

      en = "ASMR, binaural 3Dio style recording, " + style.enName + " with " + mat.enName + " across sensitive silicone dummy head ears. ";
      en += "Organic directional variations between single-ear contour lingering and cross-ear sweeps, natural push-and-pull pressure breathing, varied stroke durations with human rubato, and warm low-mid proximity cushion. ";
      en += "Intimate close-up ear-to-ear spatial movement, zero synthetic sine hum, zero harsh scratchy noises, zero sharp fingernail scraping, dry soundproof studio acoustics, no reverberation.";

      zh = "ASMR双耳3Dio录音，使用" + mat.zhPrompt + "进行" + style.zhPrompt + "。";
      zh += "具备推拉强弱起伏与自然抚摩节奏。";
      zh += "近场双耳立体声，无刺耳刮擦声，消音室干燥声学，无多余混响。";

      neg = "harsh scratching, screeching, fingernails on chalkboard, synthetic sine drone, robotic fixed-tempo loop, mechanical tremolo LFO, sharp friction, scraping, ear-piercing high frequencies, plastic squeaks, loud abrasive rubbing, clipping, heavy reverb";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = mat.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = mat.desc;
    } else if (state.activeCategory === "water") {
      // 水流声提示词
      const scene = WATER_SCENARIOS[state.currentWaterScene];
      const style = WATER_STYLES[state.currentWaterStyle];

      en = "ASMR, binaural 3Dio style recording, " + scene.enName + " with " + style.enName + " in extreme close-up. ";
      en += "Organic laminar and riffle water glides, natural droplet plinks, restrained multi-radius bubbles with wide pitch dispersion, mellow low-mid aqueous resonance, non-periodic breathing flow. ";
      en += "Intimate close-up ear-to-ear panning, pure dry studio acoustics, zero synthetic sine bubble loops, zero harsh splashing, comforting fluid ambience.";
      if (scene.shishi) {
        en += " Intermittent deep hollow bamboo clack on wet river stone followed by a gentle water pour, no sudden startling crack.";
      }

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在极近距离聆听" + scene.zhPrompt + "。";
      zh += "包含流水微澜、石面流动与错落水滴，搭配自然气泡与中低频水体共鸣。";
      zh += "双耳流动感，无刺耳飞溅，消音室干燥声学，无多余混响。";
      if (scene.shishi) {
        zh += " 伴随间歇性竹筒注满倾水与叩击溪石的清脆钝响。";
      }

      neg = "dense repetitive bubble pops, synthetic sine bloops, uniform pitch bubbles, machine-gun bubbling, harsh splashes, loud gushing, jarring waterfall roar, shrill high frequencies, digital clipping, heavy cavernous reverb, noisy river torrent";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = scene.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = scene.desc;
    } else if (state.activeCategory === "bowls") {
      // 能量泛音与音疗钵铃提示词
      const inst = BOWLS_INSTRUMENTS[state.currentBowlInst];
      const style = BOWLS_STYLES[state.currentBowlStyle];

      en = "ASMR, binaural 3Dio style recording, " + inst.enName + " played with " + style.enName + " in extreme close-up. ";
      en += "Pure sine wave overtones, delicate and ethereal metallic resonance, ultra-long natural decay, calming harmonic singing, meditative and hypnotic cadence. ";
      en += "Intimate close-up ear-to-ear sound immersion, zero harsh clatter, zero startling loud strikes, dry studio acoustics, soundproof room, pure spiritual peace.";

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在极近距离敲奏" + inst.zhPrompt + "。";
      zh += "正弦波泛音共鸣与长衰减延音，声波平稳悠长。";
      zh += "近场双耳环绕，无尖锐金属撞击声与高频哨鸣，消音室干燥声学。";

      neg = "harsh metallic clanging, loud dissonant ringing, startling loud chime strikes, ear-piercing high frequencies, digital distortion, clipping, muddy rumble, echo, noisy background hiss, jarring transients";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = inst.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = inst.desc;
    } else if (state.activeCategory === "tools") {
      // 伴读工具与微机械提示词
      const inst = TOOLS_INSTRUMENTS[state.currentToolInst];
      const style = TOOLS_STYLES[state.currentToolStyle];

      en = "ASMR, binaural 3Dio style recording, " + inst.enName + " with " + style.enName + " in extreme close-up. ";
      en += "Delicate micro-textures, crisp yet softened transients, gentle rhythmic cadence, soothing personal grooming attention, dry studio acoustics. ";
      en += "Intimate ear-to-ear stereophonic immersion, zero harsh metallic clatter, zero startling loud clicks, zero sharp sibilance, soundproof room, pure relaxation.";

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在耳畔近距离体验" + inst.zhPrompt + "。";
      zh += "近耳生活质感，柔化高频，节奏平缓稳定。";
      zh += "近场双耳定位，无金属刮擦与尖锐杂音，消音室干燥声学。";

      neg = "harsh metallic screech, chalkboard screech, ear-piercing clicks, loud startling snaps, sharp sibilance, distorted clipping, muddy bass rumble, cavernous echo, heavy room reverb, background noise";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = inst.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = inst.desc;
    } else if (state.activeCategory === "fire") {
      // 暖冬壁炉与自然碎裂提示词
      const inst = FIRE_INSTRUMENTS[state.currentFireInst];
      const style = FIRE_STYLES[state.currentFireStyle];

      en = "ASMR, binaural 3Dio style recording, " + inst.enName + " with " + style.enName + " in extreme close-up. ";
      en += "Soothing thermal convection drafts, soft ash and organic fiber glides, restrained multi-band micro-pops with wide pitch dispersion, non-periodic breathing pauses, cozy low-mid hearth resonance. ";
      en += "Intimate binaural stereophonic immersion, zero dense repetitive popping loops, zero uniform-pitch clicks, zero sudden explosive bangs, pure cozy warmth, soundproof studio acoustics.";

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在耳畔近距离聆听" + inst.zhPrompt + "。";
      zh += "包含木炭热流与偶发微爆碎裂声，节奏错落自然，避免密集机械爆鸣。";
      zh += "双耳立体声包裹，无突兀炸裂爆音，消音室干燥声学。";

      neg = "dense repetitive popping, machine-gun crackles, uniform pitch clicks, loud explosive bangs, startling gunshots, fireworks noise, harsh sharp crackles, synthetic sine bloops, digital distortion, clipping, cavernous echo";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = inst.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = inst.desc;
    } else if (state.activeCategory === "squish") {
      // 触觉揉捏、微塑性形变与软胶提示词
      const mat = SQUISH_MATERIALS[state.currentSquishMat];
      const style = SQUISH_STYLES[state.currentSquishStyle];

      en = "ASMR, binaural 3Dio style recording, " + style.enName + " with " + mat.enName + " in extreme close-up. ";
      en += "Two-stage viscoelastic compression and slow air-inhaling rebound, subtle micro-tacky finger-pad detachment, multi-scale cushioned pore releases with wide pitch dispersion, non-periodic human hand rubato. ";
      en += "Intimate ear-to-ear stereophonic immersion, zero synthetic sine bloops, zero uniform-pitch machine-gun pops, zero harsh plastic crinkles, pure dry soundproof studio acoustics.";

      zh = "ASMR双耳3Dio录音，以" + style.zhPrompt + "在耳畔近距离揉捏" + mat.zhPrompt + "。";
      zh += "包含按压排气、慢速回弹与微小气孔舒展声，消除电子合成水泡音。";
      zh += "双耳近场定位，无尖锐塑料摩擦与黏腻拍打声，消音室干燥声学。";

      neg = "synthetic sine bloops, cartoon bubble pops, uniform pitch clicks, machine-gun popping, harsh plastic crinkles, sharp squeaks, loud sticky smacks, rubber screeching, high-frequency distortion, digital clipping, cavernous echo";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = mat.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = mat.desc;
    } else if (state.activeCategory === "keyboard") {
      const sw = KEYBOARD_SWITCHES[state.currentKeySwitch];
      const style = KEYBOARD_STYLES[state.currentKeyStyle];

      en = "ASMR, binaural 3Dio close-up recording, " + sw.enName + ", " + style.enName + ". ";
      en += "Deep creamy thock acoustic resonance, solid bottom-out sound on desk mat, zero spring ping, zero scratchiness, consistent cadence. ";
      en += "Intimate binaural stereophonic hand movement, dry soundproof acoustics, zero cavernous reverb, pure tactile mechanical keyboard relaxation.";

      zh = "ASMR双耳3Dio近讲录音，" + sw.zhPrompt + "，" + style.zhPrompt + "。";
      zh += "厚润触底声音，扎实平稳，无弹簧杂音，节奏稳定。";
      zh += "左右手自然声相移动，消音室干燥声学，无大空间混响。";

      neg = "spring ping, scratchy leaf, shrill metallic ping, harsh clack, sudden smacks, clipping, distortion, cavernous reverb, echo, noisy background";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = sw.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = sw.desc;
    } else if (state.activeCategory === "ambient") {
      const med = AMBIENT_MEDIA[state.currentAmbMedia];
      const style = AMBIENT_STYLES[state.currentAmbStyle];

      en = "ASMR, binaural 3Dio spatial soundscape, " + med.enName + ", " + style.enName + ". ";
      en += "Deep sub-bass atmospheric cocoon, soothing continuous analog warmth, zero sudden startling noises, hypnotic low-frequency immersion. ";
      en += "Ethereal gentle spatial movement, pure restorative white noise bed for deep sleep and meditation, warm tape saturation.";

      zh = "ASMR双耳3Dio全景声景，" + med.zhPrompt + "，" + style.zhPrompt + "。";
      zh += "低频背景声包裹，平稳连绵，无突兀杂音。";
      zh += "双耳空间漫游，平缓舒畅，消音室干燥声学。";

      neg = "harsh static burst, piercing whistle, loud alarm, startling crack, digital glitch, sharp clipping, distortion, aggressive techno drone, muddy noise";

      const hudTitle = document.getElementById("hudPresetTitle");
      const hudDesc = document.getElementById("hudPresetDesc");
      if (hudTitle) hudTitle.textContent = med.name + " · " + style.name;
      if (hudDesc) hudDesc.textContent = med.desc;
    }

    const txtEn = document.getElementById("txtGeneratedEnPrompt");
    const txtZh = document.getElementById("txtGeneratedZhPrompt");
    const txtNeg = document.getElementById("txtNegativePrompt");
    if (txtEn) txtEn.value = en;
    if (txtZh) txtZh.value = zh;
    if (txtNeg) txtNeg.value = neg;
  }

  // --------------------------------------------------------------------------
  // E. 交互事件与 UI 响应绑定
  // --------------------------------------------------------------------------
  function switchCategory(cat) {
    if (!syncingEditor) leaveTrackEditor();
    if (state.activeCategory === cat) return;
    if (playbackMode === "independent") stopAudio();

    state.activeCategory = cat;

    // 切换 Tab 视觉
    document.querySelectorAll(".cat-tab-btn").forEach(btn => {
      const match = btn.getAttribute("data-cat") === cat;
      btn.classList.toggle("active", match);
      btn.setAttribute("aria-selected", match ? "true" : "false");
      btn.tabIndex = match ? 0 : -1;
    });

    // 切换控制面板
    const panelRain = document.getElementById("panelRainCategory");
    const panelTapping = document.getElementById("panelTappingCategory");
    const panelFriction = document.getElementById("panelFrictionCategory");
    const panelWater = document.getElementById("panelWaterCategory");
    const panelBowls = document.getElementById("panelBowlsCategory");
    const panelTools = document.getElementById("panelToolsCategory");
    const panelFire = document.getElementById("panelFireCategory");
    const panelSquish = document.getElementById("panelSquishCategory");
    const panelKeyboard = document.getElementById("panelKeyboardCategory");
    const panelAmbient = document.getElementById("panelAmbientCategory");
    if (panelRain) {
      panelRain.classList.toggle("active", cat === "rain");
      panelRain.hidden = cat !== "rain";
    }
    if (panelTapping) {
      panelTapping.classList.toggle("active", cat === "tapping");
      panelTapping.hidden = cat !== "tapping";
    }
    if (panelFriction) {
      panelFriction.classList.toggle("active", cat === "friction");
      panelFriction.hidden = cat !== "friction";
    }
    if (panelWater) {
      panelWater.classList.toggle("active", cat === "water");
      panelWater.hidden = cat !== "water";
    }
    if (panelBowls) {
      panelBowls.classList.toggle("active", cat === "bowls");
      panelBowls.hidden = cat !== "bowls";
    }
    if (panelTools) {
      panelTools.classList.toggle("active", cat === "tools");
      panelTools.hidden = cat !== "tools";
    }
    if (panelFire) {
      panelFire.classList.toggle("active", cat === "fire");
      panelFire.hidden = cat !== "fire";
    }
    if (panelSquish) {
      panelSquish.classList.toggle("active", cat === "squish");
      panelSquish.hidden = cat !== "squish";
    }
    if (panelKeyboard) {
      panelKeyboard.classList.toggle("active", cat === "keyboard");
      panelKeyboard.hidden = cat !== "keyboard";
    }
    if (panelAmbient) {
      panelAmbient.classList.toggle("active", cat === "ambient");
      panelAmbient.hidden = cat !== "ambient";
    }

    // 切换调音台控件可见性
    document.querySelectorAll(".rain-tweak").forEach(el => el.hidden = (cat !== "rain"));
    document.querySelectorAll(".tap-tweak").forEach(el => el.hidden = (cat !== "tapping"));
    document.querySelectorAll(".fric-tweak").forEach(el => el.hidden = (cat !== "friction"));
    document.querySelectorAll(".water-tweak").forEach(el => el.hidden = (cat !== "water"));
    document.querySelectorAll(".bowls-tweak").forEach(el => el.hidden = (cat !== "bowls"));
    document.querySelectorAll(".tools-tweak").forEach(el => el.hidden = (cat !== "tools"));
    document.querySelectorAll(".fire-tweak").forEach(el => el.hidden = (cat !== "fire"));
    document.querySelectorAll(".squish-tweak").forEach(el => el.hidden = (cat !== "squish"));
    document.querySelectorAll(".keyboard-tweak").forEach(el => el.hidden = (cat !== "keyboard"));
    document.querySelectorAll(".ambient-tweak").forEach(el => el.hidden = (cat !== "ambient"));

    // 切换标题与文字
    const stageTitle = document.getElementById("stageMainTitle");
    const playBtnText = document.getElementById("playBtnText");
    const badge = document.getElementById("promptCategoryBadge");

    if (cat === "rain") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL RAIN SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放雨声 (Space)";
      if (badge) badge.textContent = "雨声提示词已联动";
    } else if (cat === "tapping") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL TAPPING SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放敲击声 (Space)";
      if (badge) badge.textContent = "敲击声提示词已联动";
    } else if (cat === "friction") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL FRICTION SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放摩擦声 (Space)";
      if (badge) badge.textContent = "摩擦声提示词已联动";
    } else if (cat === "water") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL WATER SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放水流声 (Space)";
      if (badge) badge.textContent = "水流声提示词已联动";
    } else if (cat === "bowls") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL SOUND BOWLS STAGE";
      if (playBtnText) playBtnText.textContent = "播放钵铃声 (Space)";
      if (badge) badge.textContent = "钵铃提示词已联动";
    } else if (cat === "tools") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL GROOMING & TOOLS SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放微机械声 (Space)";
      if (badge) badge.textContent = "微机械提示词已联动";
    } else if (cat === "fire") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL FIREPLACE & HEARTH SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放壁炉炭火声 (Space)";
      if (badge) badge.textContent = "壁炉炭火提示词已联动";
    } else if (cat === "squish") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL SQUISH & DEFORMATION SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放揉捏软胶声 (Space)";
      if (badge) badge.textContent = "揉捏软胶提示词已联动";
    } else if (cat === "keyboard") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL MECHANICAL KEYBOARD SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放机械键盘声 (Space)";
      if (badge) badge.textContent = "机械键盘提示词已联动";
    } else if (cat === "ambient") {
      if (stageTitle) stageTitle.textContent = "3Dio BINAURAL COSMIC & VINTAGE SOUNDSTAGE";
      if (playBtnText) playBtnText.textContent = "播放深空漫游声 (Space)";
      if (badge) badge.textContent = "深空模拟提示词已联动";
    }

    updateAcousticNodes();
    generatePrompt();

    // 清空旧特效残留
    rippleParticles = [];
    tapShockwaves = [];
    fricStrokes = [];
    fricParticles = [];
    waterBubbles = [];
    waterRipples = [];
    bowlRings = [];
    chimeSparkles = [];
    toolVisualEvents = [];
    fireEmbers = [];
    squishBlobs = [];
    squishRipples = [];
    squishCompression = 0;
    keycapVisualEvents = [];
    cosmicVisualEvents = [];

    updateUIPlayState();
  }

  function updateUIPlayState() {
    const btn = document.getElementById("btnMainPlay");
    const pulse = document.getElementById("statusPulse");
    const playText = document.getElementById("playBtnText");
    const catName = { rain: "雨声", tapping: "敲击声", friction: "摩擦声", water: "水流声",
      bowls: "钵铃声", tools: "工具声", fire: "壁炉声", squish: "软胶声", keyboard: "键盘声", ambient: "氛围声" }[state.activeCategory];
    const independentActive = playbackMode === "independent" && (state.isPlaying || transportState === "starting");
    const mixActive = playbackMode === "mix" && (state.isPlaying || transportState === "starting");

    if (independentActive) {
      if (btn) {
        btn.classList.add("playing");
        btn.setAttribute("aria-pressed", "true");
      }
      if (playText) playText.textContent = "暂停" + catName + (compactViewport.matches ? "" : " (Space)");
    } else {
      if (btn) {
        btn.classList.remove("playing");
        btn.setAttribute("aria-pressed", "false");
      }
      if (playText) playText.textContent = "播放" + catName + (compactViewport.matches ? "" : " (Space)");
    }
    if (pulse) pulse.classList.toggle("active", state.isPlaying);
    document.getElementById("btnMixPlay").setAttribute("aria-pressed", String(mixActive));
    document.getElementById("btnMixPlay").textContent = mixActive ? "暂停混音" : "播放混音";
    document.getElementById("mixerCompactStatus").textContent = mixActive ? "播放中 · " + tracks.length + " 轨" : tracks.length + " / 4 轨";
  }

  function updateSleepTimer() {
    if (sleepTimerTickId) {
      clearTimeout(sleepTimerTickId);
      sleepTimerTickId = null;
    }
    const display = document.getElementById("timerDisplay");
    if (!state.isPlaying || state.sleepTimerMinutes <= 0) {
      if (display) display.textContent = "";
      return;
    }

    const remaining = Math.max(0, Math.ceil((state.sleepTimerEnd - Date.now()) / 1000));
    if (remaining <= 0) {
      stopAudio();
      if (display) display.textContent = "已安眠停止";
      return;
    }

    // 睡眠定时器最后 10 秒平滑渐弱淡出，避免突兀静音惊醒
    if (remaining <= 10 && audioCtx && masterGain) {
      const fadeVol = Math.max(0.0001, state.masterVol * (remaining / 10));
      masterGain.gain.setTargetAtTime(fadeVol, audioCtx.currentTime, 0.35);
    }

    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (display) {
      display.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    }

    sleepTimerTickId = setTimeout(updateSleepTimer, 1000);
  }

  function setupEventBindings() {
    // 0. 大类 Tab 切换
    document.querySelectorAll(".cat-tab-btn").forEach(btn => {
      const panelId = btn.id.replace(/^tab/, "panel");
      btn.tabIndex = btn.getAttribute("aria-selected") === "true" ? 0 : -1;
      btn.setAttribute("aria-controls", panelId);
      const panel = document.getElementById(panelId);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", btn.id);
      btn.addEventListener("click", () => {
        const cat = btn.getAttribute("data-cat");
        switchCategory(cat);
      });
      btn.addEventListener("keydown", (e) => {
        const tabs = Array.from(document.querySelectorAll(".cat-tab-btn"));
        const index = tabs.indexOf(btn);
        let next;
        if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        else return;
        e.preventDefault();
        tabs[next].click();
        tabs[next].focus({ preventScroll: true });
        // 只移动横向分类栏，避免切换声音时整页跳动。
        const bar = btn.parentElement;
        const target = tabs[next];
        const bounds = bar.getBoundingClientRect();
        const item = target.getBoundingClientRect();
        if (item.left < bounds.left) bar.scrollLeft += item.left - bounds.left;
        else if (item.right > bounds.right) bar.scrollLeft += item.right - bounds.right;
      });
    });

    // 1. 播放/暂停
    const btnMainPlay = document.getElementById("btnMainPlay");
    btnMainPlay.addEventListener("click", () => {
      if (playbackMode === "independent" && (state.isPlaying || transportState === "starting")) {
        stopAudio();
      } else {
        startAudio();
      }
    });

    // 1.1 点击 3Dio 声学画布任意方位即时触发对应声相的双耳试听事件
    if (canvas) {
      canvas.style.cursor = "pointer";
      canvas.addEventListener("click", (e) => {
        if (!state.isPlaying || playbackMode !== "independent") {
          startAudio();
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const clickAz = Math.max(-0.95, Math.min(0.95, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1));
        auditionTrack(clickAz);
      });
    }

    // 空格键快捷播放
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey &&
          !e.target.closest("input, textarea, select, button, a, [contenteditable], [role='button']")) {
        e.preventDefault();
        btnMainPlay.click();
      }
    });

    // 2. 雨量切换
    document.querySelectorAll(".preset-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".preset-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentRain = btn.getAttribute("data-rain");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 3. 雨声吸音介质切换
    document.querySelectorAll(".surface-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".surface-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentSurface = btn.getAttribute("data-surface");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 4. 敲击材质选择
    document.querySelectorAll(".tap-mat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tap-mat-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentTapMat = btn.getAttribute("data-mat");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5. 敲击手法选择
    document.querySelectorAll(".tap-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tap-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentTapStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 5.2 摩擦材质选择
    document.querySelectorAll(".fric-mat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".fric-mat-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentFricMat = btn.getAttribute("data-mat");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.3 摩擦手法与轨迹选择
    document.querySelectorAll(".fric-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".fric-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentFricStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 5.4 水流场景选择
    document.querySelectorAll(".water-scene-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".water-scene-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentWaterScene = btn.getAttribute("data-scene");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.5 水流动态与手法选择
    document.querySelectorAll(".water-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".water-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentWaterStyle = btn.getAttribute("data-style");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.6 颂钵与音疗乐器选择
    document.querySelectorAll(".bowl-inst-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".bowl-inst-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentBowlInst = btn.getAttribute("data-inst");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.7 颂钵演奏手法选择
    document.querySelectorAll(".bowl-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".bowl-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentBowlStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 5.8 伴读工具与微机械选择
    document.querySelectorAll(".tool-inst-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tool-inst-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentToolInst = btn.getAttribute("data-inst");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.9 工具动作手法与轨迹选择
    document.querySelectorAll(".tool-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tool-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentToolStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 5.10 暖冬壁炉与自然碎裂材质选择
    document.querySelectorAll(".fire-inst-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".fire-inst-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentFireInst = btn.getAttribute("data-inst");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.11 壁炉环境氛围与节拍选择
    document.querySelectorAll(".fire-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".fire-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentFireStyle = btn.getAttribute("data-style");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.12 触觉揉捏与软体材质选择
    document.querySelectorAll(".squish-mat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".squish-mat-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentSquishMat = btn.getAttribute("data-mat");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 5.13 揉捏手法与节奏选择
    document.querySelectorAll(".squish-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".squish-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentSquishStyle = btn.getAttribute("data-style");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    // 6. 视觉模式切换 (联动 stageViewport 样式与 HUD 状态)
    const stageVp = document.getElementById("stageViewport");
    const hudEarTip = document.getElementById("hudEarTip");

    function applyVisualMode(mode) {
      state.visualMode = mode;
      document.querySelectorAll(".mode-btn").forEach(b => {
        const selected = b.getAttribute("data-mode") === mode;
        b.classList.toggle("active", selected);
        b.setAttribute("aria-pressed", String(selected));
      });
      if (stageVp) {
        stageVp.classList.remove("mode-scenic", "mode-radar", "mode-minimal");
        stageVp.classList.add("mode-" + mode);
      }
      if (hudEarTip) {
        if (mode === "radar") {
          hudEarTip.textContent = "🎯 3Dio 声学雷达：360° 声相与 ITD 空间微延迟实时追踪";
        } else if (mode === "minimal") {
          hudEarTip.textContent = "🌙 极简休眠暗光：低视觉刺激，伴您安然入眠";
        } else {
          hudEarTip.textContent = "戴上耳机体验耳畔空间环绕";
        }
      }
    }

    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        applyVisualMode(btn.getAttribute("data-mode"));
      });
    });

    applyVisualMode("scenic");

    // 7. 定时休眠
    const selectTimer = document.getElementById("selectSleepTimer");
    selectTimer.addEventListener("change", () => {
      state.sleepTimerMinutes = parseInt(selectTimer.value, 10);
      if (audioCtx && masterGain && state.isPlaying) {
        masterGain.gain.setTargetAtTime(state.masterVol, audioCtx.currentTime, 0.1);
      }
      if (state.sleepTimerMinutes > 0) {
        state.sleepTimerEnd = Date.now() + state.sleepTimerMinutes * 60 * 1000;
        updateSleepTimer();
      } else {
        if (sleepTimerTickId) {
          clearTimeout(sleepTimerTickId);
          sleepTimerTickId = null;
        }
        const display = document.getElementById("timerDisplay");
        if (display) display.textContent = "";
      }
    });

    // 8. 主音量滑块
    const rangeVol = document.getElementById("rangeMasterVol");
    const valVol = document.getElementById("valMasterVol");
    rangeVol.addEventListener("input", () => {
      state.masterVol = parseFloat(rangeVol.value);
      valVol.textContent = Math.round(state.masterVol * 100) + "%";
      if (audioCtx && masterGain) {
        masterGain.gain.setTargetAtTime(state.isPlaying ? state.masterVol : 0, audioCtx.currentTime, 0.05);
      }
    });

    // 9. 3Dio 立体声宽度
    const rangeWidth = document.getElementById("rangeStereoWidth");
    const valWidth = document.getElementById("valStereoWidth");
    rangeWidth.addEventListener("input", () => {
      state.stereoWidth = parseFloat(rangeWidth.value);
      valWidth.textContent = Math.round(state.stereoWidth * 100) + "%";
    });

    // 10. 低通滤波器截止频率 (消除尖锐毛刺)
    const rangeLp = document.getElementById("rangeLowpass");
    const valLp = document.getElementById("valLowpass");
    rangeLp.addEventListener("input", () => {
      state.userLowpass = parseInt(rangeLp.value, 10);
      valLp.textContent = state.userLowpass + " Hz";
      updateAcousticNodes();
    });

    // 11. 雨滴敲击密度
    const rangeDensity = document.getElementById("rangeDropDensity");
    const valDensity = document.getElementById("valDropDensity");
    if (rangeDensity && valDensity) {
      rangeDensity.addEventListener("input", () => {
        state.dropRateMultiplier = parseFloat(rangeDensity.value);
        valDensity.textContent = state.dropRateMultiplier.toFixed(1) + "x";
      });
    }

    // 12. 暴风雨次低频远雷音量
    const rangeThun = document.getElementById("rangeThunder");
    const valThun = document.getElementById("valThunder");
    if (rangeThun && valThun) {
      rangeThun.addEventListener("input", () => {
        state.thunderVol = parseFloat(rangeThun.value);
        valThun.textContent = Math.round(state.thunderVol * 100) + "%";
      });
    }

    // 13. 敲击速度 (BPM)
    const rangeCadence = document.getElementById("rangeTapCadence");
    const valCadence = document.getElementById("valTapCadence");
    if (rangeCadence && valCadence) {
      rangeCadence.addEventListener("input", () => {
        state.tapCadenceMultiplier = parseFloat(rangeCadence.value);
        valCadence.textContent = state.tapCadenceMultiplier.toFixed(1) + "x";
      });
    }

    // 14. 敲击指腹肉感 / 钝感
    const rangeSoftness = document.getElementById("rangeTapSoftness");
    const valSoftness = document.getElementById("valTapSoftness");
    if (rangeSoftness && valSoftness) {
      rangeSoftness.addEventListener("input", () => {
        state.tapSoftness = parseFloat(rangeSoftness.value);
        const pct = Math.round(state.tapSoftness * 100);
        valSoftness.textContent = pct > 60 ? `肉感指腹 (${pct}%)` : `轻柔甲触 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.2 摩擦往复速度
    const rangeFricSpd = document.getElementById("rangeFricSpeed");
    const valFricSpd = document.getElementById("valFricSpeed");
    if (rangeFricSpd && valFricSpd) {
      rangeFricSpd.addEventListener("input", () => {
        state.fricSpeedMultiplier = parseFloat(rangeFricSpd.value);
        valFricSpd.textContent = state.fricSpeedMultiplier.toFixed(1) + "x";
      });
    }

    // 14.3 摩擦绒感吸音缓冲
    const rangeFricCush = document.getElementById("rangeFricCushion");
    const valFricCush = document.getElementById("valFricCushion");
    if (rangeFricCush && valFricCush) {
      rangeFricCush.addEventListener("input", () => {
        state.fricCushion = parseFloat(rangeFricCush.value);
        const pct = Math.round(state.fricCushion * 100);
        valFricCush.textContent = pct > 65 ? `绒感钝响 (${pct}%)` : `细腻刷毛 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.4 水流速度与气泡频率
    const rangeWaterSpd = document.getElementById("rangeWaterSpeed");
    const valWaterSpd = document.getElementById("valWaterSpeed");
    if (rangeWaterSpd && valWaterSpd) {
      rangeWaterSpd.addEventListener("input", () => {
        state.waterSpeedMultiplier = parseFloat(rangeWaterSpd.value);
        valWaterSpd.textContent = state.waterSpeedMultiplier.toFixed(1) + "x";
      });
    }

    // 14.5 气泡微破与清润度
    const rangeWaterSoft = document.getElementById("rangeWaterSoftness");
    const valWaterSoft = document.getElementById("valWaterSoftness");
    if (rangeWaterSoft && valWaterSoft) {
      rangeWaterSoft.addEventListener("input", () => {
        state.waterSoftness = parseFloat(rangeWaterSoft.value);
        const pct = Math.round(state.waterSoftness * 100);
        valWaterSoft.textContent = pct > 60 ? `清润微钝 (${pct}%)` : `清脆水滴 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.6 颂钵余音延展时长
    const rangeBowlDec = document.getElementById("rangeBowlDecay");
    const valBowlDec = document.getElementById("valBowlDecay");
    if (rangeBowlDec && valBowlDec) {
      rangeBowlDec.addEventListener("input", () => {
        state.bowlDecayMultiplier = parseFloat(rangeBowlDec.value);
        valBowlDec.textContent = state.bowlDecayMultiplier.toFixed(1) + "x";
      });
    }

    // 14.7 颂钵金属泛音柔化
    const rangeBowlWarm = document.getElementById("rangeBowlWarmth");
    const valBowlWarm = document.getElementById("valBowlWarmth");
    if (rangeBowlWarm && valBowlWarm) {
      rangeBowlWarm.addEventListener("input", () => {
        state.bowlWarmth = parseFloat(rangeBowlWarm.value);
        const pct = Math.round(state.bowlWarmth * 100);
        valBowlWarm.textContent = pct > 70 ? `极温润 (${pct}%)` : `通透 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.8 工具动作节拍节奏
    const rangeToolP = document.getElementById("rangeToolPace");
    const valToolP = document.getElementById("valToolPace");
    if (rangeToolP && valToolP) {
      rangeToolP.addEventListener("input", () => {
        state.toolPaceMultiplier = parseFloat(rangeToolP.value);
        valToolP.textContent = state.toolPaceMultiplier.toFixed(1) + "x";
      });
    }

    // 14.9 工具触感柔化与阻尼
    const rangeToolW = document.getElementById("rangeToolWarmth");
    const valToolW = document.getElementById("valToolWarmth");
    if (rangeToolW && valToolW) {
      rangeToolW.addEventListener("input", () => {
        state.toolWarmth = parseFloat(rangeToolW.value);
        const pct = Math.round(state.toolWarmth * 100);
        valToolW.textContent = pct > 65 ? `柔和吸音 (${pct}%)` : `清透微脆 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.10 壁炉炭火微爆频率与密度
    const rangeFireR = document.getElementById("rangeFireRate");
    const valFireR = document.getElementById("valFireRate");
    if (rangeFireR && valFireR) {
      rangeFireR.addEventListener("input", () => {
        state.fireRateMultiplier = parseFloat(rangeFireR.value);
        valFireR.textContent = state.fireRateMultiplier.toFixed(1) + "x";
      });
    }

    // 14.11 壁炉火苗低频热感与木质醇厚度
    const rangeFireW = document.getElementById("rangeFireWarmth");
    const valFireW = document.getElementById("valFireWarmth");
    if (rangeFireW && valFireW) {
      rangeFireW.addEventListener("input", () => {
        state.fireWarmth = parseFloat(rangeFireW.value);
        const pct = Math.round(state.fireWarmth * 100);
        valFireW.textContent = pct > 65 ? `温厚暖意 (${pct}%)` : `松脆清透 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.12 触觉揉捏节拍与速度
    const rangeSquishC = document.getElementById("rangeSquishCadence");
    const valSquishC = document.getElementById("valSquishCadence");
    if (rangeSquishC && valSquishC) {
      rangeSquishC.addEventListener("input", () => {
        state.squishCadenceMultiplier = parseFloat(rangeSquishC.value);
        valSquishC.textContent = state.squishCadenceMultiplier.toFixed(1) + "x";
      });
    }

    // 14.13 粘稠阻尼与慢回弹肉感
    const rangeSquishV = document.getElementById("rangeSquishViscosity");
    const valSquishV = document.getElementById("valSquishViscosity");
    if (rangeSquishV && valSquishV) {
      rangeSquishV.addEventListener("input", () => {
        state.squishViscosity = parseFloat(rangeSquishV.value);
        const pct = Math.round(state.squishViscosity * 100);
        valSquishV.textContent = pct > 65 ? `软糯温润 (${pct}%)` : `细润微孔 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.14 机械键盘按键与手法选择
    document.querySelectorAll(".key-sw-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".key-sw-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentKeySwitch = btn.getAttribute("data-switch");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    document.querySelectorAll(".key-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".key-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentKeyStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 14.15 机械键盘参数调节
    const rangeKeyCadence = document.getElementById("rangeKeyCadence");
    const valKeyCadence = document.getElementById("valKeyCadence");
    if (rangeKeyCadence && valKeyCadence) {
      rangeKeyCadence.addEventListener("input", () => {
        state.keyCadenceMultiplier = parseFloat(rangeKeyCadence.value);
        valKeyCadence.textContent = state.keyCadenceMultiplier.toFixed(1) + "x";
      });
    }

    const rangeKeyThock = document.getElementById("rangeKeyThock");
    const valKeyThock = document.getElementById("valKeyThock");
    if (rangeKeyThock && valKeyThock) {
      rangeKeyThock.addEventListener("input", () => {
        state.keyThockDamping = parseFloat(rangeKeyThock.value);
        const pct = Math.round(state.keyThockDamping * 100);
        valKeyThock.textContent = pct > 65 ? `厚润醇厚 (${pct}%)` : `清脆段落 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 14.16 复古模拟与深空介质与漫游选择
    document.querySelectorAll(".amb-media-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".amb-media-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentAmbMedia = btn.getAttribute("data-media");

        updateAcousticNodes();
        generatePrompt();

      });
    });

    document.querySelectorAll(".amb-style-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".amb-style-btn").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-checked", "true");
        state.currentAmbStyle = btn.getAttribute("data-style");

        generatePrompt();

      });
    });

    // 14.17 复古模拟与深空参数调节
    const rangeAmbientDepth = document.getElementById("rangeAmbientDepth");
    const valAmbientDepth = document.getElementById("valAmbientDepth");
    if (rangeAmbientDepth && valAmbientDepth) {
      rangeAmbientDepth.addEventListener("input", () => {
        state.ambDepth = parseFloat(rangeAmbientDepth.value);
        const pct = Math.round(state.ambDepth * 100);
        valAmbientDepth.textContent = pct > 65 ? `深沉包裹 (${pct}%)` : `轻浅背景 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    const rangeAmbientGrain = document.getElementById("rangeAmbientGrain");
    const valAmbientGrain = document.getElementById("valAmbientGrain");
    if (rangeAmbientGrain && valAmbientGrain) {
      rangeAmbientGrain.addEventListener("input", () => {
        state.ambGrain = parseFloat(rangeAmbientGrain.value);
        const pct = Math.round(state.ambGrain * 100);
        valAmbientGrain.textContent = pct > 60 ? `温和微尘 (${pct}%)` : `极净纯澈 (${pct}%)`;
        updateAcousticNodes();
      });
    }

    // 15. 复制 Prompt
    setupCopyButton("btnCopyEnPrompt", "txtGeneratedEnPrompt", "已复制英文 Prompt！");
    setupCopyButton("btnCopyZhPrompt", "txtGeneratedZhPrompt", "已复制中文 Prompt！");
    setupCopyButton("btnCopyNegPrompt", "txtNegativePrompt", "已复制 Negative Prompt！");
  }

  function setupCopyButton(btnId, targetId, successText) {
    const btn = document.getElementById(btnId);
    const target = document.getElementById(targetId);
    if (!btn || !target) return;

    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(target.value);
        const originalText = btn.textContent;
        btn.textContent = "✓ " + successText;
        btn.style.borderColor = "#2dd4bf";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.borderColor = "";
        }, 1800);
      } catch (err) {
        target.select();
        document.execCommand("copy");
        btn.textContent = "已选中（可直接按 Ctrl+C）";
      }
    });
  }

  // --------------------------------------------------------------------------
  // F. 启动初始化
  // --------------------------------------------------------------------------
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resizeCanvas).observe(document.getElementById("stageViewport"));
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
  document.addEventListener("visibilitychange", syncVisualPlayback);
  reducedMotion.addEventListener("change", syncVisualPlayback);
  compactViewport.addEventListener("change", updateUIPlayState);
  resizeCanvas();
  setupEventBindings();
  setupMixer();
  generatePrompt();
  updateUIPlayState();
  syncVisualPlayback();

})();
