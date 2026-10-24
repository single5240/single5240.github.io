(function () {
  "use strict";
  const { RAIN_PRESETS, RAIN_SURFACES, TAPPING_MATERIALS, TAPPING_STYLES, FRICTION_MATERIALS, FRICTION_STYLES, WATER_SCENARIOS, WATER_STYLES, BOWLS_INSTRUMENTS, BOWLS_STYLES, TOOLS_INSTRUMENTS, TOOLS_STYLES, FIRE_INSTRUMENTS, FIRE_STYLES, SQUISH_MATERIALS, SQUISH_STYLES, KEYBOARD_SWITCHES, KEYBOARD_STYLES, AMBIENT_MEDIA, AMBIENT_STYLES } = AsmrPresets;
  function createVoice(config, scope, output, trackId, view) {
    const state = { ...config, isPlaying: false };
    const reducedMotion = view.reducedMotion;
    const isDarkThemeActive = view.isDarkThemeActive;
    const Math = Object.create(globalThis.Math);
    Math.random = AsmrRuntime.random(crypto.getRandomValues(new Uint32Array(1))[0]);
    const setTimeout = (callback, delay) => scope.setTimeout(callback,
      callback === scheduleContinuousModulation || !view.timing ? delay : view.timing(delay, scope.time()));
    const clearTimeout = scope.clearTimeout;
    const document = { get hidden() { return globalThis.document.hidden; }, getElementById() { return null; } };
    const emit = (kind, args) => {
      view.emit({ trackId, scope, at: scope.time(), kind, args });
    };
    const registerAcousticEvent = (...args) => emit("registerAcousticEvent", args);
    const createVisualEvent = (...args) => emit("createVisualEvent", args);
    const createFrictionVisualStroke = (...args) => emit("createFrictionVisualStroke", args);
    const createWaterVisualEvent = (...args) => emit("createWaterVisualEvent", args);
    const createBowlVisualEvent = (...args) => emit("createBowlVisualEvent", args);
    const createToolVisualEvent = (...args) => emit("createToolVisualEvent", args);
    const createFireVisualEvent = (...args) => emit("createFireVisualEvent", args);
    const createSquishVisualEvent = (...args) => emit("createSquishVisualEvent", args);
    const keycapVisualEvents = { push: event => emit("keycap", [event]) };
    const cosmicVisualEvents = { push: event => emit("cosmic", [event]) };
    const earWavesL = { push: event => emit("earLeft", [event]) };
    const earWavesR = { push: event => emit("earRight", [event]) };
    const audioCtx = scope.context;
    let masterGain = null;
    let masterWarmthFilter = null;

    // 雨声、水流、壁炉、深空底声节点 (双声道独立去相关 + 动态滤波与声相调制)
    let noiseSourceL = null;
    let noiseSourceR = null;
    let noiseFilterL = null;
    let noiseFilterR = null;
    let bedPeakingL = null;
    let bedPeakingR = null;
    let bedGainL = null;
    let bedGainR = null;
    let noiseGain = null;
    let mergerNode = null;

    // 定时调度器 ID 与安全子定时器池
    let rainDropTimerId = null;
    let thunderTimerId = null;
    let tapTimerId = null;
    let fricTimerId = null;
    let fricNoiseBuffer = null;
    let fricMotionPhase = 0;
    let waterBubbleTimerId = null;
    let shishiTimerId = null;
    let waterEddyAngle = 0;
    let bowlTimerId = null;
    let bowlRimPhase = 0;
    let toolTimerId = null;
    let toolCycleStep = 0;
    let toolPanSide = -0.85;
    let toolTypewriterCount = 0;
    let toolMusicBoxStep = 0;
    let fireTimerId = null;
    let fireConvectionPhase = 0;
    let fireStepPan = -0.6;
    let squishTimerId = null;
    let squishCyclePhase = 0;
    let keyTimerId = null;
    let keyStrokeCounter = 0;
    let ambTimerId = null;
    let ambDroneGain = null;
    let ambDroneOsc1 = null;
    let ambDroneOsc2 = null;
    let ambSubOsc = null;
    let ambDroneFilter = null;
    let ambDronePanner = null;
    let continuousModTimerId = null;
    let continuousModPhase = 0;
    let pendingSubTimers = [];
    let squishPanSide = -0.75;

    function scheduleSubTimer(fn, delayMs) {
      const id = scope.setTimeout(() => {
        const idx = pendingSubTimers.indexOf(id);
        if (idx !== -1) pendingSubTimers.splice(idx, 1);
        fn();
      }, delayMs, true);
      pendingSubTimers.push(id);
      return id;
    }

    function clearAllSubTimers() {
      for (let i = 0; i < pendingSubTimers.length; i++) {
        clearTimeout(pendingSubTimers[i]);
      }
      pendingSubTimers = [];
    }

    // 3Dio 仿真人头空间声相与近讲效应连接器 (支持双耳声相定位 + 近耳 Proximity 低频温润补偿)
    function connectTo3DioStage(sourceNode, azimuth, startTime) {
      if (!audioCtx || !masterWarmthFilter) return null;
      const clampedAz = Math.max(-1, Math.min(1, azimuth));
      const proximityAmount = Math.abs(clampedAz);

      // 模拟 3Dio 硅胶耳廓贴耳近讲效应 (Proximity Warmth Shelf ~165Hz)
      let stageNode = sourceNode;
      if (proximityAmount > 0.3) {
        const proxShelf = audioCtx.createBiquadFilter();
        proxShelf.type = "lowshelf";
        proxShelf.frequency.setValueAtTime(165, startTime);
        proxShelf.gain.setValueAtTime((proximityAmount - 0.3) * 3.8, startTime);
        sourceNode.connect(proxShelf);
        stageNode = proxShelf;
      }

      if (audioCtx.createStereoPanner) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.setValueAtTime(clampedAz, startTime);
        stageNode.connect(panner);
        panner.connect(masterWarmthFilter);
        return panner;
      } else {
        stageNode.connect(masterWarmthFilter);
        return null;
      }
    }

    function initAudioEngine() {
      if (masterGain) return;
      const now = scope.time();

      // 1. Master Bus 安全防线：全局柔化低通 + 软限幅压缩器，杜绝爆音与高频数码毛刺
      masterWarmthFilter = audioCtx.createBiquadFilter();
      masterWarmthFilter.type = "lowpass";
      masterWarmthFilter.frequency.setValueAtTime(state.userLowpass, now);
      masterWarmthFilter.Q.setValueAtTime(0.65, now);

      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(1, now);
      masterWarmthFilter.connect(masterGain);
      masterGain.connect(output);

      // Dry triggers have no ambient bed; construct only the nodes this voice uses.
      if (!["rain", "water", "fire", "squish", "ambient"].includes(state.activeCategory)) return;

      // 2. 双声道去相关立体声底噪缓冲区 (Paul Kellet 高精度粉红噪声)
      const bufferL = scope.noise(8, 1, Math.random);
      const bufferR = scope.noise(8, 1, Math.random);

      noiseSourceL = audioCtx.createBufferSource();
      noiseSourceL.buffer = bufferL;
      noiseSourceL.loop = true;

      noiseSourceR = audioCtx.createBufferSource();
      noiseSourceR.buffer = bufferR;
      noiseSourceR.loop = true;

      noiseFilterL = audioCtx.createBiquadFilter();
      noiseFilterL.type = "lowpass";
      noiseFilterL.frequency.setValueAtTime(state.userLowpass, now);
      noiseFilterL.Q.setValueAtTime(0.8, now);

      noiseFilterR = audioCtx.createBiquadFilter();
      noiseFilterR.type = "lowpass";
      noiseFilterR.frequency.setValueAtTime(state.userLowpass, now);
      noiseFilterR.Q.setValueAtTime(0.8, now);

      // 双耳独立共振峰塑形器 (用于水体腔体共鸣、雨面温润度与极光频散)
      bedPeakingL = audioCtx.createBiquadFilter();
      bedPeakingL.type = "peaking";
      bedPeakingL.frequency.setValueAtTime(520, now);
      bedPeakingL.Q.setValueAtTime(1.4, now);
      bedPeakingL.gain.setValueAtTime(0, now);

      bedPeakingR = audioCtx.createBiquadFilter();
      bedPeakingR.type = "peaking";
      bedPeakingR.frequency.setValueAtTime(520, now);
      bedPeakingR.Q.setValueAtTime(1.4, now);
      bedPeakingR.gain.setValueAtTime(0, now);

      bedGainL = audioCtx.createGain();
      bedGainL.gain.setValueAtTime(1.0, now);
      bedGainR = audioCtx.createGain();
      bedGainR.gain.setValueAtTime(1.0, now);

      noiseGain = audioCtx.createGain();
      const curPreset = RAIN_PRESETS[state.currentRain];
      noiseGain.gain.setValueAtTime(state.activeCategory === "rain" ? curPreset.baseVolume : 0.0001, now);

      mergerNode = audioCtx.createChannelMerger(2);

      noiseSourceL.connect(noiseFilterL);
      noiseFilterL.connect(bedPeakingL);
      bedPeakingL.connect(bedGainL);
      bedGainL.connect(mergerNode, 0, 0);

      noiseSourceR.connect(noiseFilterR);
      noiseFilterR.connect(bedPeakingR);
      bedPeakingR.connect(bedGainR);
      bedGainR.connect(mergerNode, 0, 1);

      mergerNode.connect(noiseGain);
      noiseGain.connect(masterWarmthFilter);

      noiseSourceL.start(now, Math.random() * 8);
      noiseSourceR.start(now, Math.random() * 8);

      if (state.activeCategory !== "ambient") return;

      // 3. 深空与复古模拟专属次低频谐波发生器 (Sub-Bass Harmonic Drone Bus)
      ambDroneOsc1 = audioCtx.createOscillator();
      ambDroneOsc2 = audioCtx.createOscillator();
      ambSubOsc = audioCtx.createOscillator();
      ambDroneOsc1.type = "sine";
      ambDroneOsc2.type = "triangle";
      ambSubOsc.type = "sine";

      ambDroneOsc1.frequency.setValueAtTime(55, now);
      ambDroneOsc2.frequency.setValueAtTime(82.5, now);
      ambSubOsc.frequency.setValueAtTime(27.5, now);

      const osc2SubGain = audioCtx.createGain();
      osc2SubGain.gain.setValueAtTime(0.22, now);
      const subOscGain = audioCtx.createGain();
      subOscGain.gain.setValueAtTime(0.45, now);

      ambDroneFilter = audioCtx.createBiquadFilter();
      ambDroneFilter.type = "lowpass";
      ambDroneFilter.frequency.setValueAtTime(240, now);
      ambDroneFilter.Q.setValueAtTime(1.2, now);

      ambDroneGain = audioCtx.createGain();
      ambDroneGain.gain.setValueAtTime(0.0001, now);

      ambDroneOsc1.connect(ambDroneFilter);
      ambDroneOsc2.connect(osc2SubGain);
      osc2SubGain.connect(ambDroneFilter);
      ambSubOsc.connect(subOscGain);
      subOscGain.connect(ambDroneFilter);
      ambDroneFilter.connect(ambDroneGain);

      if (audioCtx.createStereoPanner) {
        ambDronePanner = audioCtx.createStereoPanner();
        ambDronePanner.pan.setValueAtTime(0, now);
        ambDroneGain.connect(ambDronePanner);
        ambDronePanner.connect(masterWarmthFilter);
      } else {
        ambDroneGain.connect(masterWarmthFilter);
      }

      ambDroneOsc1.start();
      ambDroneOsc2.start();
      ambSubOsc.start();
    }

    // --------------------------------------------------------------------------
    // B1. 雨声触发逻辑 (7 种听雨掩体空间声学 + 多粒径随机雨珠与阵风微雨簇合成)
    // --------------------------------------------------------------------------
    function triggerBinauralRainDrop(azimuthOverride = null, dropVariant = null) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "rain") return;

      const surf = RAIN_SURFACES[state.currentSurface] || RAIN_SURFACES.tent;
      const rain = RAIN_PRESETS[state.currentRain] || RAIN_PRESETS.drizzle;
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      // 1. 决定雨珠物理粒径类型：雾滴 (micro) / 主雨珠 (normal) / 檐口或叶尖汇流大水滴 (heavy)
      let dropType = dropVariant;
      if (!dropType) {
        const r = Math.random();
        const heavyProb = (surf.heavyDripProb || 0.15) * (1 + Math.max(0, state.rainGustEnv * 0.25));
        if (r < heavyProb) {
          dropType = "heavy";
        } else if (r < heavyProb + 0.32) {
          dropType = "micro";
        } else {
          dropType = "normal";
        }
      }

      // 2. 空间方位：结合阵风风向偏置与自然随机散布
      const windBias = state.rainGustPanBias * 0.28;
      const rawAz = azimuthOverride !== null
        ? azimuthOverride
        : Math.max(-0.98, Math.min(0.98, (Math.random() * 2 - 1) * 0.92 + windBias));
      const azimuth = rawAz * state.stereoWidth;

      // 3. 单颗雨珠多维随机物理微差（杜绝机械重复感）
      const spotJitter = 0.80 + Math.random() * 0.42; // 落点位置/材质厚度随机差
      const qJitter = 0.78 + Math.random() * 0.46;    // 阻尼随机微差
      const durScale = (dropType === "micro" ? 0.65 : (dropType === "heavy" ? 1.32 : 1.0)) * (0.82 + Math.random() * 0.38);
      const velScale = dropType === "micro" ? (0.48 + Math.random() * 0.28) : (dropType === "heavy" ? (1.12 + Math.random() * 0.25) : (0.78 + Math.random() * 0.36));
      const gustVelBoost = 1 + Math.max(-0.18, state.rainGustEnv * 0.28);

      const baseVel = rain.dropVelMin + Math.random() * (rain.dropVelMax - rain.dropVelMin);
      const vel = Math.min(1.0, baseVel * velScale * gustVelBoost);
      const peakGain = vel * 0.34;
      const shelterLp = Math.min(state.userLowpass, rain.filterFreq * (surf.lpScale || 0.8) * 1.35);
      const effectiveLp = Math.max(320, shelterLp);
      const targetFreq = surf.freq * spotJitter * (dropType === "heavy" ? 0.82 : (dropType === "micro" ? 1.18 : 1.0));
      const attackTime = 0.0018 + Math.random() * 0.0026;

      const dropBus = audioCtx.createGain();
      dropBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(dropBus, azimuth, now);

      // 辅助函数：触发一段整形宽频噪声脉冲（消除纯正弦波电子音感）
      const spawnShapedNoise = (filterType, freq, q, gainAmt, atk, dur, lpClamp = effectiveLp, delaySec = 0) => {
        const t0 = now + delaySec;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;

        const flt = audioCtx.createBiquadFilter();
        flt.type = filterType;
        flt.frequency.setValueAtTime(Math.max(70, Math.min(lpClamp, freq)), t0);
        flt.Q.setValueAtTime(Math.max(0.5, q * qJitter), t0);

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.max(120, lpClamp), t0);
        lp.Q.setValueAtTime(0.7, t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0005, gainAmt), t0 + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);

        src.connect(flt);
        flt.connect(lp);
        lp.connect(g);
        g.connect(dropBus);

        const offset = Math.random() * Math.max(0.2, buf.duration - dur - 0.1);
        src.start(t0, offset);
        src.stop(t0 + atk + dur + 0.008);
      };

      // 辅助函数：触发极短促高阻尼膜面/腔体低频位移脉冲（仅作物理厚度支撑，无纯音长尾）
      const spawnDampedBodyPulse = (fStart, fEnd, gainAmt, atk, dur, lpCutoff) => {
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(fStart, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(42, fEnd), now + dur);

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.min(effectiveLp, lpCutoff), now);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(Math.max(0.0005, gainAmt), now + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(dropBus);

        osc.start(now);
        osc.stop(now + dur + 0.006);
      };

      // 4. 按 7 种听雨掩体的真实物理声学机制分别建模
      if (state.currentSurface === "tent") {
        // ⛺ 帆布帐篷：绷紧防水厚织物宽频“扑嗒”阻尼 + 帐顶膜面低频微沉（无中高音正弦波）
        const fabricDur = 0.022 * durScale;
        spawnShapedNoise("bandpass", targetFreq * 0.95, 1.35, peakGain * 0.42, attackTime, fabricDur, Math.min(effectiveLp, 860));
        spawnShapedNoise("lowpass", 240 * spotJitter, 0.9, peakGain * 0.28, attackTime * 1.1, fabricDur * 1.25, 420);
        spawnDampedBodyPulse(145 * spotJitter, 64 * spotJitter, peakGain * 0.34, attackTime, 0.026 * durScale, 290);

        // 帐脊汇流大水滴偶发二次微滑扑嗒
        if (dropType === "heavy" && Math.random() < 0.65) {
          const subDelay = 38 + Math.random() * 48;
          scheduleSubTimer(() => {
            triggerBinauralRainDrop(Math.max(-0.95, Math.min(0.95, rawAz + (Math.random() * 0.12 - 0.06))), "micro");
          }, subDelay);
        }
      } else if (state.currentSurface === "leaves") {
        // 🍃 稠密阔叶：大小不同叶片弹性啪嗒（宽频纸质/纤维瞬态）+ 叶面微水花散射 + 叶尖汇流滴落
        const leafSize = 0.68 + Math.random() * 0.72; // 模拟宽大芋叶与高处细叶差异
        const snapFreq = (380 + Math.random() * 340) * leafSize;
        const snapDur = 0.018 * durScale;
        spawnShapedNoise("bandpass", snapFreq, 1.65, peakGain * 0.38, attackTime * 0.85, snapDur, Math.min(effectiveLp, 1550));
        // 水珠在蜡质叶面上碎散的柔和微气雾声
        spawnShapedNoise("bandpass", Math.min(effectiveLp, snapFreq * 2.15), 1.4, peakGain * 0.20, attackTime, snapDur * 1.35, Math.min(effectiveLp, 2100));
        // 叶片受击微弹性低中频支撑
        spawnDampedBodyPulse(195 * leafSize, 110 * leafSize, peakGain * 0.16, attackTime, 0.016 * durScale, 380);

        // 叶尖聚水滑落砸向下方叶片或苔藓泥土
        if (dropType === "heavy" && Math.random() < 0.75) {
          const dripDelay = 55 + Math.random() * 75;
          scheduleSubTimer(() => {
            if (!state.isPlaying || state.activeCategory !== "rain") return;
            spawnShapedNoise("bandpass", 260 * spotJitter, 1.5, peakGain * 0.28, 0.0025, 0.024, 620);
          }, dripDelay);
        }
      } else if (state.currentSurface === "window") {
        // 🪟 双层隔音窗：室内静听斜雨轻叩外层玻璃的短促阻尼微粒 + 水珠贴窗汇流微滑
        const tickDur = 0.011 * durScale;
        const indoorLp = Math.min(effectiveLp, 980);
        spawnShapedNoise("bandpass", (480 + Math.random() * 280) * spotJitter, 2.7, peakGain * 0.28, attackTime * 0.8, tickDur, indoorLp);
        spawnShapedNoise("lowpass", 220 * spotJitter, 1.2, peakGain * 0.22, attackTime, tickDur * 1.4, 380);
        spawnDampedBodyPulse(210 * spotJitter, 135 * spotJitter, peakGain * 0.16, attackTime, 0.014 * durScale, 320);

        // 斜雨在玻璃上汇合成水痕向下微滑的二次细腻微触
        if (dropType === "heavy" && Math.random() < 0.7) {
          spawnShapedNoise("bandpass", 390 * spotJitter, 2.4, peakGain * 0.15, 0.003, 0.016, 720, 0.028 + Math.random() * 0.025);
        }
      } else if (state.currentSurface === "cedar") {
        // 🪵 桧木屋檐：厚实老木瓦非谐钝响（双木质共振带）+ 屋檐廊下错落汇流大滴水
        const woodDur = 0.024 * durScale;
        spawnShapedNoise("bandpass", (270 + Math.random() * 160) * spotJitter, 1.9, peakGain * 0.40, attackTime, woodDur, Math.min(effectiveLp, 920));
        spawnShapedNoise("bandpass", (540 + Math.random() * 240) * spotJitter, 2.2, peakGain * 0.18, attackTime * 0.9, woodDur * 0.65, Math.min(effectiveLp, 1200));
        spawnDampedBodyPulse(215 * spotJitter, 138 * spotJitter, peakGain * 0.26, attackTime, 0.022 * durScale, 390);

        // 桧木屋檐边缘汇流滴水落入木廊/石阶
        if (dropType === "heavy") {
          const eaveDelay = 0.045 + Math.random() * 0.055;
          spawnShapedNoise("bandpass", 320 * spotJitter, 2.1, peakGain * 0.30, 0.0022, 0.022, 780, eaveDelay);
        }
      } else if (state.currentSurface === "metal_awning") {
        // 🛖 复古锌铁皮雨棚：柔化薄板冲击噪声 + 极短促非谐双模态空腔（消除木琴纯音感）
        const awningDur = 0.019 * durScale;
        const awningLp = Math.min(effectiveLp, 1080);
        spawnShapedNoise("bandpass", (440 + Math.random() * 260) * spotJitter, 2.3, peakGain * 0.35, attackTime * 0.85, awningDur, awningLp);
        spawnShapedNoise("bandpass", (250 + Math.random() * 110) * spotJitter, 1.8, peakGain * 0.26, attackTime, awningDur * 1.35, 560);

        // 阻尼薄板非谐微振（频率比随机非整数 1.34~1.53，极快衰减 18ms）
        const f0 = (290 + Math.random() * 110) * spotJitter;
        const inharmRatio = 1.34 + Math.random() * 0.19;
        spawnDampedBodyPulse(f0 * 1.06, f0 * 0.92, peakGain * 0.16, attackTime, 0.018 * durScale, 520);
        spawnDampedBodyPulse(f0 * inharmRatio, f0 * inharmRatio * 0.9, peakGain * 0.09, attackTime, 0.013 * durScale, 760);
      } else if (state.currentSurface === "car_roof") {
        // 🚗 静谧车顶车厢：76% 车顶内饰隔音层沉闷“咚扑”低频微震 + 24% 前挡风夹胶玻璃微雨点
        const isWindshield = Math.random() < 0.24;
        if (!isWindshield) {
          const roofDur = 0.028 * durScale;
          spawnShapedNoise("lowpass", (210 + Math.random() * 120) * spotJitter, 1.15, peakGain * 0.38, attackTime * 1.1, roofDur, 420);
          spawnShapedNoise("bandpass", (310 + Math.random() * 110) * spotJitter, 1.5, peakGain * 0.24, attackTime, roofDur * 0.8, 520);
          spawnDampedBodyPulse((115 + Math.random() * 45) * spotJitter, 56 * spotJitter, peakGain * 0.42, attackTime, 0.032 * durScale, 250);
        } else {
          const wsDur = 0.013 * durScale;
          spawnShapedNoise("bandpass", (420 + Math.random() * 220) * spotJitter, 2.2, peakGain * 0.26, attackTime * 0.85, wsDur, 780);
          spawnDampedBodyPulse(185 * spotJitter, 115 * spotJitter, peakGain * 0.18, attackTime, 0.016 * durScale, 310);
        }
      } else if (state.currentSurface === "glass_sunroom") {
        // 🪴 玻璃阳光房顶：头顶夹胶玻璃穹顶细密温润微叩 + 阳光房内部柔和漫反射尾韵
        const glassDur = 0.012 * durScale;
        const domeLp = Math.min(effectiveLp, 1280);
        spawnShapedNoise("bandpass", (580 + Math.random() * 340) * spotJitter, 2.3, peakGain * 0.32, attackTime * 0.75, glassDur, domeLp);
        spawnShapedNoise("bandpass", (270 + Math.random() * 110) * spotJitter, 1.6, peakGain * 0.22, attackTime, glassDur * 1.45, 540);
        // 阳光房穹顶微弱空间漫反射气感
        if (dropType !== "micro") {
          spawnShapedNoise("bandpass", 460 * spotJitter, 1.2, peakGain * 0.08, 0.004, 0.032 * durScale, 820, 0.008);
        }
      }

      createVisualEvent(azimuth, vel, "rain");
    }

    function scheduleNextRainDrop() {
      if (!state.isPlaying || state.activeCategory !== "rain") return;

      const rain = RAIN_PRESETS[state.currentRain] || RAIN_PRESETS.drizzle;
      const surf = RAIN_SURFACES[state.currentSurface] || RAIN_SURFACES.tent;

      // 1. 慢速随机游走 (Random Walk) 调节疏密呼吸感，彻底打破匀速机械感
      state.rainDensityWalk += (Math.random() - 0.495) * 0.09;
      if (Math.random() < 0.05) {
        // 偶发自然微间歇或阵雨小高潮
        state.rainDensityWalk += (Math.random() < 0.45 ? -0.18 : 0.22);
      }
      state.rainDensityWalk = Math.max(0.62, Math.min(1.42, state.rainDensityWalk));

      const gustMod = 1 + Math.max(-0.32, state.rainGustEnv * 0.45);
      const avgRate = Math.max(2.5, rain.dropRate * state.dropRateMultiplier * (surf.dropRateScale || 1.0) * state.rainDensityWalk * gustMod);

      // 2. 泊松指数分布采样 + 自然微阵雨簇 (Micro-Cluster)
      let rawInterval = (-Math.log(1 - Math.random()) / avgRate) * 1000;

      // 偶发短暂微停顿（模拟风向转换时的瞬间呼吸留白）
      if (Math.random() < 0.065) {
        rawInterval *= (1.35 + Math.random() * 0.65);
      }

      const baseAz = Math.max(-0.95, Math.min(0.95, (Math.random() * 2 - 1) * 0.9 + state.rainGustPanBias * 0.3));
      triggerBinauralRainDrop(baseAz);

      // 3. 阵风扫过掩体时的连珠微雨簇（2~3 颗雨珠在局部空间扇区错落落下）
      const clusterChance = (surf.clusterProb || 0.28) * (0.85 + Math.max(0, state.rainGustEnv * 0.55));
      if (Math.random() < clusterChance) {
        const extraDrops = Math.random() < 0.32 ? 2 : 1;
        for (let i = 0; i < extraDrops; i++) {
          const subDelay = 14 + Math.random() * 58 + i * (18 + Math.random() * 32);
          const clusterAz = Math.max(-0.98, Math.min(0.98, baseAz + (Math.random() * 0.32 - 0.16)));
          const variant = Math.random() < 0.55 ? "micro" : "normal";
          scheduleSubTimer(() => {
            triggerBinauralRainDrop(clusterAz, variant);
          }, subDelay);
        }
      } else if (rawInterval < 14) {
        // 高密度雨量下将极短间隔转化为错落子脉冲，避免主定时器卡在固定 8ms 网格形成机械音高
        const subOffset = 4 + Math.random() * 9;
        scheduleSubTimer(() => {
          triggerBinauralRainDrop(null, Math.random() < 0.5 ? "micro" : "normal");
        }, subOffset);
        rawInterval += 10 + Math.random() * 12;
      }

      rainDropTimerId = setTimeout(scheduleNextRainDrop, Math.max(12, rawInterval));
    }

    function scheduleNextThunder() {
      if (!state.isPlaying || state.activeCategory !== "rain" || !RAIN_PRESETS[state.currentRain].thunder) return;

      const now = scope.time();
      const isDistant = Math.random() < 0.45; // 随机远近层次：天际远雷 vs 云层低沉滚雷
      const dur = (isDistant ? 6.0 : 4.6) + Math.random() * 4.2;
      const attack1 = 0.8 + Math.random() * 1.1;
      const swell2 = attack1 + 1.2 + Math.random() * 1.5;

      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 2.4;
      }

      const thunderSource = audioCtx.createBufferSource();
      thunderSource.buffer = noiseBuffer;
      thunderSource.loop = true;

      // 多峰不规则滚动闷雷滤波包络 (36Hz ~ 86Hz 温暖远雷滚过天际，无突兀炸响)
      const peakFreq1 = (isDistant ? 62 : 82) + Math.random() * 12;
      const dipFreq = 42 + Math.random() * 12;
      const peakFreq2 = (isDistant ? 56 : 72) + Math.random() * 14;

      const subFilter = audioCtx.createBiquadFilter();
      subFilter.type = "lowpass";
      subFilter.frequency.setValueAtTime(42, now);
      subFilter.frequency.linearRampToValueAtTime(peakFreq1, now + attack1);
      subFilter.frequency.linearRampToValueAtTime(dipFreq, now + (attack1 + swell2) * 0.5);
      subFilter.frequency.linearRampToValueAtTime(peakFreq2, now + swell2);
      subFilter.frequency.exponentialRampToValueAtTime(34, now + dur);
      subFilter.Q.setValueAtTime(1.15 + Math.random() * 0.45, now);

      const thunderGain = audioCtx.createGain();
      const distanceScale = isDistant ? (0.62 + Math.random() * 0.2) : (0.85 + Math.random() * 0.2);
      const maxGain = 0.25 * state.thunderVol * distanceScale;
      thunderGain.gain.setValueAtTime(0.0001, now);
      thunderGain.gain.linearRampToValueAtTime(maxGain * (0.65 + Math.random() * 0.25), now + attack1);
      thunderGain.gain.linearRampToValueAtTime(maxGain * (0.30 + Math.random() * 0.20), now + (attack1 + swell2) * 0.5);
      thunderGain.gain.linearRampToValueAtTime(maxGain, now + swell2);
      thunderGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      thunderSource.connect(subFilter);
      subFilter.connect(thunderGain);

      const startPan = ((Math.random() > 0.5 ? 1 : -1) * (0.45 + Math.random() * 0.45)) * state.stereoWidth;
      const endPan = -startPan * (0.35 + Math.random() * 0.5);
      const panner = connectTo3DioStage(thunderGain, startPan, now);
      if (panner) {
        panner.pan.linearRampToValueAtTime(endPan, now + dur);
      }

      thunderSource.start(now);
      thunderSource.stop(now + dur + 0.1);

      const nextInterval = 9500 + Math.random() * 16500;
      thunderTimerId = setTimeout(scheduleNextThunder, nextInterval);
    }

    // --------------------------------------------------------------------------
    // B2. 敲击声物理声学合成核心 (8种异构材质拓扑 + 真人五指/落点随机微差 + 抬指微粘滞)
    // --------------------------------------------------------------------------
    function triggerSingleTap(azimuthOverride = null, velScale = 1.0, fingerProfile = null) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "tapping") return;

      const mat = TAPPING_MATERIALS[state.currentTapMat] || TAPPING_MATERIALS.woodbox;
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      // 1. 模拟真人五指特征 (拇指肉厚偏沉 / 食中指均衡 / 无名与小指轻巧偏边缘) 与随机敲击落点
      const fingerPitch = fingerProfile && fingerProfile.pitch ? fingerProfile.pitch : (0.91 + Math.random() * 0.18);
      const fingerFlesh = fingerProfile && fingerProfile.flesh ? fingerProfile.flesh : (0.82 + Math.random() * 0.36);
      const hitEdgeFactor = Math.random(); // 0 = 靠近物体中心空腔饱满处，1 = 靠近边缘紧实处

      // 2. 3Dio 空间声相计算
      let rawAz = 0;
      if (azimuthOverride !== null) {
        rawAz = Math.max(-0.98, Math.min(0.98, azimuthOverride));
      } else {
        rawAz = (Math.random() > 0.5 ? 0.65 : -0.65) * (0.78 + Math.random() * 0.32);
      }
      const azimuth = rawAz * state.stereoWidth;

      const spotJitter = (0.92 + hitEdgeFactor * 0.16) * fingerPitch;
      const baseFreq = mat.baseFreq * spotJitter;
      const cavityFreq = (mat.cavityFreq || mat.baseFreq * 0.6) * (0.94 + Math.random() * 0.12);
      const vel = Math.min(1.0, (0.62 + Math.random() * 0.30) * velScale);
      const effectiveCutoff = Math.min(state.userLowpass, 1100 + (1 - state.tapSoftness) * 1250);
      const attackTime = (0.0022 + state.tapSoftness * 0.0028) * (0.85 + Math.random() * 0.3);
      const decayScale = 0.84 + Math.random() * 0.34;
      const peak = vel * 0.36;

      const tapBus = audioCtx.createGain();
      tapBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(tapBus, azimuth, now);

      // 辅助函数 1：整形材质纹理与甲腹接触噪声包络
      const spawnTapNoise = (filterType, freq, q, gainAmt, atk, dur, lpClamp = effectiveCutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;

        const flt = audioCtx.createBiquadFilter();
        flt.type = filterType;
        flt.frequency.setValueAtTime(Math.max(65, Math.min(lpClamp, freq)), t0);
        flt.Q.setValueAtTime(Math.max(0.5, q * (0.82 + Math.random() * 0.36)), t0);

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.max(110, lpClamp), t0);
        lp.Q.setValueAtTime(0.7, t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0005, gainAmt), t0 + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);

        src.connect(flt);
        flt.connect(lp);
        lp.connect(g);
        g.connect(tapBus);

        const offset = Math.random() * Math.max(0.2, buf.duration - dur - 0.1);
        src.start(t0, offset);
        src.stop(t0 + atk + dur + 0.008);
      };

      // 辅助函数 2：受控物理阻尼模态脉冲（带微顺应性瞬态降频与独立低通抑制）
      const spawnTapModal = (fStart, fEnd, gainAmt, atk, dur, lpClamp = effectiveCutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(Math.max(38, fStart), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(36, fEnd), t0 + Math.min(dur, 0.018));

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.max(100, lpClamp), t0);
        lp.Q.setValueAtTime(0.85, t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0004, gainAmt), t0 + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(tapBus);

        osc.start(t0);
        osc.stop(t0 + atk + dur + 0.008);
      };

      // 3. 通用底层：3Dio 近讲指腹肉垫空气位移 (Proximity Flesh Pad Cushion)
      const fleshStart = (102 + (1 - state.tapSoftness) * 32) * (0.92 + Math.random() * 0.16);
      const fleshPeak = (0.14 + state.tapSoftness * 0.16 + (mat.warmthBoost || 0.28) * 0.20) * vel * fingerFlesh;
      spawnTapModal(fleshStart, 44 + Math.random() * 8, fleshPeak, 0.0026, 0.024 * decayScale, 240);

      // 指尖/指甲轻触表面的微纹理瞬态（随指腹软化度动态收拢）
      const nailSharpness = 1 - state.tapSoftness * 0.72;

      // 4. 八种材质独立物理声学结构合成
      if (state.currentTapMat === "woodbox") {
        // 🪵 天然空心木盒：赫姆霍兹箱体空气腔 (~215Hz) + 顶板双非谐木纹模态 + 干燥木面微瞬态
        const centerWeight = 1.15 - hitEdgeFactor * 0.45; // 敲盒心时箱体低音更饱满，敲盒沿时木板更清脆
        const edgeWeight = 0.80 + hitEdgeFactor * 0.45;
        const woodDur = mat.decay * decayScale;

        // 木纹宽频接触瞬态
        spawnTapNoise("bandpass", (420 + (1 - state.tapSoftness) * 380) * spotJitter, 1.9, peak * 0.34 * nailSharpness, 0.0018, 0.014, effectiveCutoff);
        spawnTapNoise("bandpass", 260 * spotJitter, 1.4, peak * 0.24, attackTime, 0.022, 580);

        // 赫姆霍兹空气腔基频 + 顶板主模态 + 横向木纹非谐泛音
        spawnTapModal(cavityFreq * 1.08, cavityFreq, peak * 0.44 * centerWeight, attackTime * 1.1, woodDur * 1.15, 460);
        spawnTapModal(baseFreq * 1.12, baseFreq, peak * 0.56 * edgeWeight, attackTime, woodDur, effectiveCutoff);
        const inharm2 = mat.harmonicMult * (0.96 + Math.random() * 0.08);
        spawnTapModal(baseFreq * inharm2 * 1.04, baseFreq * inharm2, peak * 0.16 * edgeWeight * nailSharpness, 0.002, woodDur * 0.42, effectiveCutoff);
      } else if (state.currentTapMat === "book") {
        // 📖 复古精装书皮：过阻尼亚麻布纹微擦 + 厚实书芯纸叠沉闷“噗嗒”声（无空腔延音）
        const bookDur = mat.decay * decayScale;
        // 亚麻布纹封面微沙接触声
        spawnTapNoise("bandpass", (480 + (1 - state.tapSoftness) * 340) * spotJitter, 1.25, peak * 0.38, 0.002, 0.017 * decayScale, Math.min(effectiveCutoff, 1150));
        // 厚书芯层压纸叠宽带阻尼沉音
        spawnTapNoise("lowpass", 250 * spotJitter, 0.95, peak * 0.42, attackTime, bookDur * 1.1, 440);
        // 极短促纸叠受压低中频脉冲（绝不产生电子木鱼音高）
        spawnTapModal(cavityFreq * 1.18, cavityFreq * 0.82, peak * 0.46, attackTime, 0.022 * decayScale, 320);
        spawnTapModal(baseFreq * 1.10, baseFreq * 0.88, peak * 0.24 * nailSharpness, attackTime, 0.015 * decayScale, 480);

        // 抬指时指腹离开亚麻织物封面的细微摩挲尾韵
        if (state.tapSoftness > 0.35 && Math.random() < 0.65) {
          spawnTapNoise("bandpass", 520 * spotJitter, 1.3, peak * 0.09, 0.004, 0.022, 820, 0.024 + Math.random() * 0.015);
        }
      } else if (state.currentTapMat === "silicone") {
        // 🫧 软硅胶吸音块：深沉粘弹性形变低频钝响 + 抬指时指腹与硅胶表面微粘滞吸附回弹
        const silDur = mat.decay * decayScale;
        const silLp = Math.min(effectiveCutoff, 520);
        spawnTapNoise("lowpass", 195 * spotJitter, 1.05, peak * 0.40, attackTime * 1.15, silDur, 360);
        spawnTapNoise("bandpass", 290 * spotJitter, 1.5, peak * 0.22 * nailSharpness, 0.0022, 0.015, silLp);

        // 粘弹性软胶受压下陷低频（快速衰减，无长正弦尾音）
        spawnTapModal(baseFreq * 1.22, cavityFreq * 0.85, peak * 0.58, attackTime * 1.1, 0.028 * decayScale, 280);

        // 硅胶特有：指腹抬起瞬间微粘滞吸附释放声 (Micro-Tacky Detachment)
        if (Math.random() < 0.78) {
          const releaseDelay = 0.024 + Math.random() * 0.020;
          spawnTapNoise("bandpass", (280 + Math.random() * 130) * spotJitter, 1.8, peak * 0.14 * fingerFlesh, 0.002, 0.013, 520, releaseDelay);
          spawnTapModal(155 * spotJitter, 95 * spotJitter, peak * 0.11, 0.002, 0.012, 260, releaseDelay);
        }
      } else if (state.currentTapMat === "ceramic") {
        // ☕ 厚陶马克杯：厚釉粗陶壁短促圆润叩击 + 杯内空气柱微共鸣（随敲击高低位置变化）
        const cerDur = mat.decay * decayScale;
        const rimFactor = 0.75 + hitEdgeFactor * 0.5;
        // 釉面指尖短促清润瞬态
        spawnTapNoise("bandpass", (680 + (1 - state.tapSoftness) * 480) * spotJitter, 2.5, peak * 0.34 * nailSharpness, 0.0016, 0.010, effectiveCutoff);
        // 杯壁厚重陶体主频与极快衰减二阶非谐模态
        spawnTapModal(baseFreq * 1.06, baseFreq, peak * 0.50, attackTime * 0.85, cerDur, effectiveCutoff);
        spawnTapModal(baseFreq * mat.harmonicMult, baseFreq * mat.harmonicMult * 0.96, peak * 0.15 * nailSharpness, 0.0018, cerDur * 0.34, effectiveCutoff);
        // 马克杯内腔空气柱温润低中频支撑 (310~350Hz)
        spawnTapModal(cavityFreq * 1.04, cavityFreq, peak * 0.28 * (1.3 - rimFactor * 0.4), attackTime, cerDur * 1.15, 520);
      } else if (state.currentTapMat === "bamboo") {
        // 🎍 天然竹节：干燥竹青皮层纤维脆韧瞬态 + 中空竹筒非谐柱腔与竹隔膜共振
        const bamDur = mat.decay * decayScale;
        // 竹青纤维宽带脆韧敲击声
        spawnTapNoise("bandpass", (580 + (1 - state.tapSoftness) * 420) * spotJitter, 2.2, peak * 0.38, 0.0016, 0.013, effectiveCutoff);
        spawnTapNoise("bandpass", 340 * spotJitter, 1.6, peak * 0.22, attackTime, 0.018, 680);
        // 竹筒柱腔主模态 + 竹节横隔膜耦合次模态
        spawnTapModal(baseFreq * 1.09, baseFreq, peak * 0.54, attackTime * 0.9, bamDur, effectiveCutoff);
        const cylRatio = mat.harmonicMult * (0.95 + Math.random() * 0.10);
        spawnTapModal(baseFreq * cylRatio, baseFreq * cylRatio * 0.95, peak * 0.22 * nailSharpness, 0.0018, bamDur * 0.45, effectiveCutoff);
        spawnTapModal(cavityFreq * 1.08, cavityFreq, peak * 0.26, attackTime, bamDur * 0.75, 460);
      } else if (state.currentTapMat === "slate_stone") {
        // 🪨 天然青石板：无空腔实心致密矿物石板（深沉石基惯性沉音 + 极短促微凉矿物石触，与竹节彻底区分）
        const stoneDur = mat.decay * decayScale; // ~18ms 极短阻尼
        // 实心青石板微凉致密表面接触瞬态
        spawnTapNoise("bandpass", (740 + (1 - state.tapSoftness) * 520) * spotJitter, 2.1, peak * 0.36 * nailSharpness, 0.0014, 0.009, effectiveCutoff);
        spawnTapNoise("bandpass", 390 * spotJitter, 1.5, peak * 0.34, 0.0018, 0.015, 760);
        // 厚重石板质量惯性低频沉音 + 极短促实心板体脉冲（绝无空腔长尾）
        spawnTapModal(cavityFreq * 1.18, cavityFreq * 0.84, peak * 0.48, 0.0022, 0.022 * decayScale, 280);
        spawnTapModal(baseFreq * 1.05, baseFreq * 0.94, peak * 0.32, 0.0018, stoneDur, 680);
      } else if (state.currentTapMat === "amber_resin") {
        // 🟤 温润琥珀树脂：实心天然松脂块温润微粘指触 + 柔和聚合物短促回弹
        const ambDur = mat.decay * decayScale;
        spawnTapNoise("bandpass", (380 + (1 - state.tapSoftness) * 320) * spotJitter, 1.65, peak * 0.36, 0.002, 0.016, Math.min(effectiveCutoff, 1050));
        spawnTapModal(baseFreq * 1.14, baseFreq * 0.95, peak * 0.52, attackTime, ambDur, Math.min(effectiveCutoff, 860));
        spawnTapModal(cavityFreq * 1.12, cavityFreq * 0.90, peak * 0.34, attackTime, ambDur * 0.9, 360);
        spawnTapModal(baseFreq * mat.harmonicMult, baseFreq * mat.harmonicMult * 0.92, peak * 0.14 * nailSharpness, 0.002, ambDur * 0.38, effectiveCutoff);

        // 松脂块表面温润微粘指腹释放感
        if (state.tapSoftness > 0.4 && Math.random() < 0.55) {
          spawnTapNoise("bandpass", 410 * spotJitter, 1.7, peak * 0.10, 0.0025, 0.012, 680, 0.020 + Math.random() * 0.014);
        }
      } else if (state.currentTapMat === "walnut_shell") {
        // 🌰 干燥胡桃坚果壳：薄壁高曲率干果壳微型空腔轻叩 + 偶发掌中两半果壳微碰二次酥脆轻响
        const shellDur = mat.decay * decayScale;
        spawnTapNoise("bandpass", (660 + (1 - state.tapSoftness) * 480) * spotJitter, 2.4, peak * 0.40, 0.0014, 0.011, effectiveCutoff);
        spawnTapModal(baseFreq * 1.08, baseFreq, peak * 0.48, 0.0018, shellDur, effectiveCutoff);
        spawnTapModal(cavityFreq * 1.06, cavityFreq, peak * 0.26, 0.002, shellDur * 0.85, 620);
        spawnTapModal(baseFreq * mat.harmonicMult, baseFreq * mat.harmonicMult * 0.95, peak * 0.16 * nailSharpness, 0.0015, shellDur * 0.36, effectiveCutoff);

        // 掌中两颗胡桃壳受敲击微晃相碰的二次酥脆微响
        if ((!fingerProfile || !fingerProfile.isSecondary) && Math.random() < 0.28) {
          const kissDelay = 24 + Math.random() * 34;
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tapping") {
              triggerSingleTap(rawAz + (Math.random() * 0.08 - 0.04), velScale * (0.36 + Math.random() * 0.16), {
                pitch: 1.08 + Math.random() * 0.12,
                flesh: 0.65,
                isSecondary: true
              });
            }
          }, kissDelay);
        }
      }

      createVisualEvent(azimuth, vel, "tap");
    }

    // 调度敲击声节奏步进 (Styles: slow / flutter / orbit / metronome - 真人五指微律动与有机短语)
    function scheduleNextTap() {
      if (!state.isPlaying || state.activeCategory !== "tapping") return;

      const style = TAPPING_STYLES[state.currentTapStyle] || TAPPING_STYLES.slow;
      let nextDelay = (style.baseInterval / state.tapCadenceMultiplier);

      // 真人五指物理特征模板（从拇指到小指：音高递升、肉感递减）
      const FINGER_PROFILES = [
        { name: "thumb",  pitch: 0.90, flesh: 1.22, vel: 1.04 },
        { name: "index",  pitch: 0.97, flesh: 1.05, vel: 1.00 },
        { name: "middle", pitch: 1.00, flesh: 1.00, vel: 1.05 },
        { name: "ring",   pitch: 1.05, flesh: 0.90, vel: 0.90 },
        { name: "pinky",  pitch: 1.12, flesh: 0.78, vel: 0.78 }
      ];

      if (style.orbit) {
        // ↔️ 3Dio 双耳平滑穿梭轨道：连续余弦相位游走 + 贴耳处自然驻留与轻巧双点
        state.orbitPhase += 0.24 + Math.random() * 0.10;
        const rawSin = Math.sin(state.orbitPhase);
        // 在左右贴耳端（±0.88）稍微驻留更久，强化 3Dio 近讲温润包裹感
        const shapedAz = Math.sign(rawSin) * Math.pow(Math.abs(rawSin), 0.78) * 0.88;
        const az = Math.max(-0.95, Math.min(0.95, shapedAz + (Math.random() * 0.08 - 0.04)));
        const fProf = FINGER_PROFILES[Math.floor(Math.random() * 4)];

        triggerSingleTap(az, fProf.vel * (0.90 + Math.random() * 0.16), fProf);

        // 32% 概率在当前方位追加一次食指/中指轻巧跟点 (da-dum)
        if (Math.random() < 0.32) {
          const graceDelay = (115 + Math.random() * 65) / state.tapCadenceMultiplier;
          const followFinger = FINGER_PROFILES[(Math.floor(Math.random() * 3) + 1)];
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tapping") {
              triggerSingleTap(az + (Math.random() * 0.06 - 0.03), followFinger.vel * 0.76, followFinger);
            }
          }, graceDelay);
          nextDelay *= (1.05 + Math.random() * 0.25);
        } else {
          nextDelay *= (0.82 + Math.random() * 0.34);
        }
      } else if (style.flutter) {
        // 🐾 指尖微颤轮敲：3~5 指变速波浪轮指 (Human Rubato Cascade)，告别机械等距 4 连发
        const fingerCount = 3 + Math.floor(Math.random() * 3); // 随机 3、4 或 5 指轮敲
        const isReverseRoll = Math.random() < 0.55; // ASMR 经典小指->食指波浪轮指 vs 食指->小指
        if (Math.random() < 0.38) {
          state.tapHandSide = -state.tapHandSide; // 随机换手或保持同侧连续轮指
        }
        const baseAz = state.tapHandSide * (0.78 + Math.random() * 0.22);

        let cumulativeDelay = 0;
        for (let i = 0; i < fingerCount; i++) {
          const fingerIdx = isReverseRoll
            ? Math.max(0, 4 - i)
            : Math.min(4, 1 + i);
          const fProf = FINGER_PROFILES[fingerIdx];
          const stepDelay = cumulativeDelay;

          // 轮指弧线：首指轻起 -> 中段微加速且饱满 -> 尾指自然渐弱收尾
          const archVel = (i === 0 ? 0.78 : (i === fingerCount - 1 ? 0.84 : 0.98)) * fProf.vel * (0.90 + Math.random() * 0.16);
          const stepAz = Math.max(-0.96, Math.min(0.96, baseAz + (i - (fingerCount - 1) / 2) * 0.05 + (Math.random() * 0.06 - 0.03)));

          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tapping") {
              triggerSingleTap(stepAz, archVel, fProf);
            }
          }, stepDelay);

          // 非均匀手指间隔 (Rubato: 中间手指更紧凑 68~95ms，首尾手指略舒展 88~125ms)
          const baseStepMs = (i === 1 || i === 2) ? (68 + Math.random() * 28) : (88 + Math.random() * 38);
          cumulativeDelay += baseStepMs / state.tapCadenceMultiplier;
        }

        // 偶发双手交替长波浪轮敲（左耳一轮后右耳轻轻回应半轮）
        const extraPause = Math.random() < 0.22 ? (1.22 + Math.random() * 0.35) : (0.78 + Math.random() * 0.38);
        nextDelay = (style.baseInterval / state.tapCadenceMultiplier) * extraPause;
      } else if (state.currentTapStyle === "slow") {
        // 🧘 舒缓单指点敲：单侧驻留 2~4 拍后自然换手 + 偶发食中指轻重双连点与呼吸留白
        state.tapHandPhraseRemaining -= 1;
        if (state.tapHandPhraseRemaining <= 0) {
          state.tapHandSide = -state.tapHandSide;
          state.tapHandPhraseRemaining = 2 + Math.floor(Math.random() * 3); // 在同一侧耳畔温和驻留 2~4 次敲击
        }

        const az = Math.max(-0.95, Math.min(0.95, state.tapHandSide * (0.75 + Math.random() * 0.22) + (Math.random() * 0.16 - 0.08)));
        const primaryFinger = FINGER_PROFILES[1 + Math.floor(Math.random() * 3)]; // 食指/中指/无名指

        // 26% 概率触发真人 ASMR 标志性的“轻-重”双指连点 (Grace Double-Tap)
        if (Math.random() < 0.26) {
          const leadFinger = FINGER_PROFILES[3]; // 无名指先轻触
          triggerSingleTap(az, 0.72 + Math.random() * 0.12, leadFinger);
          const doubleGap = (105 + Math.random() * 65) / state.tapCadenceMultiplier;
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tapping") {
              triggerSingleTap(az + (Math.random() * 0.06 - 0.03), 0.98 + Math.random() * 0.10, FINGER_PROFILES[2]);
            }
          }, doubleGap);
          nextDelay *= (1.12 + Math.random() * 0.38);
        } else {
          triggerSingleTap(az, primaryFinger.vel * (0.86 + Math.random() * 0.22), primaryFinger);
          // 偶发深呼吸式的自然停顿留白
          const phraseBreath = state.tapHandPhraseRemaining === 1 ? (1.18 + Math.random() * 0.35) : (0.76 + Math.random() * 0.42);
          nextDelay *= phraseBreath;
        }
      } else {
        // ⏱️ 催眠规律节拍 (Hypnotic Metronome)：保持稳定助眠脉搏，但融入强弱呼吸拍与手腕微时差人性化
        state.tapBeatCounter = (state.tapBeatCounter + 1) % 4;
        // 每两拍或四拍温和交替左右手，避免每拍生硬跳动
        if (state.tapBeatCounter % 2 === 0) {
          state.tapHandSide = -state.tapHandSide;
        }
        const az = state.tapHandSide * (0.62 + Math.sin(state.tapBeatCounter * 0.8) * 0.12);
        // 四拍呼吸力度包络：主拍温厚 -> 次拍轻柔 -> 次强拍 -> 尾拍极柔
        const beatAccents = [1.02, 0.78, 0.92, 0.74];
        const beatFingers = [FINGER_PROFILES[2], FINGER_PROFILES[3], FINGER_PROFILES[1], FINGER_PROFILES[3]];
        const accentVel = beatAccents[state.tapBeatCounter] * (0.94 + Math.random() * 0.12);

        triggerSingleTap(az, accentVel, beatFingers[state.tapBeatCounter]);
        // ±3.5% 手腕微时差人性化，既保持 60 BPM 催眠规律感又消除电子节拍器死板感
        nextDelay *= (0.965 + Math.random() * 0.07);
      }

      tapTimerId = setTimeout(scheduleNextTap, Math.max(55, nextDelay));
    }

    // --------------------------------------------------------------------------
    // B3. 摩擦声物理声学合成核心 (软触剪切 + 耳廓近讲微风 + 纤维纹理微调制)
    // --------------------------------------------------------------------------
    function getFrictionNoiseBuffer() {
      if (!audioCtx) return null;
      if (fricNoiseBuffer) return fricNoiseBuffer;
      fricNoiseBuffer = scope.noise(4, 2, Math.random, 0.09);
      return fricNoiseBuffer;
    }

    function triggerFrictionStroke(panStart, panEnd, duration, velScale = 1.0, strokeMeta = null) {
      if (!audioCtx || (!state.isPlaying && velScale < 0.94) || state.activeCategory !== "friction") return;

      const mat = FRICTION_MATERIALS[state.currentFricMat] || FRICTION_MATERIALS.brush;
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      const now = scope.time();
      // 持续时间微随机扰动（若外部未传入定制时长，亦具备自然微伸缩）
      const durJitter = strokeMeta && strokeMeta.exactDur ? 1.0 : (0.92 + Math.random() * 0.16);
      const dur = Math.max(0.15, duration * durJitter);

      // 方向与正反行程特征：模拟顺毛推抚 (push) 与逆毛回拉 (pull) 的物理音色/阻力差异
      const isReturn = strokeMeta && strokeMeta.isReturn !== undefined
        ? strokeMeta.isReturn
        : (panEnd < panStart);
      const napAsym = mat.napAsymmetry || 0.14;
      const napToneShift = isReturn ? (1 - napAsym * 0.65) : (1 + napAsym * 0.45);
      const napVelShift = isReturn ? (1 - napAsym * 0.45) : (1 + napAsym * 0.22);

      // 强弱有机随机性：结合单笔随机微差、均值回归压力游走与贴耳近讲增益
      const midRawPan = strokeMeta && strokeMeta.panMid !== undefined
        ? strokeMeta.panMid
        : (panStart + panEnd) * 0.5 + (Math.random() * 0.22 - 0.11);
      const panMid = Math.max(-0.98, Math.min(0.98, midRawPan));
      const earProximityBoost = 1 + Math.max(0, (Math.max(Math.abs(panStart), Math.abs(panEnd), Math.abs(panMid)) - 0.55) * 0.28);
      const strokeVelJitter = 0.86 + Math.random() * 0.28;
      const effectiveVel = Math.max(0.28, Math.min(1.38, velScale * napVelShift * strokeVelJitter * earProximityBoost));

      // 1. 主剪切噪声源 (随机起始相位避免重复纹理)
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const offset = Math.random() * 3.1;

      // 2. 动态包络峰值时间点随机化 (0.28 ~ 0.64)：有的抚摩先重后轻，有的先轻拂再渐深
      const attackRatio = (strokeMeta && strokeMeta.attackRatio)
        ? strokeMeta.attackRatio
        : (0.28 + Math.random() * 0.34);
      const attackDur = Math.max(0.025, dur * attackRatio);
      const releaseStartRatio = Math.min(0.86, attackRatio + 0.18 + Math.random() * 0.22);

      // 双重物理滤波 (低通钝化去刺 + 动态受力扫频 + 材质中频温润共鸣)
      const spotPitchJitter = 0.90 + Math.random() * 0.20;
      const baseCutoff = mat.baseFreq * (0.62 + (1 - state.fricCushion) * 0.72) * napToneShift * spotPitchJitter;
      const effectiveCutoff = Math.max(240, Math.min(state.userLowpass, baseCutoff));
      const startCutoff = Math.max(160, effectiveCutoff * (0.58 + Math.random() * 0.18));
      const peakCutoff = Math.min(state.userLowpass, effectiveCutoff * (1.12 + Math.random() * 0.22));
      const endCutoff = Math.max(150, effectiveCutoff * (0.54 + Math.random() * 0.20));

      const lpf = audioCtx.createBiquadFilter();
      lpf.type = "lowpass";
      lpf.frequency.setValueAtTime(startCutoff, now);
      lpf.frequency.exponentialRampToValueAtTime(peakCutoff, now + attackDur);

      // 长程抚摩 (> 1.35s) 引入双波峰呼吸式滤波与压力起伏，消除长音死板平坦感
      const hasDualCrest = dur > 1.35 && Math.random() < 0.78;
      const dipTime = now + dur * (0.48 + Math.random() * 0.12);
      const crest2Time = now + dur * (0.70 + Math.random() * 0.12);
      if (hasDualCrest) {
        const dipCutoff = Math.max(180, effectiveCutoff * (0.74 + Math.random() * 0.14));
        const crest2Cutoff = Math.min(state.userLowpass, effectiveCutoff * (1.04 + Math.random() * 0.20));
        lpf.frequency.exponentialRampToValueAtTime(dipCutoff, dipTime);
        lpf.frequency.exponentialRampToValueAtTime(crest2Cutoff, crest2Time);
      }
      lpf.frequency.exponentialRampToValueAtTime(endCutoff, now + dur);
      lpf.Q.setValueAtTime(mat.q * (0.88 + Math.random() * 0.24), now);

      const warmthFilter = audioCtx.createBiquadFilter();
      warmthFilter.type = "peaking";
      warmthFilter.frequency.setValueAtTime(mat.bodyWarmth * (0.92 + Math.random() * 0.16), now);
      warmthFilter.Q.setValueAtTime(1.35, now);
      warmthFilter.gain.setValueAtTime(3.8 + state.fricCushion * 1.4, now);

      // 3. 柔化平滑呼吸式触碰剪切增益包络（支持单峰偏态与双波峰长抚）
      const fricBus = audioCtx.createGain();
      fricBus.gain.setValueAtTime(1.0, now);

      const gainNode = audioCtx.createGain();
      const peakGain = Math.min(0.52, 0.33 * mat.velScale * effectiveVel);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(peakGain, now + attackDur * 0.82);
      if (hasDualCrest) {
        const dipGain = Math.max(0.002, peakGain * (0.58 + Math.random() * 0.22));
        const crest2Gain = Math.max(0.003, peakGain * (0.82 + Math.random() * 0.26));
        gainNode.gain.linearRampToValueAtTime(dipGain, dipTime);
        gainNode.gain.linearRampToValueAtTime(crest2Gain, crest2Time);
      } else {
        gainNode.gain.setValueAtTime(peakGain * (0.84 + Math.random() * 0.14), now + dur * releaseStartRatio);
      }
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      // 4. 3Dio 双耳空间折线/弧线声相轨迹 (p1 -> pMid -> p2 模拟绕耳廓弧度与变速移动)
      const p1 = Math.max(-1, Math.min(1, panStart * state.stereoWidth));
      const pMid = Math.max(-1, Math.min(1, panMid * state.stereoWidth));
      const p2 = Math.max(-1, Math.min(1, panEnd * state.stereoWidth));
      const midPivotTime = now + dur * (0.38 + Math.random() * 0.24);

      const panner = connectTo3DioStage(fricBus, p1, now);
      if (panner) {
        panner.pan.linearRampToValueAtTime(pMid, midPivotTime);
        panner.pan.linearRampToValueAtTime(p2, now + dur);
      }

      src.connect(lpf);
      lpf.connect(warmthFilter);
      warmthFilter.connect(gainNode);
      gainNode.connect(fricBus);

      src.start(now, offset);
      src.stop(now + dur + 0.05);

      // 5. 去纯音化贴耳暖风/肉垫位移层：以整形低通宽频粉噪取代原正弦波 (proxOsc)，彻底消除电子低频嗡鸣
      if (state.currentFricMat === "brush" || state.currentFricMat === "finger" || state.currentFricMat === "leather_pad" || state.currentFricMat === "velvet") {
        const proxSrc = audioCtx.createBufferSource();
        proxSrc.buffer = buf;
        proxSrc.loop = true;

        const proxLp = audioCtx.createBiquadFilter();
        proxLp.type = "lowpass";
        const proxBase = state.currentFricMat === "brush" ? 155 : (state.currentFricMat === "finger" ? 135 : 175);
        proxLp.frequency.setValueAtTime(proxBase * 0.78, now);
        proxLp.frequency.exponentialRampToValueAtTime(proxBase * (1.25 + Math.random() * 0.25), now + attackDur);
        proxLp.frequency.exponentialRampToValueAtTime(proxBase * 0.72, now + dur);
        proxLp.Q.setValueAtTime(1.15, now);

        const proxGain = audioCtx.createGain();
        const proxPeak = (state.currentFricMat === "finger" ? 0.16 : 0.12) * effectiveVel * (0.65 + state.fricCushion * 0.45);
        proxGain.gain.setValueAtTime(0.0001, now);
        proxGain.gain.linearRampToValueAtTime(proxPeak, now + attackDur);
        proxGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        proxSrc.connect(proxLp);
        proxLp.connect(proxGain);
        proxGain.connect(fricBus);

        proxSrc.start(now, (offset + 1.37) % 3.5);
        proxSrc.stop(now + dur + 0.04);
      }

      // 6. 八种摩擦材质专属微观声学结构合成（告别千篇一律的单滤波器模板）
      if (state.currentFricMat === "brush") {
        // 🖌️ 蓬松软毛刷：叠加细密刷毛分叉空气散射层 + 收尾刷尖轻拂微颤
        const tipSrc = audioCtx.createBufferSource();
        tipSrc.buffer = buf;
        tipSrc.loop = true;

        const tipBp = audioCtx.createBiquadFilter();
        tipBp.type = "bandpass";
        const tipFreq = Math.min(state.userLowpass * 0.92, (mat.shearFreq || 1480) * (0.88 + Math.random() * 0.24));
        tipBp.frequency.setValueAtTime(tipFreq * 0.85, now);
        tipBp.frequency.exponentialRampToValueAtTime(tipFreq * 1.12, now + dur * 0.68);
        tipBp.frequency.exponentialRampToValueAtTime(tipFreq * 0.78, now + dur);
        tipBp.Q.setValueAtTime(1.4, now);

        const tipGain = audioCtx.createGain();
        const tipPeak = peakGain * (0.28 + (1 - state.fricCushion) * 0.22);
        tipGain.gain.setValueAtTime(0.0001, now);
        tipGain.gain.linearRampToValueAtTime(tipPeak, now + dur * 0.58);
        tipGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        tipSrc.connect(tipBp);
        tipBp.connect(tipGain);
        tipGain.connect(fricBus);
        tipSrc.start(now, (offset + 0.83) % 3.4);
        tipSrc.stop(now + dur + 0.04);

      } else if (state.currentFricMat === "bamboo_mat") {
        // 🎋 细密竹编席面：弃用固定 22Hz 正弦 LFO，采用随手掌推抚速度先加密后放缓的非均匀竹篾条索包络
        const slatSteps = Math.max(4, Math.min(22, Math.floor(dur * (11 + Math.random() * 5))));
        let tCursor = now + 0.02;
        for (let s = 0; s < slatSteps; s++) {
          const normPos = s / slatSteps;
          // 手掌中段速度快（竹篾间隔短），首尾速度慢（竹篾间隔宽）
          const speedCurve = Math.sin(normPos * Math.PI);
          const stepDur = ((dur - 0.04) / slatSteps) * (1.28 - speedCurve * 0.42) * (0.82 + Math.random() * 0.36);
          if (tCursor + stepDur > now + dur) break;
          const ridgeFreq = Math.min(state.userLowpass, effectiveCutoff * (0.82 + speedCurve * 0.36 + (s % 2 === 0 ? 0.12 : -0.10) * (0.8 + Math.random() * 0.4)));
          lpf.frequency.setValueAtTime(Math.max(220, ridgeFreq), tCursor);
          tCursor += stepDur;
        }

      } else if (state.currentFricMat === "microsand") {
        // ⏳ 细腻微砂台：弃用固定 34Hz 正弦 LFO，改用非周期石英砂流层 + 随机 2~4 簇微砂滑落微澜
        const sandClusterCount = 2 + Math.floor(Math.random() * 3);
        for (let c = 0; c < sandClusterCount; c++) {
          const cTime = now + dur * (0.14 + (c / sandClusterCount) * 0.66 + (Math.random() * 0.10 - 0.05));
          const cDur = Math.min(dur * 0.28, 0.08 + Math.random() * 0.14);
          if (cTime + cDur >= now + dur) continue;

          const grainSrc = audioCtx.createBufferSource();
          grainSrc.buffer = buf;
          const grainBp = audioCtx.createBiquadFilter();
          grainBp.type = "bandpass";
          const gFreq = Math.min(state.userLowpass * 0.92, (1120 + Math.random() * 460) * (0.75 + (1 - state.fricCushion) * 0.4));
          grainBp.frequency.setValueAtTime(gFreq, cTime);
          grainBp.frequency.exponentialRampToValueAtTime(gFreq * 0.78, cTime + cDur);
          grainBp.Q.setValueAtTime(1.8, cTime);

          const grainGain = audioCtx.createGain();
          const gPeak = peakGain * (0.22 + Math.random() * 0.18);
          grainGain.gain.setValueAtTime(0.0001, cTime);
          grainGain.gain.linearRampToValueAtTime(gPeak, cTime + cDur * 0.35);
          grainGain.gain.exponentialRampToValueAtTime(0.0001, cTime + cDur);

          grainSrc.connect(grainBp);
          grainBp.connect(grainGain);
          grainGain.connect(fricBus);
          grainSrc.start(cTime, Math.random() * 3.0);
          grainSrc.stop(cTime + cDur + 0.02);
        }

      } else if (state.currentFricMat === "finger" || state.currentFricMat === "leather_pad") {
        // 🤲/💼 指腹轻摩与植鞣油皮：抚摩折返或收尾时偶发微粘滞释放声 (Micro-Tacky Detachment)
        if (Math.random() < 0.65) {
          const relTime = now + dur * (0.76 + Math.random() * 0.14);
          const relSrc = audioCtx.createBufferSource();
          relSrc.buffer = buf;
          const relBp = audioCtx.createBiquadFilter();
          relBp.type = "bandpass";
          relBp.frequency.setValueAtTime(Math.min(state.userLowpass, (340 + Math.random() * 160)), relTime);
          relBp.Q.setValueAtTime(2.1, relTime);

          const relGain = audioCtx.createGain();
          relGain.gain.setValueAtTime(0.0001, relTime);
          relGain.gain.linearRampToValueAtTime(peakGain * 0.24, relTime + 0.004);
          relGain.gain.exponentialRampToValueAtTime(0.0001, relTime + 0.024);

          relSrc.connect(relBp);
          relBp.connect(relGain);
          relGain.connect(fricBus);
          relSrc.start(relTime, Math.random() * 3.0);
          relSrc.stop(relTime + 0.03);
        }

      } else if (state.currentFricMat === "bookpage") {
        // 📜 复古厚书页：在抚摩尾部增加整形纸页翻落贴合声（宽带低通纸叠扑声 + 极短促阻尼沉音，随机触发）
        if (Math.random() < 0.78) {
          const pageReleaseTime = now + dur * (0.74 + Math.random() * 0.14);
          const pageNoise = audioCtx.createBufferSource();
          pageNoise.buffer = buf;
          const pageLp = audioCtx.createBiquadFilter();
          pageLp.type = "lowpass";
          pageLp.frequency.setValueAtTime(Math.min(state.userLowpass, 280 + Math.random() * 90), pageReleaseTime);
          const pageNGain = audioCtx.createGain();
          pageNGain.gain.setValueAtTime(0.0001, pageReleaseTime);
          pageNGain.gain.linearRampToValueAtTime(0.14 * effectiveVel, pageReleaseTime + 0.004);
          pageNGain.gain.exponentialRampToValueAtTime(0.0001, pageReleaseTime + 0.038);
          pageNoise.connect(pageLp);
          pageLp.connect(pageNGain);
          pageNGain.connect(fricBus);
          pageNoise.start(pageReleaseTime, Math.random() * 3.0);
          pageNoise.stop(pageReleaseTime + 0.045);

          const pageThud = audioCtx.createOscillator();
          pageThud.type = "sine";
          pageThud.frequency.setValueAtTime(148 + Math.random() * 26, pageReleaseTime);
          pageThud.frequency.exponentialRampToValueAtTime(62, pageReleaseTime + 0.034);

          const pageGain = audioCtx.createGain();
          pageGain.gain.setValueAtTime(0.0001, pageReleaseTime);
          pageGain.gain.linearRampToValueAtTime(0.13 * effectiveVel, pageReleaseTime + 0.004);
          pageGain.gain.exponentialRampToValueAtTime(0.0001, pageReleaseTime + 0.038);

          pageThud.connect(pageGain);
          pageGain.connect(fricBus);
          pageThud.start(pageReleaseTime);
          pageThud.stop(pageReleaseTime + 0.044);
        }
      }

      createFrictionVisualStroke(panStart, panEnd, dur, state.currentFricMat, state.currentFricStyle, effectiveVel, panMid);
    }

    function scheduleNextFrictionStroke() {
      if (!state.isPlaying || state.activeCategory !== "friction") return;

      const style = FRICTION_STYLES[state.currentFricStyle] || FRICTION_STYLES.swiping;
      const baseCycle = (style.cycleTime / state.fricSpeedMultiplier);

      // 1. 抚摩力度均值回归随机游走 (Mean-Reverting Pressure Random Walk)，赋予长时聆听自然强弱呼吸感
      state.fricPressureWalk += (1.0 - state.fricPressureWalk) * 0.24 + (Math.random() - 0.5) * 0.28;
      if (Math.random() < 0.12) {
        // 偶发极轻柔耳畔羽毛触碰或深沉温润按抚
        state.fricPressureWalk += (Math.random() < 0.5 ? -0.18 : 0.20);
      }
      state.fricPressureWalk = Math.max(0.68, Math.min(1.26, state.fricPressureWalk));

      if (state.currentFricStyle === "swiping") {
        // ↔️ 慢速往复推抚：融合「单侧耳廓驻留推抚 (2~4 次)」与「跨双耳长弧线推抚」，推/拉力度与时长自然随机
        state.fricPhraseRemaining -= 1;
        if (state.fricPhraseRemaining <= 0) {
          state.fricHandSide = -state.fricHandSide;
          state.fricPhraseRemaining = 2 + Math.floor(Math.random() * 3); // 2~4 次短语
        }

        // 16% 概率同向顺抚两次后再折返，打破 100% 死板一左一右机械交替
        if (Math.random() >= 0.16) {
          state.fricStrokeParity = (state.fricStrokeParity + 1) % 2;
        }
        const isReturn = state.fricStrokeParity === 1;

        // 方向随机性：52% 概率在当前主导耳侧局部深层推抚，48% 概率跨越双耳声场
        const isSingleEarFocus = Math.random() < 0.52;
        let pStart, pEnd, panMid;
        if (isSingleEarFocus) {
          const sideSign = state.fricHandSide >= 0 ? 1 : -1;
          const outerEdge = sideSign * (0.76 + Math.random() * 0.20);
          const innerEdge = sideSign * (0.14 + Math.random() * 0.28);
          pStart = isReturn ? innerEdge : outerEdge;
          pEnd = isReturn ? outerEdge : innerEdge;
          panMid = (pStart + pEnd) * 0.5 + sideSign * (0.06 + Math.random() * 0.12);
        } else {
          const dir = isReturn ? -1 : 1;
          const spanL = 0.55 + Math.random() * 0.40;
          const spanR = 0.55 + Math.random() * 0.40;
          pStart = -spanL * dir + (Math.random() * 0.14 - 0.07);
          pEnd = spanR * dir + (Math.random() * 0.14 - 0.07);
          panMid = (Math.random() * 0.36 - 0.18);
        }

        // 持续时间随机性：随空间行程跨度与随机律动伸缩 (0.68x ~ 1.45x)，偶发悠长慢抚
        const spatialSpan = Math.abs(pEnd - pStart);
        const spanDurFactor = 0.78 + spatialSpan * 0.22;
        const lingeringScale = Math.random() < 0.15 ? (1.28 + Math.random() * 0.24) : (0.76 + Math.random() * 0.42);
        const dur = Math.max(0.45, (baseCycle / 1000) * 0.84 * spanDurFactor * lingeringScale);

        // 强弱随机性：主推抚更饱满温厚，回拉轻拂更轻柔透气
        const pushPullVel = isReturn ? (0.74 + Math.random() * 0.20) : (0.94 + Math.random() * 0.22);
        const vel = state.fricPressureWalk * pushPullVel;

        triggerFrictionStroke(pStart, pEnd, dur, vel, {
          isReturn,
          panMid,
          attackRatio: isReturn ? (0.32 + Math.random() * 0.22) : (0.38 + Math.random() * 0.26),
          exactDur: true
        });

        fricMotionPhase++;
        // 折返间隙随机留白：换耳短语末尾留出更从容的呼吸停顿
        const turnaroundMult = state.fricPhraseRemaining === 1
          ? (1.14 + Math.random() * 0.34)
          : (0.86 + Math.random() * 0.28);
        const nextDelay = Math.max(260, dur * 1000 * turnaroundMult);
        fricTimerId = setTimeout(scheduleNextFrictionStroke, nextDelay);

      } else if (state.currentFricStyle === "circle") {
        // 🔄 3Dio 耳廓打圈：连续随机相位角游走 + 顺/逆时针随机反转 + 单耳耳廓揉圈与双耳环绕交织
        state.fricOrbitLoopsLeft -= 1;
        if (state.fricOrbitLoopsLeft <= 0) {
          if (Math.random() < 0.62) state.fricOrbitDir = -state.fricOrbitDir; // 随机顺/逆时针反转
          if (Math.random() < 0.45) state.fricHandSide = -state.fricHandSide;
          state.fricOrbitLoopsLeft = 3 + Math.floor(Math.random() * 5);
        }

        const prevAngle = state.fricOrbitAngle;
        const angleStep = (0.72 + Math.random() * 0.68) * state.fricOrbitDir;
        state.fricOrbitAngle += angleStep;

        // 38% 概率围绕单侧硅胶耳廓局部打小圈，62% 概率沿双耳 360° 轨道环绕
        const isLocalEarPinnaLoop = Math.random() < 0.38;
        let pStart, pEnd, panMid;
        if (isLocalEarPinnaLoop) {
          const earCenter = (state.fricHandSide >= 0 ? 0.64 : -0.64);
          const loopRadius = 0.24 + Math.random() * 0.10;
          pStart = Math.max(-0.98, Math.min(0.98, earCenter + Math.sin(prevAngle) * loopRadius));
          pEnd = Math.max(-0.98, Math.min(0.98, earCenter + Math.sin(state.fricOrbitAngle) * loopRadius));
          panMid = Math.max(-0.98, Math.min(0.98, earCenter + Math.sin((prevAngle + state.fricOrbitAngle) * 0.5) * (loopRadius * 1.15)));
        } else {
          pStart = Math.sin(prevAngle) * 0.88;
          pEnd = Math.sin(state.fricOrbitAngle) * 0.88;
          panMid = Math.sin((prevAngle + state.fricOrbitAngle) * 0.5) * 0.94;
        }

        // 持续时间随机性：打圈弧段时长随角步长与手部微律动变化 (0.72x ~ 1.38x)
        const baseArcSec = (baseCycle / 5.2) / 1000;
        const dur = Math.max(0.32, baseArcSec * (0.85 + Math.abs(angleStep) * 0.35) * (0.78 + Math.random() * 0.42));

        // 强弱随机性：掠过耳道外缘 (|pan| 较大处) 时压力与近讲感自然隆起
        const proximityCrest = 0.78 + Math.max(Math.abs(pStart), Math.abs(pEnd)) * 0.28;
        const vel = state.fricPressureWalk * proximityCrest * (0.86 + Math.random() * 0.26);

        triggerFrictionStroke(pStart, pEnd, dur, vel, {
          isReturn: state.fricOrbitDir < 0,
          panMid,
          exactDur: true
        });

        fricMotionPhase++;
        // 相邻圆弧之间保留 12%~28% 柔滑交叠，偶发微顿换气
        const overlapRatio = Math.random() < 0.14 ? (1.02 + Math.random() * 0.18) : (0.74 + Math.random() * 0.20);
        fricTimerId = setTimeout(scheduleNextFrictionStroke, Math.max(180, dur * 1000 * overlapRatio));

      } else if (state.currentFricStyle === "feather") {
        // 🪶 羽化轻柔短拂：2~5 次不等数变速轻拂簇 + 渐强/渐弱/拱形力度包络 + 内外双向随机轻扫
        const burstCount = 2 + Math.floor(Math.random() * 4); // 随机 2、3、4 或 5 连拂
        if (Math.random() < 0.58) {
          state.fricHandSide = -state.fricHandSide;
        }
        const isCrossAlternating = Math.random() < 0.26; // 26% 概率在单簇内左右耳交替轻扫
        const baseSide = state.fricHandSide >= 0 ? 0.68 : -0.68;

        // 随机选择本簇的强弱律动形态：0 = 渐强 (crescendo), 1 = 渐弱 (decrescendo), 2 = 拱形 (arch)
        const contourType = Math.floor(Math.random() * 3);
        const clusterVelBase = state.fricPressureWalk * (0.78 + Math.random() * 0.32);

        let cumulativeDelayMs = 0;
        for (let i = 0; i < burstCount; i++) {
          const stepDelay = cumulativeDelayMs;
          const normIdx = burstCount > 1 ? i / (burstCount - 1) : 0.5;

          // 计算单次短拂的力度包络
          let shapeMul = 1.0;
          if (contourType === 0) shapeMul = 0.70 + normIdx * 0.42;
          else if (contourType === 1) shapeMul = 1.10 - normIdx * 0.40;
          else shapeMul = 0.74 + Math.sin(normIdx * Math.PI) * 0.38;
          const strokeVel = clusterVelBase * shapeMul * (0.88 + Math.random() * 0.24);

          // 单次短拂持续时间随机化 (0.16s 轻快短掠 ~ 0.44s 柔长尾拂)，尾拍自然略微舒展
          const tailStretch = (i === burstCount - 1 && Math.random() < 0.65) ? (1.22 + Math.random() * 0.28) : 1.0;
          const strokeDur = Math.max(0.15, (0.17 + Math.random() * 0.21) * tailStretch / Math.pow(state.fricSpeedMultiplier, 0.45));

          // 方向随机性：可向外轻拂、向耳道内轻扫或沿耳垂上下微拂
          const activeSide = isCrossAlternating ? (i % 2 === 0 ? baseSide : -baseSide) : baseSide;
          const sweepDir = (Math.random() < 0.68 ? 1 : -1) * Math.sign(activeSide);
          const sweepSpan = 0.14 + Math.random() * 0.26;
          const pStart = Math.max(-0.98, Math.min(0.98, activeSide + (Math.random() * 0.26 - 0.13)));
          const pEnd = Math.max(-0.98, Math.min(0.98, pStart + sweepDir * sweepSpan));
          const panMid = (pStart + pEnd) * 0.5 + (Math.random() * 0.08 - 0.04);

          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "friction") {
              triggerFrictionStroke(pStart, pEnd, strokeDur, strokeVel, {
                isReturn: sweepDir < 0,
                panMid,
                attackRatio: 0.24 + Math.random() * 0.26,
                exactDur: true
              });
            }
          }, stepDelay);

          // 簇内非均匀手腕微律动间隔 (Rubato)
          const stepGapMs = (118 + Math.random() * 115 + strokeDur * 260) / state.fricSpeedMultiplier;
          cumulativeDelayMs += stepGapMs;
        }

        // 簇与簇之间的呼吸留白随机化
        const restPause = (baseCycle * (0.55 + Math.random() * 0.58));
        fricTimerId = setTimeout(scheduleNextFrictionStroke, Math.max(320, cumulativeDelayMs + restPause));

      } else {
        // 🌊 绵延催眠慢抚 (continuous)：无缝空间漫游衔接 + 3.5~6.2s 随机长波时长 + 双波峰深呼吸强弱
        const durScale = 0.76 + Math.random() * 0.52; // 随机长短慢波
        const dur = Math.max(1.8, (baseCycle / 1000) * 0.96 * durScale);

        // 起点承接上一拍终点附近（微漂移 ±0.14），终点随机漫游至另一耳或深侧耳廓，保证充足空间流动感
        const pStart = Math.max(-0.95, Math.min(0.95, state.fricLastEndPan + (Math.random() * 0.24 - 0.12)));
        let targetSide = -Math.sign(pStart || -0.5);
        if (Math.random() < 0.28) {
          // 28% 概率在同一侧耳畔深处做蜿蜒折返慢抚
          targetSide = Math.sign(pStart || 0.5);
        }
        const pEnd = Math.max(-0.95, Math.min(0.95, targetSide * (0.45 + Math.random() * 0.48)));
        // 中途弧线控制点：有时掠过另一侧耳廓再折回，形成 S 形或大弧线漫游
        const panMid = Math.max(-0.96, Math.min(0.96, (pStart + pEnd) * 0.5 + (Math.random() * 0.72 - 0.36)));
        state.fricLastEndPan = pEnd;

        const vel = state.fricPressureWalk * (0.76 + Math.random() * 0.36);
        triggerFrictionStroke(pStart, pEnd, dur, vel, {
          isReturn: pEnd < pStart,
          panMid,
          attackRatio: 0.30 + Math.random() * 0.32,
          exactDur: true
        });

        // 下一道慢抚在当前慢抚进行至 72%~90% 时无缝交叠涌入，彻底消除断层与固定周期感
        const overlapFactor = 0.72 + Math.random() * 0.18;
        fricTimerId = setTimeout(scheduleNextFrictionStroke, Math.max(900, dur * 1000 * overlapFactor));
      }
    }

    // --------------------------------------------------------------------------
    // B4. 水流声物理声学合成核心 (8种异构水相拓扑 + 克制化多粒径气泡 + 水舌微澜/卵石/方冰/茶道建模)
    // --------------------------------------------------------------------------
    function triggerWaterBubble(azimuthOverride = null, velScale = 1.0, eventVariant = null) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "water") return;

      const scene = WATER_SCENARIOS[state.currentWaterScene] || WATER_SCENARIOS.spring;
      const style = WATER_STYLES[state.currentWaterStyle] || WATER_STYLES.meander;
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      // 1. 3Dio 空间声相计算（融合非周期双耳洄游与涡流微偏置）
      let rawAz = 0;
      if (azimuthOverride !== null) {
        rawAz = Math.max(-0.98, Math.min(0.98, azimuthOverride));
      } else if (style.binauralMode === "eddy") {
        rawAz = Math.max(-0.96, Math.min(0.96, Math.sin(waterEddyAngle) * 0.84 + (Math.random() * 0.24 - 0.12)));
      } else {
        rawAz = Math.max(-0.96, Math.min(0.96, (Math.random() * 2 - 1) * 0.82 + state.waterPanBias * 0.28));
      }
      const azimuth = rawAz * state.stereoWidth;

      const vel = Math.min(1.15, (0.52 + Math.random() * 0.46) * velScale);
      const peak = vel * 0.30;
      const cutoff = Math.max(280, Math.min(state.userLowpass, 1250 + (1 - state.waterSoftness) * 1050));

      // 2. 反同频重复采样器：在 [fMin, fMax] 宽频带内跨大/中/小三阶粒径采样，强制避开上一发频段
      const freqRange = scene.bubbleFreqRange || [scene.bubbleBaseFreq * 0.65, scene.bubbleBaseFreq * 1.55];
      const sampleDistinctPitchNorm = (tierHint = null) => {
        let norm = Math.random();
        if (tierHint === "macro") {
          norm = Math.random() * 0.32; // 大粒径深水低频泡 (0.00 ~ 0.32)
        } else if (tierHint === "micro") {
          norm = 0.64 + Math.random() * 0.36; // 细微高音子泡/水珠 (0.64 ~ 1.00)
        } else if (tierHint === "medium") {
          norm = 0.28 + Math.random() * 0.42; // 中粒径标准水泡 (0.28 ~ 0.70)
        } else {
          // 随机三阶粒径分布，打破全中频聚集
          const rTier = Math.random();
          if (rTier < 0.28) norm = Math.random() * 0.32;
          else if (rTier < 0.72) norm = 0.30 + Math.random() * 0.38;
          else norm = 0.66 + Math.random() * 0.34;
        }
        // 若与上一颗频率过于接近 (< 0.18)，则自动跳变至互补频段，彻底根除同频重复
        if (Math.abs(norm - state.waterLastPitchNorm) < 0.18) {
          norm = (norm + 0.38 + Math.random() * 0.28) % 1.0;
        }
        state.waterLastPitchNorm = norm;
        return norm;
      };

      const waterBus = audioCtx.createGain();
      waterBus.gain.setValueAtTime(1.0, now);
      const panner = connectTo3DioStage(waterBus, azimuth, now);

      // 辅助函数 1：整形宽频水相噪声脉冲（模拟水舌微澜、石面漫流、液膜破裂、水珠溅落）
      const spawnWaterNoise = (filterType, fStart, fEnd, q, gainAmt, atk, dur, lpClamp = cutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;

        const flt = audioCtx.createBiquadFilter();
        flt.type = filterType;
        const clampedStart = Math.max(65, Math.min(lpClamp, fStart));
        const clampedEnd = Math.max(60, Math.min(lpClamp, fEnd));
        flt.frequency.setValueAtTime(clampedStart, t0);
        if (Math.abs(clampedEnd - clampedStart) > 8) {
          flt.frequency.exponentialRampToValueAtTime(clampedEnd, t0 + atk + dur * 0.85);
        }
        flt.Q.setValueAtTime(Math.max(0.5, q * (0.85 + Math.random() * 0.3)), t0);

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.max(120, lpClamp), t0);
        lp.Q.setValueAtTime(0.7, t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0004, gainAmt), t0 + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);

        src.connect(flt);
        flt.connect(lp);
        lp.connect(g);
        g.connect(waterBus);

        const offset = Math.random() * Math.max(0.2, buf.duration - atk - dur - 0.1);
        src.start(t0, offset);
        src.stop(t0 + atk + dur + 0.01);
      };

      // 辅助函数 2：短促高阻尼流体/器皿模态脉冲（用于水面凹陷、石块/竹筒/紫砂/冰块阻尼共鸣）
      const spawnWaterModal = (fStart, fEnd, gainAmt, atk, dur, lpClamp = cutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(Math.max(38, fStart), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(36, fEnd), t0 + Math.max(0.006, dur));

        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(Math.max(110, lpClamp), t0);
        lp.Q.setValueAtTime(0.85, t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0004, gainAmt), t0 + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);

        osc.connect(lp);
        lp.connect(g);
        g.connect(waterBus);

        osc.start(t0);
        osc.stop(t0 + atk + dur + 0.008);
      };

      // 辅助函数 3：物理去纯音化 Minnaert 水泡（液膜破裂宽频微瞬态 + 大/中/小异频气腔收缩扫频）
      const spawnMinnaertBubble = (sizeTier = null, delaySec = 0, gainMul = 1.0) => {
        const norm = sampleDistinctPitchNorm(sizeTier);
        // 对数频率映射，使低频大泡、中频泡与高频微泡在听感八度上均匀拉开
        const fMin = freqRange[0];
        const fMax = freqRange[1];
        const baseFreq = Math.min(cutoff * 0.92, fMin * Math.pow(fMax / fMin, norm));

        const chirpSpan = scene.bubbleChirpRange || [1.14, 1.38];
        // 大水泡扫频慢而温润，小微泡扫频短促清透
        const sizeFactor = 1 - norm; // 1 = 大泡, 0 = 微泡
        const chirpRatio = chirpSpan[0] + Math.random() * (chirpSpan[1] - chirpSpan[0]) * (0.82 + norm * 0.28);
        const targetEndFreq = Math.min(cutoff * 1.06, baseFreq * chirpRatio);

        const baseDecay = (scene.bubbleDecay || 0.034) * (0.68 + sizeFactor * 0.65) * (0.85 + state.waterSoftness * 0.35);
        const chirpDur = Math.max(0.011, baseDecay * (0.58 + Math.random() * 0.28));
        const atk = 0.0022 + state.waterSoftness * 0.0025 + sizeFactor * 0.0018;
        // 降低纯正弦占比 (原为 peak * 1.0，现收敛至 0.42~0.58 并配以液膜宽频瞬态)，消除电子合成器啵啵感
        const bPeak = peak * (0.38 + sizeFactor * 0.20) * gainMul;

        // 1) 气泡浮出水面时的毛细液膜破裂与水环微瞬态 (Capillary Film Rupture Noise)
        const filmDur = 0.009 + sizeFactor * 0.010;
        spawnWaterNoise(
          "bandpass",
          baseFreq * 1.35,
          baseFreq * 0.92,
          2.1,
          bPeak * 0.52,
          0.0018,
          filmDur,
          cutoff,
          delaySec
        );

        // 2) 大粒径水泡专属：水体低中频微凹陷位移 (Fluid Cavity Displacement)
        if (sizeFactor > 0.55) {
          spawnWaterModal(
            Math.max(95, baseFreq * 0.52),
            Math.max(58, baseFreq * 0.34),
            bPeak * 0.32,
            0.0025,
            filmDur * 1.4,
            Math.min(cutoff, 380),
            delaySec
          );
        }

        // 3) 受控 Minnaert 气腔收缩扫频（偶发先微下潜再上扬的真实液滴裹气凹陷形态）
        const t0 = now + delaySec;
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        const hasPlungeDip = sizeFactor > 0.35 && Math.random() < 0.42;
        if (hasPlungeDip) {
          osc.frequency.setValueAtTime(baseFreq * 1.08, t0);
          osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.93, t0 + chirpDur * 0.28);
          osc.frequency.exponentialRampToValueAtTime(targetEndFreq, t0 + chirpDur);
        } else {
          osc.frequency.setValueAtTime(baseFreq, t0);
          osc.frequency.exponentialRampToValueAtTime(targetEndFreq, t0 + chirpDur);
        }

        const bpFilter = audioCtx.createBiquadFilter();
        bpFilter.type = "bandpass";
        bpFilter.frequency.setValueAtTime(baseFreq * 1.12, t0);
        bpFilter.Q.setValueAtTime(1.4 + (1 - state.waterSoftness) * 1.8, t0);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(cutoff, t0);

        const bubbleGain = audioCtx.createGain();
        bubbleGain.gain.setValueAtTime(0.0001, t0);
        bubbleGain.gain.linearRampToValueAtTime(Math.max(0.0005, bPeak), t0 + atk);
        bubbleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + baseDecay);

        osc.connect(bpFilter);
        bpFilter.connect(lpf);
        lpf.connect(bubbleGain);
        bubbleGain.connect(waterBus);

        osc.start(t0);
        osc.stop(t0 + atk + baseDecay + 0.015);

        return baseFreq;
      };

      // 3. 计算当前事件是否触发真实气泡（受场景 bubbleProb、手法 bubbleProbScale 与软化度共同约束）
      const styleBubbleScale = style.bubbleProbScale !== undefined ? style.bubbleProbScale : 1.0;
      const softnessBubbleScale = 1.10 - state.waterSoftness * 0.22;
      const effectiveBubbleProb = Math.max(0.04, Math.min(0.82, (scene.bubbleProb || 0.22) * styleBubbleScale * softnessBubbleScale));
      const shouldSpawnBubble = eventVariant === "bubble"
        ? true
        : (eventVariant === "riffle" || eventVariant === "droplet" ? false : (Math.random() < effectiveBubbleProb));

      // ========================================================================
      // 4. 八种水相场景异构物理建模（告别“几乎每一个都有同频水泡声”）
      // ========================================================================
      if (state.currentWaterScene === "whiskey_ice") {
        // 🥃 场景 6：厚底杯方冰慢融 —— 44% 冷液貼壁旋流 + 36% 方冰轻碰水晶壁 + 20% 冰芯受热微裂/融水微滴
        const roll = Math.random();
        if (roll < 0.44 && eventVariant !== "bubble") {
          // A) 冷液在厚底威士忌杯内缓缓晃动漫流 (Liquid Tumbler Swirl)
          const swirlDur = 0.075 + Math.random() * 0.095;
          const fSwirl = 280 + Math.random() * 240;
          spawnWaterNoise("bandpass", fSwirl * 0.85, fSwirl * 1.25, 1.6, peak * 0.34, 0.016, swirlDur, Math.min(cutoff, 880));
          spawnWaterModal(165 + Math.random() * 35, 92, peak * 0.22, 0.008, swirlDur * 0.7, 280);
          if (panner) {
            panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, azimuth + (Math.random() * 0.24 - 0.12))), now + swirlDur);
          }
          createWaterVisualEvent(azimuth, vel * 0.75, fSwirl, false, "ripple");
        } else if (roll < 0.80) {
          // B) 大方冰旋动轻碰厚底水晶杯壁 (Damped Crystal-Ice Clink，每次碰击位置/音高随机变化)
          const pitchNorm = sampleDistinctPitchNorm();
          const glassF1 = Math.min(cutoff, 580 + pitchNorm * 460);
          const inharmRatio = 2.18 + Math.random() * 0.32;
          const glassF2 = Math.min(cutoff * 1.12, glassF1 * inharmRatio);

          // 冰面与玻璃湿润接触瞬态噪声
          spawnWaterNoise("bandpass", glassF1 * 1.15, glassF1 * 0.85, 2.8, peak * 0.28, 0.0018, 0.011, cutoff);
          // 水晶杯壁双非谐短促阻尼模态 + 厚底杯座沉稳低音
          spawnWaterModal(glassF1, glassF1 * 0.96, peak * 0.48, 0.0022, 0.032, cutoff);
          spawnWaterModal(glassF2, glassF2 * 0.94, peak * 0.15 * (1 - state.waterSoftness * 0.45), 0.0018, 0.016, cutoff * 1.1);
          spawnWaterModal(215 + Math.random() * 45, 108, peak * 0.36, 0.0028, 0.026, 340);

          // 28% 概率方冰惯性二次微靠杯壁 (Double-Tap Ice Settle)
          if (Math.random() < 0.28) {
            const settleDelay = 0.048 + Math.random() * 0.045;
            spawnWaterModal(glassF1 * 0.94, glassF1 * 0.90, peak * 0.22, 0.002, 0.022, cutoff, settleDelay);
            spawnWaterModal(190, 98, peak * 0.18, 0.0025, 0.020, 300, settleDelay);
          }
          createWaterVisualEvent(azimuth, vel, glassF1, false, "ripple");
        } else {
          // C) 冰块内部温差微裂 (Thermal Ice Fissure) 或极偶发融水微泡
          const crackF = Math.min(cutoff, 820 + Math.random() * 520);
          spawnWaterNoise("bandpass", crackF, crackF * 0.72, 3.4, peak * 0.30, 0.0016, 0.010, cutoff);
          spawnWaterModal(380 + Math.random() * 140, 190, peak * 0.20, 0.002, 0.015, 620);
          if (shouldSpawnBubble) {
            const bFreq = spawnMinnaertBubble("micro", 0.012, 0.65);
            createWaterVisualEvent(azimuth, vel * 0.7, bFreq, false, "bubble");
          } else {
            createWaterVisualEvent(azimuth, vel * 0.65, crackF, false, "ripple");
          }
        }
        return;
      }

      if (state.currentWaterScene === "gentle_tide") {
        // 🌊 场景 7：鹅卵石海岸潮汐 —— 48% 潮水漫滩水浪 + 38% 湿润卵石微滚轻碰 + 14% 退潮石隙泡沫微嘶
        const roll = Math.random();
        if (roll < 0.48 && !shouldSpawnBubble) {
          // A) 潮水涌上/漫过鹅卵石滩的柔和宽频水浪微涌 (Shoreline Surf Wash)
          const washDur = 0.14 + Math.random() * 0.22;
          const washFreq = (260 + Math.random() * 280) * (0.85 + (1 - state.waterSoftness) * 0.3);
          spawnWaterNoise("bandpass", washFreq * 0.78, washFreq * 1.22, 1.25, peak * 0.36, washDur * 0.35, washDur * 0.65, Math.min(cutoff, 920));
          spawnWaterNoise("lowpass", 210 + Math.random() * 80, 130, 0.9, peak * 0.28, washDur * 0.3, washDur * 0.7, 360);
          createWaterVisualEvent(azimuth, vel * 0.85, washFreq, false, "ripple");
        } else if (roll < 0.86 && !shouldSpawnBubble) {
          // B) 潮水退却时 1~2 颗湿润鹅卵石在水下轻轻滚动相碰 (Rolling Wet Shoreline Pebbles，实心石质无空腔水泡声)
          const stoneCount = Math.random() < 0.35 ? 2 : 1;
          for (let s = 0; s < stoneCount; s++) {
            const sDelay = s * (0.032 + Math.random() * 0.038);
            const sNorm = sampleDistinctPitchNorm();
            const stoneF = 240 + sNorm * 420;
            const sScale = s === 0 ? 1.0 : 0.65;
            spawnWaterNoise("bandpass", stoneF * 1.2, stoneF * 0.85, 2.2, peak * 0.32 * sScale, 0.002, 0.013, Math.min(cutoff, 980), sDelay);
            spawnWaterModal(stoneF, stoneF * 0.68, peak * 0.28 * sScale, 0.0022, 0.016, 680, sDelay);
            spawnWaterModal(135 + Math.random() * 35, 72, peak * 0.24 * sScale, 0.0025, 0.020, 260, sDelay);
          }
          createWaterVisualEvent(azimuth, vel * 0.8, 340, false, "ripple");
        } else {
          // C) 退潮水沫渗入鹅卵石缝隙的细密气孔微嘶与极微小泡沫破灭 (Foam Percolation Fizz)
          const fizzDur = 0.045 + Math.random() * 0.065;
          spawnWaterNoise("bandpass", 620 + Math.random() * 380, 440, 1.7, peak * 0.26, 0.008, fizzDur, Math.min(cutoff, 1150));
          const bFreq = spawnMinnaertBubble("micro", 0.006, 0.58);
          createWaterVisualEvent(azimuth, vel * 0.7, bFreq, false, "bubble");
        }
        return;
      }

      if (state.currentWaterScene === "deepbasin") {
        // 🌀 场景 3：幽潭微涌 —— 66% 深水暗流漩涡漫涌 (无高音水泡) + 34% 潭底升腾大粒径低频水泡
        if (!shouldSpawnBubble) {
          const swellDur = 0.12 + Math.random() * 0.18;
          const eddyFreq = 160 + Math.random() * 170;
          spawnWaterNoise("bandpass", eddyFreq * 0.82, eddyFreq * 1.28, 1.65, peak * 0.38, swellDur * 0.38, swellDur * 0.62, Math.min(cutoff, 580));
          spawnWaterModal(115 + Math.random() * 35, 58, peak * 0.34, 0.012, swellDur * 0.65, 240);
          createWaterVisualEvent(azimuth, vel * 0.8, eddyFreq, false, "ripple");
        } else {
          // 深潭气泡偏向 macro/medium 低中频，偶带一颗高频小尾泡
          const tier = Math.random() < 0.58 ? "macro" : "medium";
          const bFreq = spawnMinnaertBubble(tier, 0, 0.92);
          createWaterVisualEvent(azimuth, vel, bFreq, false, "bubble");
        }
        return;
      }

      if (state.currentWaterScene === "viscous") {
        // 🫧 场景 4：粘稠微气泡 —— 32% 浓稠流体粘滞舒展翻折 + 68% 跨 2.4 个八度的大/中/小异频软钝气泡
        if (!shouldSpawnBubble) {
          const foldDur = 0.085 + Math.random() * 0.115;
          const foldFreq = 190 + Math.random() * 190;
          spawnWaterNoise("bandpass", foldFreq * 0.75, foldFreq * 1.35, 2.1, peak * 0.34, 0.018, foldDur, Math.min(cutoff, 680));
          spawnWaterModal(135 + Math.random() * 30, 64, peak * 0.32, 0.008, foldDur * 0.75, 260);
          createWaterVisualEvent(azimuth, vel * 0.75, foldFreq, false, "ripple");
        } else {
          // 随机抽取 macro (160~280Hz 浓稠大泡) / medium (290~520Hz 温润中泡) / micro (540~880Hz 细微子泡)
          const bFreq = spawnMinnaertBubble(null, 0, 0.95);
          createWaterVisualEvent(azimuth, vel, bFreq, false, "bubble");
        }
        return;
      }

      // 🏞️/🪨/🎋/🫖 场景 1/2/5/8：山涧清泉 (spring) / 鹅卵石浅溪 (pebble) / 添水竹韵 (shishi) / 紫砂茶台 (tea_drip)
      if (!shouldSpawnBubble) {
        // 非气泡主导事件（占 76%~84%）：分流为「石隙/浅滩水舌滑移微澜 (Riffle Glide)」与「清润水珠落面 (Droplet Plink)」
        const isRiffleGlide = state.currentWaterScene === "pebble"
          ? (Math.random() < 0.68)
          : (state.currentWaterScene === "tea_drip" ? (Math.random() < 0.42) : (Math.random() < 0.54));

        if (isRiffleGlide) {
          // A) 水舌漫过苔石/卵石/竹笕的柔和宽频流态微澜（完全无正弦波扫频水泡）
          const riffleDur = 0.042 + Math.random() * 0.085;
          const pNorm = sampleDistinctPitchNorm();
          const rFreq = (320 + pNorm * 580) * (0.85 + (1 - state.waterSoftness) * 0.25);
          const dirUp = Math.random() < 0.55;
          spawnWaterNoise(
            "bandpass",
            dirUp ? rFreq * 0.82 : rFreq * 1.18,
            dirUp ? rFreq * 1.18 : rFreq * 0.82,
            1.55,
            peak * 0.34,
            0.009 + Math.random() * 0.010,
            riffleDur,
            cutoff
          );
          spawnWaterNoise("lowpass", 250 + Math.random() * 90, 160, 0.95, peak * 0.20, 0.008, riffleDur * 1.1, 420);
          createWaterVisualEvent(azimuth, vel * 0.78, rFreq, false, "ripple");
        } else {
          // B) 独立水珠滴落水面/湿石/竹盘/紫砂壶面（整形水滴冲击噪声 + 极短促阻尼表面共鸣，不带上扬气泡音）
          const pNorm = sampleDistinctPitchNorm();
          const dropFreq = 380 + pNorm * 680;
          const dropDur = 0.012 + Math.random() * 0.014;
          spawnWaterNoise("bandpass", dropFreq * 1.25, dropFreq * 0.85, 2.4, peak * 0.36, 0.0018, dropDur, cutoff);
          spawnWaterModal(dropFreq * 0.58, dropFreq * 0.36, peak * 0.24, 0.0022, 0.018, Math.min(cutoff, 560));

          if (state.currentWaterScene === "tea_drip") {
            // 紫砂陶器与竹制茶盘格栅的温润木陶阻尼承接声
            const trayF = 245 + Math.random() * 85;
            spawnWaterModal(trayF, trayF * 0.62, peak * 0.28, 0.0025, 0.026, 480);
          } else if (state.currentWaterScene === "shishi") {
            // 竹筒内壁空腔承接水滴的清幽竹韵
            const bambooF = 340 + Math.random() * 110;
            spawnWaterModal(bambooF, bambooF * 0.78, peak * 0.24, 0.0022, 0.024, 620);
          }
          createWaterVisualEvent(azimuth, vel * 0.82, dropFreq, false, "ripple");
        }
      } else {
        // 偶发真实水泡事件（占 16%~24%）：水珠较大携气入水，触发前导微水花 + 异频 Minnaert 气腔谐振
        if (state.currentWaterScene === "tea_drip") {
          spawnWaterModal(265 + Math.random() * 55, 155, peak * 0.22, 0.0025, 0.026, 440);
        }
        const bFreq = spawnMinnaertBubble(null, 0, 0.88);
        createWaterVisualEvent(azimuth, vel, bFreq, false, "bubble");
      }
    }

    function scheduleNextWaterBubble() {
      if (!state.isPlaying || state.activeCategory !== "water") return;

      const scene = WATER_SCENARIOS[state.currentWaterScene] || WATER_SCENARIOS.spring;
      const style = WATER_STYLES[state.currentWaterStyle] || WATER_STYLES.meander;

      // 1. 双耳洄游非周期相位游走（支持顺/逆旋切换与单侧耳畔漩涡短驻）
      state.waterEddyStepsLeft -= 1;
      if (state.waterEddyStepsLeft <= 0) {
        if (Math.random() < 0.45) state.waterEddyDir = -state.waterEddyDir;
        state.waterEddyStepsLeft = 4 + Math.floor(Math.random() * 6);
      }
      waterEddyAngle += (0.18 + Math.random() * 0.26) * state.waterEddyDir * state.waterSpeedMultiplier;

      // 2. 疏密均值回归随机游走 (Mean-Reverting Density Random Walk)
      state.waterDensityWalk += (1.0 - state.waterDensityWalk) * 0.22 + (Math.random() - 0.5) * 0.26;
      if (Math.random() < 0.08) {
        state.waterDensityWalk += (Math.random() < 0.52 ? -0.24 : 0.26);
      }
      state.waterDensityWalk = Math.max(0.54, Math.min(1.46, state.waterDensityWalk));

      // 3. 结合非周期流体呼吸包络计算当前瞬时事件率
      const styleRateScale = style.rateScale || 1.0;
      let flowMod = 1 + state.waterFlowEnv * 0.38;
      if (style.binauralMode === "lapping" || state.currentWaterScene === "gentle_tide") {
        // 非周期复合潮汐波（三重无理数相位叠加，消除 Date.now() % cycleTime 的机械钟表周期）
        const tSec = Date.now() / 1000;
        const w1 = Math.sin(tSec * 1.45 * (scene.undulationSpeed || 0.5));
        const w2 = Math.sin(tSec * 0.92 * Math.SQRT2 * (scene.undulationSpeed || 0.5) + 1.3);
        const waveIntensity = 0.42 + 0.58 * Math.max(-0.55, w1 * 0.65 + w2 * 0.35);
        flowMod *= Math.max(0.26, waveIntensity);
      }

      const avgRate = Math.max(0.8, scene.bubbleRate * state.waterSpeedMultiplier * styleRateScale * state.waterDensityWalk * flowMod);
      let interval = (-Math.log(1 - Math.random()) / avgRate) * 1000;

      // 4. 自然呼吸留白（约 11% 概率出现从容间歇，仅留连续水幕底流轻吟）
      if (Math.random() < 0.11) {
        interval *= (1.45 + Math.random() * 0.85);
      }

      const baseAz = style.binauralMode === "eddy"
        ? Math.max(-0.95, Math.min(0.95, Math.sin(waterEddyAngle) * 0.84))
        : Math.max(-0.95, Math.min(0.95, (Math.random() * 2 - 1) * 0.82 + state.waterPanBias * 0.28));

      triggerWaterBubble(baseAz);

      // 5. 变速微水相子簇 (Decelerating Sub-Cluster)：偶发 1~2 颗尾随微水珠或细微子泡，间隔先紧后舒展
      const clusterChance = (scene.clusterProb || 0.22) * (0.78 + Math.max(0, state.waterFlowEnv * 0.45));
      if (Math.random() < clusterChance) {
        const subCount = Math.random() < 0.28 ? 2 : 1;
        let accDelay = 38 + Math.random() * 55;
        for (let i = 0; i < subCount; i++) {
          const d = accDelay;
          const subAz = Math.max(-0.96, Math.min(0.96, baseAz + (Math.random() * 0.30 - 0.15)));
          const subVel = (i === 0 ? 0.68 : 0.48) * (0.85 + Math.random() * 0.25);
          // 尾随子事件优先为轻柔水珠或微澜，仅在粘稠气泡场景下偶发高频细微子泡
          const subVariant = (state.currentWaterScene === "viscous" && Math.random() < 0.55)
            ? "bubble"
            : (Math.random() < 0.5 ? "droplet" : "riffle");
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "water") {
              triggerWaterBubble(subAz, subVel, subVariant);
            }
          }, d);
          accDelay += (72 + Math.random() * 88) * (1 + i * 0.45);
        }
      }

      waterBubbleTimerId = setTimeout(scheduleNextWaterBubble, Math.max(45, interval));
    }

    function scheduleNextShishiOdoshi() {
      if (!state.isPlaying || state.activeCategory !== "water" || !WATER_SCENARIOS[state.currentWaterScene].shishi) return;

      const now = scope.time();
      const spotJitter = 0.92 + Math.random() * 0.16;
      const az = (0.16 + (Math.random() * 0.14 - 0.07)) * state.stereoWidth;
      const clackBus = audioCtx.createGain();
      clackBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(clackBus, az, now);

      const buf = getFrictionNoiseBuffer();
      const lpClamp = Math.min(state.userLowpass, 960);

      // 1. 湿润青竹筒外壁撞击青石的宽频木石接触瞬态 (消除纯正弦电子感)
      if (buf) {
        const hitSrc = audioCtx.createBufferSource();
        hitSrc.buffer = buf;
        const hitBp = audioCtx.createBiquadFilter();
        hitBp.type = "bandpass";
        hitBp.frequency.setValueAtTime(Math.min(lpClamp, 420 * spotJitter), now);
        hitBp.Q.setValueAtTime(1.8, now);
        const hitGain = audioCtx.createGain();
        hitGain.gain.setValueAtTime(0.0001, now);
        hitGain.gain.linearRampToValueAtTime(0.28, now + 0.0025);
        hitGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);
        hitSrc.connect(hitBp);
        hitBp.connect(hitGain);
        hitGain.connect(clackBus);
        hitSrc.start(now, Math.random() * 2.5);
        hitSrc.stop(now + 0.032);
      }

      // 2. 沉闷天然竹筒空腔基频 (~215Hz) + 竹节非谐二阶模态 (~485Hz)
      const osc1 = audioCtx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(220 * spotJitter, now);
      osc1.frequency.exponentialRampToValueAtTime(110 * spotJitter, now + 0.105);

      const osc2 = audioCtx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(480 * spotJitter, now);
      osc2.frequency.exponentialRampToValueAtTime(390 * spotJitter, now + 0.045);

      const clackFilter = audioCtx.createBiquadFilter();
      clackFilter.type = "lowpass";
      clackFilter.frequency.setValueAtTime(lpClamp, now);
      clackFilter.Q.setValueAtTime(2.1, now);

      const gain1 = audioCtx.createGain();
      gain1.gain.setValueAtTime(0.0001, now);
      gain1.gain.linearRampToValueAtTime(0.34, now + 0.0035);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

      const gain2 = audioCtx.createGain();
      gain2.gain.setValueAtTime(0.0001, now);
      gain2.gain.linearRampToValueAtTime(0.12, now + 0.0025);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(clackFilter);
      gain2.connect(clackFilter);
      clackFilter.connect(clackBus);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.15);
      osc2.stop(now + 0.065);

      // 3. 竹筒倾水涌流包络 + 非均匀 Rubato 散落水花（告别原 i * 38ms 等距连发气泡）
      if (buf) {
        const pourTime = now + 0.055;
        const pourDur = 0.24 + Math.random() * 0.10;
        const pourSrc = audioCtx.createBufferSource();
        pourSrc.buffer = buf;
        const pourBp = audioCtx.createBiquadFilter();
        pourBp.type = "bandpass";
        pourBp.frequency.setValueAtTime(340, pourTime);
        pourBp.frequency.exponentialRampToValueAtTime(620, pourTime + pourDur * 0.4);
        pourBp.frequency.exponentialRampToValueAtTime(280, pourTime + pourDur);
        pourBp.Q.setValueAtTime(1.4, pourTime);
        const pourGain = audioCtx.createGain();
        pourGain.gain.setValueAtTime(0.0001, pourTime);
        pourGain.gain.linearRampToValueAtTime(0.22, pourTime + 0.045);
        pourGain.gain.exponentialRampToValueAtTime(0.0001, pourTime + pourDur);
        pourSrc.connect(pourBp);
        pourBp.connect(pourGain);
        pourGain.connect(clackBus);
        pourSrc.start(pourTime, Math.random() * 2.0);
        pourSrc.stop(pourTime + pourDur + 0.02);
      }

      const splashOffsets = [75 + Math.random() * 25, 145 + Math.random() * 40, 245 + Math.random() * 65];
      splashOffsets.forEach((delayMs, idx) => {
        scheduleSubTimer(() => {
          if (state.isPlaying && state.activeCategory === "water") {
            const splashAz = 0.14 + (Math.random() * 0.38 - 0.19);
            const splashVel = (0.92 - idx * 0.18) * (0.88 + Math.random() * 0.22);
            const variant = idx === 1 && Math.random() < 0.6 ? "bubble" : (idx === 0 ? "riffle" : "droplet");
            triggerWaterBubble(splashAz, splashVel, variant);
          }
        }, delayMs);
      });

      createWaterVisualEvent(az, 0.95, 220, true, "clack");

      const nextInterval = 11000 + Math.random() * 5500;
      shishiTimerId = setTimeout(scheduleNextShishiOdoshi, nextInterval);
    }

    // --------------------------------------------------------------------------
    // B5. 能量泛音与音疗钵铃声物理声学合成核心 (Bowls & Healing Chimes Engine)
    //     程序化去电子味重构：物理敲槌软冲击/箱体谐振、非对称钵壁微偏频、动态泛音倾斜与真人微律动
    // --------------------------------------------------------------------------
    function triggerBowlStrike(azimuthOverride = null, velScale = 1.0, pitchShift = 1.0, modeOverride = null, isSecondary = false) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "bowls") return;

      const inst = BOWLS_INSTRUMENTS[state.currentBowlInst];
      const style = BOWLS_STYLES[state.currentBowlStyle];
      const playMode = modeOverride || (style ? style.mode : "strike");
      const now = scope.time();
      const totalDecay = Math.max(2.0, inst.baseDecay * state.bowlDecayMultiplier);

      let azimuth = 0;
      if (azimuthOverride !== null) {
        azimuth = azimuthOverride * state.stereoWidth;
      } else {
        azimuth = (state.bowlEarSide * (0.45 + Math.random() * 0.35)) * state.stereoWidth;
      }

      const effectiveCutoff = Math.min(state.userLowpass, inst.warmthCutoff * (0.65 + (1 - state.bowlWarmth) * 0.7));

      // 模式 A：432Hz 音叉 或 任意器皿处于「双耳慢波共振 (binauralbeat)」模式 —— 真正左右耳 6Hz Theta 频差驻波
      if (state.currentBowlInst === "tuningfork" || playMode === "binauralbeat") {
        const baseF = (inst.chimeScale ? inst.baseFreq : inst.baseFreq) * pitchShift;
        const diff = (inst.binauralDiff || 6.0); // 6Hz Theta 睡眠脑波诱导频差
        const fL = baseF;
        const fR = baseF + diff;
        const isContinuousBeat = playMode === "binauralbeat";
        const attack = isContinuousBeat ? 1.4 : 0.018;
        const dur = isContinuousBeat ? Math.max(8.5, totalDecay * 0.85) : totalDecay;

        // 432Hz 音叉单叩时添加橡胶激活垫/羊毛毡槌真实物理触击瞬态
        if (!isContinuousBeat) {
          const tapOsc = audioCtx.createOscillator();
          tapOsc.type = "sine";
          tapOsc.frequency.setValueAtTime(280, now);
          tapOsc.frequency.exponentialRampToValueAtTime(115, now + 0.024);

          const tapGain = audioCtx.createGain();
          tapGain.gain.setValueAtTime(0.0001, now);
          tapGain.gain.linearRampToValueAtTime(0.16 * velScale, now + 0.003);
          tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

          tapOsc.connect(tapGain);
          connectTo3DioStage(tapGain, azimuth * 0.3, now);
          tapOsc.start(now);
          tapOsc.stop(now + 0.04);

          // 柔和毛毡接触气流微噗 (Contact Noise Puff)
          const buf = getFrictionNoiseBuffer();
          if (buf) {
            const puffSrc = audioCtx.createBufferSource();
            puffSrc.buffer = buf;
            const puffBp = audioCtx.createBiquadFilter();
            puffBp.type = "bandpass";
            puffBp.frequency.setValueAtTime(420, now);
            puffBp.Q.setValueAtTime(2.2, now);
            const puffGain = audioCtx.createGain();
            puffGain.gain.setValueAtTime(0.0001, now);
            puffGain.gain.linearRampToValueAtTime(0.07 * velScale, now + 0.002);
            puffGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.016);
            puffSrc.connect(puffBp);
            puffBp.connect(puffGain);
            connectTo3DioStage(puffGain, azimuth * 0.25, now);
            puffSrc.start(now, Math.random() * 2.0);
            puffSrc.stop(now + 0.02);
          }
        }

        // Theta 脑波呼吸式微波幅起伏 (消除机械冻结感)
        const thetaBreath = isContinuousBeat ? (0.88 + 0.18 * (0.5 + 0.5 * Math.sin(continuousModPhase * 0.24))) : 1.0;
        const peak = (isContinuousBeat ? 0.24 : 0.30) * velScale * thetaBreath;

        const oscL = audioCtx.createOscillator();
        const oscR = audioCtx.createOscillator();
        oscL.type = "sine";
        oscR.type = "sine";
        oscL.frequency.setValueAtTime(fL, now);
        oscR.frequency.setValueAtTime(fR, now);

        const gainL = audioCtx.createGain();
        const gainR = audioCtx.createGain();

        gainL.gain.setValueAtTime(0.0001, now);
        gainL.gain.linearRampToValueAtTime(peak, now + attack);
        gainL.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        gainR.gain.setValueAtTime(0.0001, now);
        gainR.gain.linearRampToValueAtTime(peak, now + attack);
        gainR.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        oscL.connect(gainL);
        oscR.connect(gainR);

        // 双耳空间微摆动 (Subtle Binaural Spatial Sway)
        const panDrift = isContinuousBeat ? (0.06 * Math.sin(continuousModPhase * 0.18)) : 0;
        connectTo3DioStage(gainL, Math.max(-0.95, -0.85 + panDrift) * state.stereoWidth, now);
        connectTo3DioStage(gainR, Math.min(0.95, 0.85 + panDrift) * state.stereoWidth, now);

        oscL.start(now);
        oscR.start(now);
        oscL.stop(now + dur + 0.1);
        oscR.stop(now + dur + 0.1);

        createBowlVisualEvent(0, velScale, baseF);
        return;
      }

      // 模式 B：颂钵 / 水晶钵 / 碰铃 / 柯西风铃 / 晨钟 / 钢舌鼓 / 拇指琴
      let baseF;
      if (inst.chimeScale) {
        // 避免连续触发同一颗风铃管或钢舌鼓音瓣，保持声学灵动性
        const scaleLen = inst.chimeScale.length;
        let pickIdx = Math.floor(Math.random() * scaleLen);
        const lastIdx = Math.round(state.bowlLastPitchNorm * (scaleLen - 1));
        if (pickIdx === lastIdx && scaleLen > 1) {
          pickIdx = (pickIdx + 1 + Math.floor(Math.random() * (scaleLen - 1))) % scaleLen;
        }
        state.bowlLastPitchNorm = pickIdx / (scaleLen - 1);
        baseF = inst.chimeScale[pickIdx] * pitchShift;
      } else {
        // 手工铜钵与古钟非对称钵壁微偏频 (±0.7% Rim Asymmetry Micro-Detuning)
        const strikeDetune = 0.993 + Math.random() * 0.014;
        baseF = inst.baseFreq * pitchShift * strikeDetune;
      }

      const isRimRub = (playMode === "rim");

      const sharedFilter = audioCtx.createBiquadFilter();
      sharedFilter.type = "lowpass";
      sharedFilter.frequency.setValueAtTime(effectiveCutoff, now);
      sharedFilter.Q.setValueAtTime(1.4, now);

      const panner = connectTo3DioStage(sharedFilter, azimuth, now);
      if (panner && isRimRub) {
        // 双耳环磨颂唱：声像沿 3Dio 双耳圆周平滑环绕迁移 (时长与转速微律动解耦)
        panner.pan.linearRampToValueAtTime(-azimuth, now + 4.2 / (state.bowlRimSpeedWalk || 1.0));
      }

      // 实体器皿激发瞬态 (Physical Mallet / Contact Excitation Acoustics)
      if (!isRimRub) {
        if (state.currentBowlInst === "wood_kalimba") {
          // 相思木拇指琴：指甲拨动弹片微声 (1650Hz 窄带微触) + 温暖木盒空气谐振 (220Hz->160Hz)
          const buf = getFrictionNoiseBuffer();
          if (buf) {
            const nailSrc = audioCtx.createBufferSource();
            nailSrc.buffer = buf;
            const nailBp = audioCtx.createBiquadFilter();
            nailBp.type = "bandpass";
            nailBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 1650 + Math.random() * 240), now);
            nailBp.Q.setValueAtTime(3.2, now);
            const nailGain = audioCtx.createGain();
            nailGain.gain.setValueAtTime(0.0001, now);
            nailGain.gain.linearRampToValueAtTime(0.12 * velScale, now + 0.002);
            nailGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.014);
            nailSrc.connect(nailBp);
            nailBp.connect(nailGain);
            nailGain.connect(sharedFilter);
            nailSrc.start(now, Math.random() * 2.0);
            nailSrc.stop(now + 0.02);
          }

          const boxOsc = audioCtx.createOscillator();
          boxOsc.type = "sine";
          boxOsc.frequency.setValueAtTime(235 * (0.96 + Math.random() * 0.08), now);
          boxOsc.frequency.exponentialRampToValueAtTime(165, now + 0.045);
          const boxGain = audioCtx.createGain();
          boxGain.gain.setValueAtTime(0.0001, now);
          boxGain.gain.linearRampToValueAtTime(0.22 * velScale, now + 0.003);
          boxGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
          boxOsc.connect(boxGain);
          boxGain.connect(sharedFilter);
          boxOsc.start(now);
          boxOsc.stop(now + 0.06);

        } else if (state.currentBowlInst === "tingsha") {
          // 纯铜双面碰铃：初始双铃对击脆响瞬态 (3100Hz 窄带极短微咬合) + 羊皮系绳微阻尼
          const buf = getFrictionNoiseBuffer();
          if (buf) {
            const clinkSrc = audioCtx.createBufferSource();
            clinkSrc.buffer = buf;
            const clinkBp = audioCtx.createBiquadFilter();
            clinkBp.type = "bandpass";
            clinkBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 3100 + Math.random() * 320), now);
            clinkBp.Q.setValueAtTime(4.5, now);
            const clinkGain = audioCtx.createGain();
            clinkGain.gain.setValueAtTime(0.0001, now);
            clinkGain.gain.linearRampToValueAtTime(0.25 * velScale * (1 - state.bowlWarmth * 0.35), now + 0.0015);
            clinkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.011);
            clinkSrc.connect(clinkBp);
            clinkBp.connect(clinkGain);
            clinkGain.connect(sharedFilter);
            clinkSrc.start(now, Math.random() * 2.0);
            clinkSrc.stop(now + 0.015);
          }

        } else if (state.currentBowlInst === "crystal") {
          // 水晶石英钵：软硅胶/麂皮槌触钵柔化上升沿，零硬直角破音
          // (纯正圆润水晶谐振自然展开)

        } else if (state.currentBowlInst === "tibetan" || state.currentBowlInst === "temple_bell" || state.currentBowlInst === "steel_tongue") {
          // 颂钵/晨钟/钢舌鼓：软羊皮木槌/橡胶槌深沉触击钝音 + 毛毡触碰微扑声
          const malletOsc = audioCtx.createOscillator();
          malletOsc.type = "sine";
          const mFreq = (state.currentBowlInst === "temple_bell" ? 88 : 138) * (0.92 + Math.random() * 0.16);
          malletOsc.frequency.setValueAtTime(mFreq, now);
          malletOsc.frequency.exponentialRampToValueAtTime(mFreq * 0.48, now + 0.034);
          const malletGain = audioCtx.createGain();
          malletGain.gain.setValueAtTime(0.0001, now);
          malletGain.gain.linearRampToValueAtTime(0.20 * velScale, now + 0.0035);
          malletGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);
          malletOsc.connect(malletGain);
          malletGain.connect(sharedFilter);
          malletOsc.start(now);
          malletOsc.stop(now + 0.045);

          const buf = getFrictionNoiseBuffer();
          if (buf) {
            const puffSrc = audioCtx.createBufferSource();
            puffSrc.buffer = buf;
            const puffBp = audioCtx.createBiquadFilter();
            puffBp.type = "bandpass";
            puffBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 480 + Math.random() * 120), now);
            puffBp.Q.setValueAtTime(1.8, now);
            const puffGain = audioCtx.createGain();
            puffGain.gain.setValueAtTime(0.0001, now);
            puffGain.gain.linearRampToValueAtTime(0.11 * velScale, now + 0.003);
            puffGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
            puffSrc.connect(puffBp);
            puffBp.connect(puffGain);
            puffGain.connect(sharedFilter);
            puffSrc.start(now, Math.random() * 2.0);
            puffSrc.stop(now + 0.024);
          }
        }
      } else {
        // 环磨模式专属：桃木棒沿铜钵/水晶钵边缘摩擦的温润木质沙沙驻波底韵 (压力随机游走耦合)
        const buf = getFrictionNoiseBuffer();
        if (buf) {
          const rubSrc = audioCtx.createBufferSource();
          rubSrc.buffer = buf;
          rubSrc.loop = true;
          const rubBp = audioCtx.createBiquadFilter();
          rubBp.type = "bandpass";
          const rubF = Math.min(effectiveCutoff, baseF * 1.35 * (state.bowlRimPressureWalk || 1.0));
          rubBp.frequency.setValueAtTime(rubF, now);
          rubBp.Q.setValueAtTime(3.8, now);
          const rubGain = audioCtx.createGain();
          rubGain.gain.setValueAtTime(0.0001, now);
          rubGain.gain.linearRampToValueAtTime(0.055 * velScale * (state.bowlRimPressureWalk || 1.0), now + 1.4);
          rubGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.4);
          rubSrc.connect(rubBp);
          rubBp.connect(rubGain);
          rubGain.connect(sharedFilter);
          rubSrc.start(now, Math.random() * 2.0);
          rubSrc.stop(now + 4.5);
        }
      }

      inst.harmonics.forEach((h, idx) => {
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        // 非谐模态微抖动 (物理铸造微观非均匀性)
        const modeJitter = 0.998 + Math.random() * 0.004;
        const hFreq = baseF * h.ratio * modeJitter;
        osc.frequency.setValueAtTime(hFreq, now);

        const hGain = audioCtx.createGain();
        // 动态频谱倾斜：敲击力度越大，高阶金属泛音兴奋度超线性上升；轻敲以基频温润低泛音为主
        const harmonicVelScale = Math.pow(velScale, 0.85 + idx * 0.35);
        const peak = (isRimRub ? 0.22 : 0.28) * h.gain * harmonicVelScale;
        // 环磨模式采用 1.4s 呼吸式涌现；单叩模式采用软上升沿防破音
        const attack = isRimRub ? (1.35 + idx * 0.22) : (0.012 + idx * 0.004);
        const decay = isRimRub ? Math.max(4.6, totalDecay * 0.48) : (totalDecay * h.decayMul);

        hGain.gain.setValueAtTime(0.0001, now);
        hGain.gain.linearRampToValueAtTime(peak, now + attack);
        hGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

        osc.connect(hGain);
        hGain.connect(sharedFilter);

        osc.start(now);
        osc.stop(now + decay + 0.1);

        // 环唱拍频 (beatFreq)：生成微偏正弦振荡器模拟真实手工铜钵壁厚不均带来的自然嗡鸣脉动
        if (inst.beatFreq && idx === 0) {
          const oscBeat = audioCtx.createOscillator();
          oscBeat.type = "sine";
          const beatJitter = inst.beatFreq * (0.95 + Math.random() * 0.1);
          oscBeat.frequency.setValueAtTime(hFreq + beatJitter, now);

          const beatGain = audioCtx.createGain();
          beatGain.gain.setValueAtTime(0.0001, now);
          beatGain.gain.linearRampToValueAtTime(peak * 0.85, now + attack);
          beatGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

          oscBeat.connect(beatGain);
          beatGain.connect(sharedFilter);

          oscBeat.start(now);
          oscBeat.stop(now + decay + 0.1);
        }
      });

      createBowlVisualEvent(azimuth, velScale, baseF);
    }

    function scheduleNextBowlEvent() {
      if (!state.isPlaying || state.activeCategory !== "bowls") return;

      const style = BOWLS_STYLES[state.currentBowlStyle];

      if (style.mode === "rim") {
        // 钵缘 360° 连续环磨颂唱 (结合手腕转速微律动与压力均值回归游走)
        state.bowlRimPressureWalk = Math.max(0.78, Math.min(1.22, (state.bowlRimPressureWalk || 1.0) * 0.85 + (0.8 + Math.random() * 0.4) * 0.15));
        state.bowlRimSpeedWalk = Math.max(0.85, Math.min(1.15, (state.bowlRimSpeedWalk || 1.0) * 0.88 + (0.85 + Math.random() * 0.3) * 0.12));
        const dAngle = 0.82 + 0.28 * state.bowlRimSpeedWalk;
        bowlRimPhase += dAngle;

        const az = Math.sin(bowlRimPhase) * (0.72 + 0.14 * Math.cos(bowlRimPhase * 0.5)) * state.stereoWidth;
        triggerBowlStrike(az, 0.72 + 0.16 * state.bowlRimPressureWalk, 1.0, "rim");
        const nextDelay = (2800 + Math.random() * 600) / state.bowlRimSpeedWalk;
        bowlTimerId = setTimeout(scheduleNextBowlEvent, nextDelay);

      } else if (style.mode === "breeze") {
        // 微风偶发随拂风铃：微风掠过风铃阵，在局部空间激起 2~3 颗错落相碰的微风簇 (Poisson Chime Cluster)
        const az = (Math.random() * 1.6 - 0.8) * state.stereoWidth;
        triggerBowlStrike(az, 0.65 + Math.random() * 0.40, 1.0, "breeze");

        const subHits = Math.random() < 0.65 ? (Math.random() < 0.45 ? 2 : 1) : 0;
        for (let s = 1; s <= subHits; s++) {
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "bowls") {
              const subAz = Math.max(-0.95, Math.min(0.95, az + (Math.random() * 0.36 - 0.18)));
              triggerBowlStrike(subAz, 0.48 + Math.random() * 0.35, 1.0, "breeze");
            }
          }, s * (120 + Math.random() * 160));
        }

        const nextDelay = 2200 + Math.random() * 2600;
        bowlTimerId = setTimeout(scheduleNextBowlEvent, nextDelay);

      } else if (style.mode === "binauralbeat") {
        // 双耳慢波律动 (6Hz Theta 深度催眠持续交叠，平缓呼吸间隔)
        triggerBowlStrike(0, 0.88 + Math.random() * 0.15, 1.0, "binauralbeat");
        const nextDelay = 6400 + Math.random() * 1800;
        bowlTimerId = setTimeout(scheduleNextBowlEvent, nextDelay);

      } else {
        // 悠缓单叩 (single)：模拟声音疗愈师自然呼吸节奏、单侧耳畔温存驻留与轻柔二次微叩
        state.bowlDensityWalk = Math.max(0.75, Math.min(1.35, (state.bowlDensityWalk || 1.0) * 0.86 + (0.8 + Math.random() * 0.4) * 0.14));
        state.bowlPhraseRemaining = (state.bowlPhraseRemaining || 3) - 1;
        if (state.bowlPhraseRemaining <= 0) {
          state.bowlEarSide = -(state.bowlEarSide || -0.65);
          state.bowlPhraseRemaining = 2 + Math.floor(Math.random() * 3);
        }

        const az = (state.bowlEarSide || -0.65) * (0.45 + Math.random() * 0.35);
        const vel = 0.84 + Math.random() * 0.22;
        triggerBowlStrike(az, vel, 1.0, "strike");

        // 22% 概率激发疗愈师羊毛毡槌轻触回弹二次微响 (Grace Touch-Up Strike)
        if (Math.random() < 0.22) {
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "bowls") {
              triggerBowlStrike(az + (Math.random() * 0.16 - 0.08), vel * 0.45, 1.0, "strike", true);
            }
          }, 220 + Math.random() * 180);
        }

        const nextDelay = (style.baseInterval || 10500) * state.bowlDensityWalk;
        bowlTimerId = setTimeout(scheduleNextBowlEvent, nextDelay);
      }
    }

    // --------------------------------------------------------------------------
    // B6. 伴读工具与微机械声物理声学合成核心 (Tools & Grooming Synthesizer Engine)
    //     程序化去同质化重构：发丝剪切微瞬态、加速木梳梳理、铅笔排线簇、打字机行末回车机构与单耳近距驻留
    // --------------------------------------------------------------------------
    function triggerToolEvent(azimuthOverride = null, velScale = 1.0) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "tools") return;

      const inst = TOOLS_INSTRUMENTS[state.currentToolInst];
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      let azimuth = 0;
      if (azimuthOverride !== null) {
        azimuth = azimuthOverride * state.stereoWidth;
      } else {
        azimuth = ((state.toolHandSide || -0.75) * (0.68 + Math.random() * 0.26)) * state.stereoWidth;
      }

      const effectiveCutoff = Math.min(state.userLowpass, inst.warmthCutoff * (0.7 + (1 - state.toolWarmth) * 0.6));
      const toolBus = audioCtx.createGain();
      toolBus.gain.setValueAtTime(1.0, now);
      const panner = connectTo3DioStage(toolBus, azimuth, now);

      if (state.currentToolInst === "music_box") {
        // 发条黄铜八音盒：发条节拍微律动 (Spring Governor Flutter) + 精钢音梳主泛音 + 胡桃木底座温暖共鸣 + 偶发和弦叠音
        state.toolMusicBoxTempoWalk = Math.max(0.96, Math.min(1.04, (state.toolMusicBoxTempoWalk || 1.0) * 0.92 + (0.97 + Math.random() * 0.06) * 0.08));

        const lullabyMelody = [
          523.25, 659.25, 783.99, 1046.50, 880.00, 783.99, 659.25, 587.33,
          523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 392.00
        ];
        const pitch = lullabyMelody[toolMusicBoxStep % lullabyMelody.length];
        toolMusicBoxStep++;

        // 滚筒钢针拨动音梳力度微随机 (Pin Velocity Variance)
        const noteVel = velScale * (0.86 + Math.random() * 0.28);

        // 1) 精钢音梳主泛音与高次金属微泛音
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        osc1.type = "sine";
        osc2.type = "sine";
        osc1.frequency.setValueAtTime(pitch, now);
        osc2.frequency.setValueAtTime(Math.min(effectiveCutoff * 1.2, pitch * 3.92), now);

        const gain1 = audioCtx.createGain();
        gain1.gain.setValueAtTime(0.0001, now);
        gain1.gain.linearRampToValueAtTime(0.24 * noteVel, now + 0.003);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);

        const gain2 = audioCtx.createGain();
        gain2.gain.setValueAtTime(0.0001, now);
        gain2.gain.linearRampToValueAtTime(0.055 * noteVel * (1 - state.toolWarmth * 0.5), now + 0.0018);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

        // 2) 八音盒胡桃木底座温暖箱体共鸣 (~260Hz)
        const boxOsc = audioCtx.createOscillator();
        boxOsc.type = "sine";
        boxOsc.frequency.setValueAtTime(265 * (0.96 + Math.random() * 0.08), now);
        boxOsc.frequency.exponentialRampToValueAtTime(175, now + 0.032);
        const boxGain = audioCtx.createGain();
        boxGain.gain.setValueAtTime(0.0001, now);
        boxGain.gain.linearRampToValueAtTime(0.11 * noteVel, now + 0.003);
        boxGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

        // 3) 铜齿拨动簧片微机械接触声
        const clickSrc = audioCtx.createBufferSource();
        clickSrc.buffer = buf;
        const clickBp = audioCtx.createBiquadFilter();
        clickBp.type = "bandpass";
        clickBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 1350 + Math.random() * 150), now);
        clickBp.Q.setValueAtTime(3.6, now);
        const clickGain = audioCtx.createGain();
        clickGain.gain.setValueAtTime(0.0001, now);
        clickGain.gain.linearRampToValueAtTime(0.09 * noteVel, now + 0.002);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.011);

        osc1.connect(gain1);
        osc2.connect(gain2);
        boxOsc.connect(boxGain);
        clickSrc.connect(clickBp);
        clickBp.connect(clickGain);

        gain1.connect(toolBus);
        gain2.connect(toolBus);
        boxGain.connect(toolBus);
        clickGain.connect(toolBus);

        osc1.start(now);
        osc2.start(now);
        boxOsc.start(now);
        osc1.stop(now + 1.0);
        osc2.stop(now + 0.055);
        boxOsc.stop(now + 0.045);
        clickSrc.start(now, Math.random() * 2.0);
        clickSrc.stop(now + 0.016);

        // 18% 概率激发双齿和弦叠音 (Dual-Tine Harmonic Chime)
        if (Math.random() < 0.18) {
          const chordPitch = pitch * (Math.random() < 0.5 ? 1.5 : 1.25);
          if (chordPitch < 1600) {
            const chordOsc = audioCtx.createOscillator();
            chordOsc.type = "sine";
            chordOsc.frequency.setValueAtTime(chordPitch, now + 0.014);
            const chordGain = audioCtx.createGain();
            chordGain.gain.setValueAtTime(0.0001, now + 0.014);
            chordGain.gain.linearRampToValueAtTime(0.14 * noteVel, now + 0.017);
            chordGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
            chordOsc.connect(chordGain);
            chordGain.connect(toolBus);
            chordOsc.start(now + 0.014);
            chordOsc.stop(now + 0.85);
          }
        }

        createToolVisualEvent("music_box", azimuth, velScale);

      } else if (state.currentToolInst === "sandalwood_fan") {
        // 檀香木折扇：竹木扇骨微弹咬合 + 扇面掠耳微风气流起伏
        const airDur = 0.32 + Math.random() * 0.22;
        const snapOsc = audioCtx.createOscillator();
        snapOsc.type = "sine";
        snapOsc.frequency.setValueAtTime(280 * (0.94 + Math.random() * 0.12), now);
        snapOsc.frequency.exponentialRampToValueAtTime(92, now + 0.032);

        const snapGain = audioCtx.createGain();
        snapGain.gain.setValueAtTime(0.0001, now);
        snapGain.gain.linearRampToValueAtTime(0.30 * velScale, now + 0.003);
        snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

        const airSrc = audioCtx.createBufferSource();
        airSrc.buffer = buf;
        const airBp = audioCtx.createBiquadFilter();
        airBp.type = "lowpass";
        const startAirF = Math.min(effectiveCutoff, 280 + Math.random() * 80);
        airBp.frequency.setValueAtTime(startAirF, now);
        airBp.frequency.exponentialRampToValueAtTime(Math.min(effectiveCutoff, 580), now + airDur * 0.35);
        airBp.frequency.exponentialRampToValueAtTime(170, now + airDur);
        airBp.Q.setValueAtTime(1.2, now);

        const airGain = audioCtx.createGain();
        airGain.gain.setValueAtTime(0.0001, now);
        airGain.gain.linearRampToValueAtTime(0.28 * velScale, now + airDur * 0.28);
        airGain.gain.exponentialRampToValueAtTime(0.0001, now + airDur);

        snapOsc.connect(snapGain);
        airSrc.connect(airBp);
        airBp.connect(airGain);
        snapGain.connect(toolBus);
        airGain.connect(toolBus);

        snapOsc.start(now);
        snapOsc.stop(now + 0.045);
        airSrc.start(now, Math.random() * 2.0);
        airSrc.stop(now + airDur + 0.02);

        createToolVisualEvent("sandalwood_fan", azimuth, velScale);

      } else if (state.currentToolInst === "fountain_pen") {
        // 金尖钢笔棉纸划写：起笔下压、连笔滑行与提笔轻划的运笔压力起伏 (Calligraphic Stroke Flow)
        const strokeCount = 2 + Math.floor(Math.random() * 3);
        let timeCursor = now;
        for (let i = 0; i < strokeCount; i++) {
          const isDownstroke = (i % 2 === 0);
          const strokeDur = isDownstroke ? (0.065 + Math.random() * 0.055) : (0.045 + Math.random() * 0.040);
          const src = audioCtx.createBufferSource();
          src.buffer = buf;

          const bp = audioCtx.createBiquadFilter();
          bp.type = "bandpass";
          // 下笔重压阻尼偏低频(墨水饱满)，提笔轻带偏高频(笔尖划纸微沙)
          const startF = Math.min(effectiveCutoff, (isDownstroke ? 780 : 1100) + Math.random() * 260);
          bp.frequency.setValueAtTime(startF, timeCursor);
          bp.frequency.linearRampToValueAtTime(startF * (isDownstroke ? 1.15 : 0.88), timeCursor + strokeDur);
          bp.Q.setValueAtTime(2.4, timeCursor);

          const gain = audioCtx.createGain();
          const strokeVel = velScale * (isDownstroke ? (0.24 + Math.random() * 0.08) : (0.16 + Math.random() * 0.06));
          gain.gain.setValueAtTime(0.0001, timeCursor);
          gain.gain.linearRampToValueAtTime(strokeVel, timeCursor + 0.007);
          gain.gain.exponentialRampToValueAtTime(0.0001, timeCursor + strokeDur);

          src.connect(bp);
          bp.connect(gain);
          gain.connect(toolBus);

          src.start(timeCursor, Math.random() * 2.5);
          src.stop(timeCursor + strokeDur + 0.01);
          timeCursor += strokeDur + 0.016 + Math.random() * 0.024;
        }

        createToolVisualEvent("fountain_pen", azimuth, velScale);

      } else if (state.currentToolInst === "scissors") {
        // 1. 锋利理发轻剪：真实双刃滑移剪切 + 发丝剪切 ASMR 微瞬态 (Hair Fiber Snaps) + 硅胶静音垫缓冲
        const shearDur = 0.050 + Math.random() * 0.032; // 50ms ~ 82ms 动态剪切时长
        const src = audioCtx.createBufferSource();
        src.buffer = buf;

        // 双刃滑移剪切摩擦 (Blade Sliding Shear: 1350Hz -> 2300Hz 窄带快速滑擦)
        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        const startShearF = Math.min(effectiveCutoff, 1350 + Math.random() * 260);
        bp.frequency.setValueAtTime(startShearF, now);
        bp.frequency.exponentialRampToValueAtTime(Math.min(effectiveCutoff, 2350), now + shearDur);
        bp.Q.setValueAtTime(3.8, now);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(effectiveCutoff, now);

        const gain = audioCtx.createGain();
        const peak = (0.30 + Math.random() * 0.08) * velScale;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + shearDur);

        // 发丝剪切微瞬态 (1~3 根干燥发丝受刃咬合脆断微瞬态，极具 ASMR 采耳理发沉浸感)
        const hairCutCount = 1 + Math.floor(Math.random() * 3);
        for (let h = 0; h < hairCutCount; h++) {
          const hTime = now + 0.016 + (h * 0.011) + Math.random() * 0.006;
          const hSrc = audioCtx.createBufferSource();
          hSrc.buffer = buf;
          const hBp = audioCtx.createBiquadFilter();
          hBp.type = "bandpass";
          hBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 2600 + Math.random() * 1100), hTime);
          hBp.Q.setValueAtTime(4.6, hTime);
          const hGain = audioCtx.createGain();
          hGain.gain.setValueAtTime(0.0001, hTime);
          hGain.gain.linearRampToValueAtTime(0.14 * velScale * (1 - state.toolWarmth * 0.35), hTime + 0.0012);
          hGain.gain.exponentialRampToValueAtTime(0.0001, hTime + 0.0065);
          hSrc.connect(hBp);
          hBp.connect(hGain);
          hGain.connect(toolBus);
          hSrc.start(hTime, Math.random() * 2.5);
          hSrc.stop(hTime + 0.01);
        }

        // 剪刀手柄橡胶防撞垫软触微顿 (Silicone Bumper Cushion Stop ~240Hz->92Hz, 12ms)
        const closeTime = now + shearDur * 0.65;
        const bumperOsc = audioCtx.createOscillator();
        bumperOsc.type = "sine";
        bumperOsc.frequency.setValueAtTime(240 * (0.95 + Math.random() * 0.1), closeTime);
        bumperOsc.frequency.exponentialRampToValueAtTime(92, closeTime + 0.014);

        const bumperGain = audioCtx.createGain();
        bumperGain.gain.setValueAtTime(0.0001, closeTime);
        bumperGain.gain.linearRampToValueAtTime(0.18 * velScale, closeTime + 0.002);
        bumperGain.gain.exponentialRampToValueAtTime(0.0001, closeTime + 0.016);

        // 刀尖极短微咬合瞬态 (8ms 极速衰减，绝无长尾正弦电子音)
        const tipSrc = audioCtx.createBufferSource();
        tipSrc.buffer = buf;
        const tipBp = audioCtx.createBiquadFilter();
        tipBp.type = "bandpass";
        tipBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 1950 + Math.random() * 200), closeTime);
        tipBp.Q.setValueAtTime(5.2, closeTime);
        const tipGain = audioCtx.createGain();
        tipGain.gain.setValueAtTime(0.0001, closeTime);
        tipGain.gain.linearRampToValueAtTime(0.22 * velScale * (1 - state.toolWarmth * 0.4), closeTime + 0.0015);
        tipGain.gain.exponentialRampToValueAtTime(0.0001, closeTime + 0.009);

        src.connect(bp);
        bp.connect(lpf);
        lpf.connect(gain);
        bumperOsc.connect(bumperGain);
        tipSrc.connect(tipBp);
        tipBp.connect(tipGain);

        gain.connect(toolBus);
        bumperGain.connect(toolBus);
        tipGain.connect(toolBus);

        src.start(now, Math.random() * 2.5);
        src.stop(now + shearDur + 0.01);
        bumperOsc.start(closeTime);
        bumperOsc.stop(closeTime + 0.02);
        tipSrc.start(closeTime, Math.random() * 2.5);
        tipSrc.stop(closeTime + 0.012);

        createToolVisualEvent("scissors", azimuth, velScale);

      } else if (state.currentToolInst === "comb") {
        // 2. 密齿木梳：手腕加速梳过发丝 (Wrist Acceleration Rubato) + 齿间微频梯队 + 发丝柔顺滑移底声
        const totalStrokeDur = 0.16 + Math.random() * 0.09;
        const tickCount = 6 + Math.floor(Math.random() * 4);

        // 发丝轻微沙沙摩擦底层
        const hairSwishSrc = audioCtx.createBufferSource();
        hairSwishSrc.buffer = buf;
        const hairBp = audioCtx.createBiquadFilter();
        hairBp.type = "bandpass";
        hairBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 480), now);
        hairBp.Q.setValueAtTime(1.5, now);
        const hairGain = audioCtx.createGain();
        hairGain.gain.setValueAtTime(0.0001, now);
        hairGain.gain.linearRampToValueAtTime(0.08 * velScale, now + totalStrokeDur * 0.35);
        hairGain.gain.exponentialRampToValueAtTime(0.0001, now + totalStrokeDur);
        hairSwishSrc.connect(hairBp);
        hairBp.connect(hairGain);
        hairGain.connect(toolBus);
        hairSwishSrc.start(now, Math.random() * 2.5);
        hairSwishSrc.stop(now + totalStrokeDur + 0.02);

        // 木梳细齿连环弹动 (非等距时间，随手腕自然加速)
        for (let i = 0; i < tickCount; i++) {
          const tickNorm = i / Math.max(1, tickCount - 1);
          const tickTime = now + Math.pow(tickNorm, 1.25) * totalStrokeDur;
          const tickSrc = audioCtx.createBufferSource();
          tickSrc.buffer = buf;

          const bp = audioCtx.createBiquadFilter();
          bp.type = "bandpass";
          // 随发束阻尼与梳齿锥度产生音高微梯度 (1150Hz -> 1650Hz)
          const toothFreq = Math.min(effectiveCutoff, 1150 + tickNorm * 420 + (Math.random() * 120 - 60));
          bp.frequency.setValueAtTime(toothFreq, tickTime);
          bp.Q.setValueAtTime(3.2, tickTime);

          const lpf = audioCtx.createBiquadFilter();
          lpf.type = "lowpass";
          lpf.frequency.setValueAtTime(effectiveCutoff, tickTime);

          const gain = audioCtx.createGain();
          const tickPeak = (0.22 + Math.random() * 0.14) * velScale;
          gain.gain.setValueAtTime(0.0001, tickTime);
          gain.gain.linearRampToValueAtTime(tickPeak, tickTime + 0.0025);
          gain.gain.exponentialRampToValueAtTime(0.0001, tickTime + 0.015);

          tickSrc.connect(bp);
          bp.connect(lpf);
          lpf.connect(gain);
          gain.connect(toolBus);

          tickSrc.start(tickTime, Math.random() * 2.5);
          tickSrc.stop(tickTime + 0.02);
        }
        createToolVisualEvent("comb", azimuth, velScale);

      } else if (state.currentToolInst === "pencil") {
        // 3. 棉纸素描铅笔：素描排线连击簇 (Hatching Stroke Cluster) + 重质 4B 石墨划线阻尼感 + 手腕角度微漂移
        const strokeCount = 2 + Math.floor(Math.random() * 3);
        let timeCursor = now;
        for (let s = 0; s < strokeCount; s++) {
          const isPush = (s % 2 === 0);
          const strokeDur = 0.075 + Math.random() * 0.065;
          const src = audioCtx.createBufferSource();
          src.buffer = buf;
          src.loop = true;

          const bp = audioCtx.createBiquadFilter();
          bp.type = "bandpass";
          const startF = Math.min(effectiveCutoff, (isPush ? 880 : 1080) + Math.random() * 220);
          bp.frequency.setValueAtTime(startF, timeCursor);
          bp.frequency.linearRampToValueAtTime(startF * (isPush ? 1.15 : 0.88), timeCursor + strokeDur * 0.5);
          bp.frequency.linearRampToValueAtTime(startF * 0.95, timeCursor + strokeDur);
          bp.Q.setValueAtTime(2.0, timeCursor);

          const lpf = audioCtx.createBiquadFilter();
          lpf.type = "lowpass";
          lpf.frequency.setValueAtTime(effectiveCutoff, timeCursor);

          const gain = audioCtx.createGain();
          const peak = (0.28 + Math.random() * 0.12) * velScale;
          gain.gain.setValueAtTime(0.0001, timeCursor);
          gain.gain.linearRampToValueAtTime(peak, timeCursor + 0.015);
          gain.gain.setValueAtTime(peak * (0.85 + Math.random() * 0.18), timeCursor + strokeDur * 0.6);
          gain.gain.exponentialRampToValueAtTime(0.0001, timeCursor + strokeDur);

          src.connect(bp);
          bp.connect(lpf);
          lpf.connect(gain);
          gain.connect(toolBus);

          src.start(timeCursor, Math.random() * 2.5);
          src.stop(timeCursor + strokeDur + 0.02);

          timeCursor += strokeDur + 0.018 + Math.random() * 0.025;
        }

        createToolVisualEvent("pencil", azimuth, velScale);

      } else if (state.currentToolInst === "typewriter") {
        // 4. 复古机械打字机：机芯铅字臂杠杆微音高差 + 纸卷胶辊深沉钝底 (165Hz) + 行末清脆黄铜回车小铃与推杆
        const keyPitchFactor = 0.92 + Math.random() * 0.16;
        const thudOsc = audioCtx.createOscillator();
        thudOsc.type = "sine";
        thudOsc.frequency.setValueAtTime(165 * keyPitchFactor, now);
        thudOsc.frequency.exponentialRampToValueAtTime(62, now + 0.042);

        const thudGain = audioCtx.createGain();
        thudGain.gain.setValueAtTime(0.0001, now);
        thudGain.gain.linearRampToValueAtTime(0.35 * velScale, now + 0.0035);
        thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

        const clickSrc = audioCtx.createBufferSource();
        clickSrc.buffer = buf;
        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(Math.min(effectiveCutoff, 1120 * keyPitchFactor), now);
        bp.Q.setValueAtTime(3.2, now);

        const clickGain = audioCtx.createGain();
        clickGain.gain.setValueAtTime(0.0001, now);
        clickGain.gain.linearRampToValueAtTime(0.30 * velScale, now + 0.0025);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

        thudOsc.connect(thudGain);
        clickSrc.connect(bp);
        bp.connect(clickGain);
        thudGain.connect(toolBus);
        clickGain.connect(toolBus);

        thudOsc.start(now);
        thudOsc.stop(now + 0.05);
        clickSrc.start(now, Math.random() * 2.5);
        clickSrc.stop(now + 0.032);

        toolTypewriterCount++;
        state.toolTypewriterCol = (state.toolTypewriterCol || 0) + 1;

        // 行末到达 56~68 字符边界时，触发清脆行末黄铜小铃与回车机架推杆
        if (state.toolTypewriterCol >= (54 + Math.floor(Math.random() * 12))) {
          state.toolTypewriterCol = 0;
          // 黄铜回车小铃 (Carriage End Bell ~1760Hz)
          const bellOsc = audioCtx.createOscillator();
          bellOsc.type = "sine";
          bellOsc.frequency.setValueAtTime(1760, now + 0.08);
          const bellGain = audioCtx.createGain();
          bellGain.gain.setValueAtTime(0.0001, now + 0.08);
          bellGain.gain.linearRampToValueAtTime(0.20, now + 0.086);
          bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

          bellOsc.connect(bellGain);
          connectTo3DioStage(bellGain, 0.75 * state.stereoWidth, now + 0.08);
          bellOsc.start(now + 0.08);
          bellOsc.stop(now + 1.2);

          // 回车齿条滑移复位声 (Carriage Return Lever Zip-Thump)
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tools") {
              const zipSrc = audioCtx.createBufferSource();
              zipSrc.buffer = buf;
              const zipBp = audioCtx.createBiquadFilter();
              zipBp.type = "bandpass";
              zipBp.frequency.setValueAtTime(1450, scope.time());
              zipBp.frequency.exponentialRampToValueAtTime(650, scope.time() + 0.16);
              zipBp.Q.setValueAtTime(2.2, scope.time());
              const zipGain = audioCtx.createGain();
              zipGain.gain.setValueAtTime(0.0001, scope.time());
              zipGain.gain.linearRampToValueAtTime(0.22, scope.time() + 0.015);
              zipGain.gain.exponentialRampToValueAtTime(0.0001, scope.time() + 0.18);
              zipSrc.connect(zipBp);
              zipBp.connect(zipGain);
              connectTo3DioStage(zipGain, -0.65 * state.stereoWidth, scope.time());
              zipSrc.start(scope.time(), Math.random() * 2.0);
              zipSrc.stop(scope.time() + 0.20);
            }
          }, 180);
        }

        createToolVisualEvent("typewriter", azimuth, velScale);

      } else if (state.currentToolInst === "spray") {
        // 5. 细密雾化水喷：液压微阻尼两段式按压 + 3Dio 气溶胶水雾空间漫延
        const sprayDur = 0.38 + Math.random() * 0.16;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const pumpClick = audioCtx.createOscillator();
        pumpClick.type = "sine";
        pumpClick.frequency.setValueAtTime(680 * (0.95 + Math.random() * 0.1), now);
        pumpClick.frequency.exponentialRampToValueAtTime(240, now + 0.018);
        const pumpGain = audioCtx.createGain();
        pumpGain.gain.setValueAtTime(0.0001, now);
        pumpGain.gain.linearRampToValueAtTime(0.16 * velScale, now + 0.003);
        pumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(Math.min(effectiveCutoff, 2600), now);
        bp.frequency.exponentialRampToValueAtTime(Math.min(effectiveCutoff, 1250), now + sprayDur);
        bp.Q.setValueAtTime(1.5, now);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(effectiveCutoff, now);

        const gain = audioCtx.createGain();
        const peak = (0.32 + Math.random() * 0.08) * velScale;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.035);
        gain.gain.setValueAtTime(peak * 0.72, now + sprayDur * 0.45);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + sprayDur);

        src.connect(bp);
        bp.connect(lpf);
        lpf.connect(gain);
        pumpClick.connect(pumpGain);

        gain.connect(toolBus);
        pumpGain.connect(toolBus);

        pumpClick.start(now);
        pumpClick.stop(now + 0.025);
        src.start(now + 0.005, Math.random() * 2.5);
        src.stop(now + sprayDur + 0.03);

        createToolVisualEvent("spray", azimuth, velScale);
      }
    }

    function scheduleNextToolEvent() {
      if (!state.isPlaying || state.activeCategory !== "tools") return;

      const inst = TOOLS_INSTRUMENTS[state.currentToolInst];
      const style = TOOLS_STYLES[state.currentToolStyle];
      state.toolDensityWalk = Math.max(0.78, Math.min(1.28, (state.toolDensityWalk || 1.0) * 0.88 + (0.8 + Math.random() * 0.4) * 0.12));
      const baseInterval = (inst.baseRate / Math.max(0.5, state.toolPaceMultiplier)) * state.toolDensityWalk;

      if (style.mode === "alternate") {
        // 左右耳近距离修剪：单侧耳畔温存驻留 2~4 拍 (近耳近讲感) 然后平滑换耳
        state.toolPhraseRemaining = (state.toolPhraseRemaining || 3) - 1;
        if (state.toolPhraseRemaining <= 0) {
          state.toolHandSide = -(state.toolHandSide || -0.85);
          state.toolPhraseRemaining = 2 + Math.floor(Math.random() * 3);
        }

        const az = (state.toolHandSide || -0.85) * (0.75 + Math.random() * 0.25);
        triggerToolEvent(az, 0.92 + Math.random() * 0.16);

        // 理发剪刀偶发快速轻巧跟剪（双剪 snip-snip，约 46% 概率）
        if (state.currentToolInst === "scissors" && Math.random() < 0.46) {
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "tools") {
              triggerToolEvent(az + (Math.random() * 0.14 - 0.07), 0.74 + Math.random() * 0.15);
            }
          }, 90 + Math.random() * 65);
        }

        const nextDelay = baseInterval * (0.85 + Math.random() * 0.3);
        toolTimerId = setTimeout(scheduleNextToolEvent, nextDelay);

      } else if (style.mode === "flow") {
        // 伴读心流：规律节拍伴随自然微时差
        const az = (Math.random() * 0.45 - 0.225);
        triggerToolEvent(az, 0.88 + Math.random() * 0.18);
        const nextDelay = baseInterval * (0.92 + Math.random() * 0.16);
        toolTimerId = setTimeout(scheduleNextToolEvent, nextDelay);

      } else if (style.mode === "orbit") {
        // 耳廓环绕漫游 (360° 轨道游走)
        toolCycleStep += (0.38 + Math.random() * 0.14);
        const az = Math.sin(toolCycleStep) * 0.88;
        triggerToolEvent(az, 0.86 + Math.random() * 0.18);
        const nextDelay = baseInterval * (0.88 + Math.random() * 0.24);
        toolTimerId = setTimeout(scheduleNextToolEvent, nextDelay);

      } else {
        // 随性偶发微拂 (random)：自然思考停顿与随机耳畔落点
        const az = (Math.random() * 1.7 - 0.85);
        triggerToolEvent(az, 0.72 + Math.random() * 0.38);

        // 偶发自然停顿 (28% 概率稍微留白)
        const pauseMult = Math.random() < 0.28 ? 1.75 : 1.0;
        const nextDelay = baseInterval * pauseMult * (0.8 + Math.random() * 0.4);
        toolTimerId = setTimeout(scheduleNextToolEvent, nextDelay);
      }
    }

    // --------------------------------------------------------------------------
    // B7. 暖冬壁炉炭火与自然碎裂声物理声学合成核心 (Fireplace & Natural Fractures Engine)
    //     去爆裂同质化重构：以舒缓热流/摩挲微事件为主体，分场景克制且跨宽频段采样异频微爆
    // --------------------------------------------------------------------------
    function triggerFireEvent(azimuthOverride = null, velScale = 1.0, eventVariant = null) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "fire") return;

      const inst = FIRE_INSTRUMENTS[state.currentFireInst] || FIRE_INSTRUMENTS.pine_fireplace;
      const style = FIRE_STYLES[state.currentFireStyle] || FIRE_STYLES.hearth_calm;
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      const rawAz = azimuthOverride !== null
        ? azimuthOverride
        : Math.max(-0.95, Math.min(0.95, (Math.random() * 1.4 - 0.7) + state.firePanBias * 0.25));
      const azimuth = rawAz * state.stereoWidth;

      const vel = Math.max(0.28, Math.min(1.15, velScale * (0.82 + Math.random() * 0.32)));
      const effectiveCutoff = Math.min(
        state.userLowpass,
        (inst.warmthCutoff || 1800) * (0.66 + (1 - state.fireWarmth) * 0.56)
      );

      const fireBus = audioCtx.createGain();
      fireBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(fireBus, azimuth, now);

      // 1. 反重复宽频采样器：确保相邻两次微爆/微裂落在截然不同的频段，彻底消除“频率都差不多”
      const sampleDistinctFirePitch = (tierBias = null) => {
        let candidate = Math.random();
        if (tierBias === "low") {
          candidate = 0.04 + Math.random() * 0.32;
        } else if (tierBias === "mid") {
          candidate = 0.34 + Math.random() * 0.34;
        } else if (tierBias === "high") {
          candidate = 0.66 + Math.random() * 0.30;
        } else {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (Math.abs(candidate - state.fireLastPitchNorm) > 0.25) break;
            candidate = Math.random();
          }
        }
        state.fireLastPitchNorm = candidate;
        const range = inst.popFreqRange || [220, 1380];
        const fMin = Math.max(110, range[0]);
        const fMax = Math.max(fMin * 1.35, Math.min(effectiveCutoff * 0.96, range[1]));
        const freq = fMin * Math.pow(fMax / fMin, candidate);
        return { norm: candidate, freq };
      };

      // 2. 整形宽频噪声脉冲辅助器 (Zero-Click 软淡入 >= 1.8ms + 动态低通天花板保护)
      const spawnFireNoise = (filterType, fStart, fEnd, qVal, peakGain, atkSec, durSec, lpClamp = effectiveCutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        if (durSec > 0.25) src.loop = true;

        const flt = audioCtx.createBiquadFilter();
        flt.type = filterType;
        const clampedStart = Math.max(75, Math.min(lpClamp, fStart));
        const clampedEnd = Math.max(70, Math.min(lpClamp, fEnd || fStart));
        flt.frequency.setValueAtTime(clampedStart, t0);
        if (Math.abs(clampedEnd - clampedStart) > 4) {
          flt.frequency.exponentialRampToValueAtTime(clampedEnd, t0 + atkSec + durSec);
        }
        flt.Q.setValueAtTime(Math.max(0.5, qVal), t0);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(Math.max(140, Math.min(effectiveCutoff, lpClamp)), t0);
        lpf.Q.setValueAtTime(0.7, t0);

        const g = audioCtx.createGain();
        const safeAtk = Math.max(0.0018, atkSec);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0005, peakGain), t0 + safeAtk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + safeAtk + durSec);

        src.connect(flt);
        flt.connect(lpf);
        lpf.connect(g);
        g.connect(fireBus);

        const maxOffset = Math.max(0.2, buf.duration - (safeAtk + durSec) - 0.1);
        src.start(t0, Math.random() * maxOffset);
        src.stop(t0 + safeAtk + durSec + 0.012);
      };

      // 3. 短促高阻尼木腔/石基/果壳低频支撑辅助器 (仅作物理质量感支撑，绝无高增益纯音水泡声)
      const spawnFireModal = (fStart, fEnd, peakGain, atkSec, durSec, lpClamp = effectiveCutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(Math.max(48, fStart), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + atkSec + durSec);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(Math.max(120, Math.min(effectiveCutoff, lpClamp)), t0);

        const g = audioCtx.createGain();
        const safeAtk = Math.max(0.002, atkSec);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0005, peakGain), t0 + safeAtk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + safeAtk + durSec);

        osc.connect(lpf);
        lpf.connect(g);
        g.connect(fireBus);

        osc.start(t0);
        osc.stop(t0 + safeAtk + durSec + 0.008);
      };

      // 4. 判定本次事件为「舒缓热流/有机摩挲主事件 (glow)」还是「偶发微爆/脆裂事件 (pop)」
      const basePopProb = (inst.popProb !== undefined ? inst.popProb : 0.30) * (style.popProbScale || 1.0);
      const warmthDampFactor = 0.84 + (1 - state.fireWarmth) * 0.30;
      const effectivePopProb = Math.max(0.05, Math.min(0.75, basePopProb * warmthDampFactor));
      const isPopEvent = eventVariant === "pop"
        ? true
        : (eventVariant === "glow" ? false : (Math.random() < effectivePopProb));

      if (state.currentFireInst === "pine_fireplace") {
        // 🪵 1. 松木壁炉炭火：58% 炉膛火舌温润轻舔与松木炭灰微沉 + 42% 高/中/低三阶异频松脂慢爆
        if (!isPopEvent) {
          const draftDur = 0.22 + Math.random() * 0.18;
          const draftF = 135 + Math.random() * 85;
          spawnFireNoise("bandpass", draftF, draftF * (1.22 + Math.random() * 0.25), 1.35, 0.16 * vel, 0.045, draftDur, 460);
          if (Math.random() < 0.55) {
            // 烧软的松木炭块极其轻微的沉降摩挲声
            const ashF = 310 + Math.random() * 190;
            spawnFireNoise("bandpass", ashF, ashF * 0.78, 1.85, 0.11 * vel, 0.012, 0.055 + Math.random() * 0.04, 720, 0.04);
          }
          createFireVisualEvent("fireplace", azimuth, vel * 0.72, "glow");
        } else {
          const { norm, freq } = sampleDistinctFirePitch();
          if (norm < 0.36) {
            // 低频深层松脂气囊闷噗 (Deep Resin Pocket Thump: 145~330Hz，沉厚温润不刺耳)
            spawnFireModal(freq * 0.92, Math.max(52, freq * 0.34), 0.28 * vel, 0.003, 0.042, 380);
            spawnFireNoise("bandpass", freq * 1.15, freq * 0.76, 2.1, 0.22 * vel, 0.0022, 0.032, 560);
            spawnFireNoise("lowpass", 240, 140, 1.1, 0.14 * vel, 0.008, 0.065, 360, 0.012);
          } else if (norm < 0.72) {
            // 中频松木心材温润木裂 (Warm Pine Heartwood Split: 350~780Hz)
            spawnFireModal(freq * 0.48, Math.max(68, freq * 0.22), 0.22 * vel, 0.0025, 0.028, 480);
            spawnFireNoise("bandpass", freq, freq * 0.82, 2.55, 0.25 * vel, 0.002, 0.025, effectiveCutoff);
          } else {
            // 高位松树皮细微火星轻跳 (Delicate Bark Spark: 800~1480Hz，短促轻柔)
            spawnFireModal(220 + Math.random() * 60, 95, 0.14 * vel, 0.0022, 0.018, 360);
            spawnFireNoise("bandpass", freq, freq * 0.88, 3.0, 0.20 * vel, 0.0018, 0.016, effectiveCutoff);
          }
          createFireVisualEvent("fireplace", azimuth, vel, "spark");
        }

      } else if (state.currentFireInst === "autumn_leaves") {
        // 🍂 2. 深秋干燥落叶：68% 林风拂叶与鞋底软泥轻移 + 32% 疏密错落的叶柄/叶片松脆压折
        if (!isPopEvent) {
          const rustleDur = 0.15 + Math.random() * 0.14;
          const rustleF = 290 + Math.random() * 240;
          spawnFireModal(118 + Math.random() * 25, 52, 0.15 * vel, 0.009, 0.062, 240);
          spawnFireNoise("bandpass", rustleF, rustleF * (0.78 + Math.random() * 0.38), 1.45, 0.17 * vel, 0.024, rustleDur, Math.min(effectiveCutoff, 920));
          createFireVisualEvent("leaves", azimuth, vel * 0.75, "glow");
        } else {
          // 脚掌落向松软腐殖土低频缓冲 + 2~3 层变速 Rubato 异频叶片微折（告别原 4~7 层密集连发）
          spawnFireModal(136 + Math.random() * 24, 54, 0.20 * vel, 0.007, 0.060, 260);
          const crunchLayers = 2 + (Math.random() < 0.42 ? 1 : 0);
          let delayCursor = 0.004;
          for (let i = 0; i < crunchLayers; i++) {
            const tier = i === 0 ? "low" : (i === crunchLayers - 1 ? "high" : "mid");
            const { freq } = sampleDistinctFirePitch(tier);
            const layerDur = 0.018 + Math.random() * 0.014;
            const layerGain = (0.19 + Math.random() * 0.08) * vel * (i === 0 ? 0.92 : 1.0);
            spawnFireNoise("bandpass", freq, freq * 0.84, 2.35, layerGain, 0.0028, layerDur, effectiveCutoff, delayCursor);
            delayCursor += 0.022 + Math.random() * 0.028 * (1 + i * 0.35);
          }
          createFireVisualEvent("leaves", azimuth, vel, "spark");
        }

      } else if (state.currentFireInst === "campfire_embers") {
        // 🏕️ 3. 营火微风余烬：76% 夜风拂炭温热气浪起伏与炭灰微沉 + 24% 零星轻柔炭星细鸣
        const gustDur = 0.24 + Math.random() * 0.18;
        const gustStart = 175 + Math.random() * 75;
        spawnFireNoise("bandpass", gustStart, gustStart * 1.38, 1.45, 0.16 * vel, 0.055, gustDur, 540);

        if (!isPopEvent) {
          // 暗红木炭表面薄灰随夜风轻微滑落
          const ashF = 360 + Math.random() * 210;
          spawnFireNoise("bandpass", ashF, ashF * 0.76, 1.75, 0.10 * vel, 0.018, 0.075, 780, 0.05);
          createFireVisualEvent("embers", azimuth, vel * 0.72, "glow");
        } else {
          // 偶发单颗或轻重双颗远近炭星细鸣（跨 320~1680Hz 宽频分布）
          const { freq } = sampleDistinctFirePitch();
          const sparkDelay = 0.035 + Math.random() * 0.045;
          spawnFireModal(Math.min(340, freq * 0.42), 92, 0.14 * vel, 0.0025, 0.020, 420, sparkDelay);
          spawnFireNoise("bandpass", freq, freq * 0.86, 2.95, 0.19 * vel, 0.002, 0.017, effectiveCutoff, sparkDelay);
          createFireVisualEvent("embers", azimuth, vel, "spark");
        }

      } else if (state.currentFireInst === "pinecone_fracture") {
        // 🌲 4. 干燥松果微压：65% 指腹慢揉松果木鳞弹性微弯摩挲 + 35% 大小鳞片木质脆性释放
        if (!isPopEvent) {
          const rubDur = 0.085 + Math.random() * 0.075;
          const rubF = 260 + Math.random() * 220;
          spawnFireModal(185 + Math.random() * 35, 118, 0.12 * vel, 0.006, 0.038, 320);
          spawnFireNoise("bandpass", rubF, rubF * 1.18, 1.85, 0.16 * vel, 0.012, rubDur, 780);
          createFireVisualEvent("pinecone", azimuth, vel * 0.74, "glow");
        } else {
          const { freq } = sampleDistinctFirePitch();
          // 鳞片预弯木纤维微紧绷 -> 温润木质空腔脆裂释放
          spawnFireNoise("bandpass", Math.min(effectiveCutoff, freq * 0.68), freq * 0.58, 2.6, 0.11 * vel, 0.0022, 0.012, effectiveCutoff, 0);
          const snapDelay = 0.016 + Math.random() * 0.010;
          spawnFireModal(Math.min(460, freq * 0.56), Math.max(88, freq * 0.24), 0.24 * vel, 0.002, 0.024, 540, snapDelay);
          spawnFireNoise("bandpass", freq, freq * 0.82, 2.75, 0.23 * vel, 0.0018, 0.024, effectiveCutoff, snapDelay);
          createFireVisualEvent("pinecone", azimuth, vel, "spark");
        }

      } else if (state.currentFireInst === "charcoal_drift") {
        // ♨️ 5. 竹炭微炙慢烘 (备长白炭)：82% 陶炉静谧红外暖流与气孔微叹 + 18% 清润微弱矿物炭鸣
        if (!isPopEvent) {
          const sighDur = 0.18 + Math.random() * 0.14;
          const sighF = 230 + Math.random() * 170;
          spawnFireModal(162 + Math.random() * 28, 112, 0.10 * vel, 0.014, 0.065, 280);
          spawnFireNoise("bandpass", sighF, sighF * 0.84, 1.65, 0.13 * vel, 0.028, sighDur, 640);
          createFireVisualEvent("charcoal", azimuth, vel * 0.68, "glow");
        } else {
          // 备长炭高密度微孔受热释放的清润微鸣（大幅降低纯正弦占比，杜绝声呐电子音）
          const { freq } = sampleDistinctFirePitch();
          spawnFireModal(freq * 0.64, freq * 0.48, 0.11 * vel, 0.0022, 0.022, Math.min(effectiveCutoff, 860));
          spawnFireNoise("bandpass", freq, freq * 0.88, 3.2, 0.19 * vel, 0.002, 0.020, effectiveCutoff);
          createFireVisualEvent("charcoal", azimuth, vel * 0.88, "spark");
        }

      } else if (state.currentFireInst === "dry_twigs") {
        // 🪵 6. 干燥细松枝折断：62% 枯枝轻拢树皮微擦与弯曲应力 + 38% 粗/中/细松枝异频缓折
        if (!isPopEvent) {
          const barkDur = 0.11 + Math.random() * 0.09;
          const barkF = 240 + Math.random() * 210;
          spawnFireModal(215 + Math.random() * 40, 155, 0.11 * vel, 0.005, 0.028, 360);
          spawnFireNoise("bandpass", barkF, barkF * 0.82, 1.65, 0.16 * vel, 0.014, barkDur, 760);
          createFireVisualEvent("dry_twigs", azimuth, vel * 0.72, "glow");
        } else {
          // 按采样频段自动映射粗枝沉闷折断 (220~420Hz)、中枝脆折 (430~760Hz) 与细枝轻断 (770~1260Hz)
          const { norm, freq } = sampleDistinctFirePitch();
          const creakF = 190 + norm * 140;
          spawnFireModal(creakF, creakF * 0.74, 0.11 * vel, 0.0035, 0.016, 420, 0);
          const snapDelay = 0.014 + Math.random() * 0.008;
          const bodyDur = norm < 0.4 ? 0.032 : 0.022;
          spawnFireModal(Math.min(480, freq * 0.54), Math.max(85, freq * 0.22), (0.26 - norm * 0.06) * vel, 0.002, bodyDur, 580, snapDelay);
          spawnFireNoise("bandpass", freq, freq * 0.80, 2.65, 0.24 * vel, 0.0018, bodyDur * 1.15, effectiveCutoff, snapDelay);
          createFireVisualEvent("dry_twigs", azimuth, vel, "spark");
        }

      } else if (state.currentFireInst === "sauna_steam") {
        // 🧖 7. 桑拿火山石浇水蒸腾：92% 木瓢温水缓注与醇厚水汽漫涌舒展 + 8% 火山石热应力微沉（彻底移除原3颗正弦气泡音）
        if (!isPopEvent) {
          const isFullLadle = Math.random() < 0.58;
          if (isFullLadle) {
            // 木瓢温水泼入滚烫橄榄岩的沉闷水石扑声 + 双频段绵长水汽蒸腾包络
            spawnFireModal(158 + Math.random() * 28, 62, 0.22 * vel, 0.006, 0.052, 260);
            const steamDur = 0.58 + Math.random() * 0.34;
            const startF = 240 + Math.random() * 90;
            const peakF = Math.min(effectiveCutoff, 520 + Math.random() * 240);
            spawnFireNoise("bandpass", startF, peakF, 1.35, 0.24 * vel, 0.065, steamDur, Math.min(effectiveCutoff, 1180), 0.012);
            spawnFireNoise("lowpass", 280, 165, 0.95, 0.16 * vel, 0.055, steamDur * 1.08, 380, 0.02);
          } else {
            // 桑拿桧木房内余温水汽缓慢回旋的深呼吸微澜
            const breathDur = 0.32 + Math.random() * 0.22;
            const breathF = 210 + Math.random() * 150;
            spawnFireNoise("bandpass", breathF, breathF * 0.78, 1.4, 0.16 * vel, 0.045, breathDur, 680);
          }
          createFireVisualEvent("sauna_steam", azimuth, vel * 0.82, "glow");
        } else {
          // 火山石受热微沉与短促水汽轻噗（无高音脆爆）
          const { freq } = sampleDistinctFirePitch("low");
          spawnFireModal(freq * 0.85, Math.max(68, freq * 0.38), 0.20 * vel, 0.003, 0.032, 380);
          spawnFireNoise("bandpass", freq * 1.2, freq * 0.76, 1.9, 0.18 * vel, 0.004, 0.085, 680);
          createFireVisualEvent("sauna_steam", azimuth, vel * 0.85, "glow");
        }

      } else if (state.currentFireInst === "roast_chestnut") {
        // 🌰 8. 糖炒栗子壳微爆：72% 铁锅温热黑石英砂慢速翻炒摩挲 + 28% 焦糖栗壳闷噗微裂
        const sandDur = 0.18 + Math.random() * 0.14;
        const sandF = 280 + Math.random() * 190;
        spawnFireModal(142 + Math.random() * 24, 86, 0.12 * vel, 0.012, 0.065, 240);
        spawnFireNoise("bandpass", sandF, sandF * (1.18 + Math.random() * 0.22), 1.55, 0.16 * vel, 0.028, sandDur, 820);

        if (!isPopEvent) {
          createFireVisualEvent("roast_chestnut", azimuth, vel * 0.74, "glow");
        } else {
          // 热砂翻动中偶发一颗板栗外壳受热闷噗微裂与焦糖热气微叹
          const { freq } = sampleDistinctFirePitch();
          const popDelay = 0.035 + Math.random() * 0.045;
          spawnFireModal(Math.min(440, freq * 0.68), Math.max(95, freq * 0.28), 0.24 * vel, 0.0025, 0.032, 520, popDelay);
          spawnFireNoise("bandpass", freq, freq * 0.78, 2.45, 0.20 * vel, 0.002, 0.024, effectiveCutoff, popDelay);
          spawnFireNoise("bandpass", 360, 240, 1.5, 0.11 * vel, 0.008, 0.065, 580, popDelay + 0.016);
          createFireVisualEvent("roast_chestnut", azimuth, vel, "spark");
        }
      }
    }

    function scheduleNextFireEvent() {
      if (!state.isPlaying || state.activeCategory !== "fire") return;

      const inst = FIRE_INSTRUMENTS[state.currentFireInst] || FIRE_INSTRUMENTS.pine_fireplace;
      const style = FIRE_STYLES[state.currentFireStyle] || FIRE_STYLES.hearth_calm;

      // 1. 疏密均值回归随机游走 (Mean-Reverting Density Random Walk)
      state.fireDensityWalk += (1.0 - state.fireDensityWalk) * 0.24 + (Math.random() - 0.5) * 0.24;
      if (Math.random() < 0.10) {
        state.fireDensityWalk += (Math.random() < 0.55 ? 0.26 : -0.20);
      }
      state.fireDensityWalk = Math.max(0.62, Math.min(1.48, state.fireDensityWalk));

      const rateScale = style.rateScale || 1.0;
      const baseInterval = (inst.baseRate / Math.max(0.2, state.fireRateMultiplier * rateScale)) * state.fireDensityWalk;

      if (style.mode === "walk") {
        // 林间落叶漫步：真人步态微律动（左右交替踏叶 + 偶发同侧重心微移 + 偶发驻足静听林风）
        state.firePhraseLeft -= 1;
        let isStandingPause = false;
        if (state.firePhraseLeft <= 0) {
          state.firePhraseLeft = 4 + Math.floor(Math.random() * 5);
          isStandingPause = Math.random() < 0.38;
        }

        if (Math.random() > 0.16) {
          fireStepPan = -fireStepPan;
        }
        const az = fireStepPan * (0.58 + Math.random() * 0.24);
        const stepVel = isStandingPause ? (0.58 + Math.random() * 0.20) : (0.78 + Math.random() * 0.26);
        triggerFireEvent(az, stepVel, isStandingPause ? "glow" : null);

        const gaitRubato = isStandingPause ? (1.65 + Math.random() * 0.85) : (0.82 + Math.random() * 0.42);
        fireTimerId = setTimeout(scheduleNextFireEvent, Math.max(260, baseInterval * gaitRubato));

      } else if (style.mode === "gust") {
        // 微风拂火忽明：结合非周期三重无理数夜风包络（风起时温润涌亮，风歇时静谧留白）
        const tSec = Date.now() / 1000;
        const cSpd = inst.convectionSpeed || 0.5;
        const w1 = Math.sin(tSec * 0.72 * cSpd);
        const w2 = Math.sin(tSec * 0.43 * Math.SQRT2 * cSpd + 1.4);
        const flare = Math.max(-0.45, Math.min(0.65, w1 * 0.52 + w2 * 0.30 + state.fireConvectionEnv * 0.45));

        const az = Math.max(-0.92, Math.min(0.92, (Math.random() * 1.3 - 0.65) + state.firePanBias * 0.32));
        const gustVel = Math.max(0.48, Math.min(1.12, 0.74 + flare * 0.38));
        const forcedVariant = flare < -0.12 ? "glow" : null;
        triggerFireEvent(az, gustVel, forcedVariant);

        const intervalMod = flare > 0.15 ? (0.72 + Math.random() * 0.38) : (1.18 + Math.random() * 0.75);
        fireTimerId = setTimeout(scheduleNextFireEvent, Math.max(240, baseInterval * intervalMod));

      } else if (style.mode === "close") {
        // 近耳温存细语：单侧耳畔驻留 2~4 拍后平滑换耳，告别机械左右跳动与高频密集炸耳
        state.firePhraseLeft -= 1;
        if (state.firePhraseLeft <= 0) {
          state.fireEarSide = -state.fireEarSide;
          state.firePhraseLeft = 2 + Math.floor(Math.random() * 3);
        }
        const az = Math.max(-0.95, Math.min(0.95, state.fireEarSide * (0.74 + Math.random() * 0.18)));
        const closeVel = 0.56 + Math.random() * 0.26;
        triggerFireEvent(az, closeVel);

        const phrasePause = state.firePhraseLeft === 1 && Math.random() < 0.45 ? (1.35 + Math.random() * 0.55) : 1.0;
        const nextDelay = baseInterval * phrasePause * (0.74 + Math.random() * 0.52);
        fireTimerId = setTimeout(scheduleNextFireEvent, Math.max(220, nextDelay));

      } else {
        // 壁炉炉边守候 (hearth_calm)：非周期泊松漫流 + 22% 概率长段静谧留白（仅听炉膛温存热浪对流）
        const az = Math.max(-0.85, Math.min(0.85, (Math.random() * 0.88 - 0.44) + state.firePanBias * 0.24));
        const hearthVel = 0.68 + Math.random() * 0.30;
        triggerFireEvent(az, hearthVel);

        // 偶发温和尾随微事件（优先为火舌热流微叹或炭灰微沉，仅小概率为异频次级微星，绝不同频连爆）
        const clusterChance = (inst.clusterProb || 0.18) * (0.72 + Math.max(0, state.fireConvectionEnv * 0.4));
        if (Math.random() < clusterChance) {
          const subDelay = 110 + Math.random() * 160;
          const subAz = Math.max(-0.92, Math.min(0.92, az + (Math.random() * 0.24 - 0.12)));
          const subVariant = Math.random() < 0.68 ? "glow" : "pop";
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "fire") {
              triggerFireEvent(subAz, hearthVel * 0.62, subVariant);
            }
          }, subDelay);
        }

        const poissonRand = Math.min(2.6, -Math.log(Math.max(0.02, Math.random())));
        let nextDelay = baseInterval * (0.58 + poissonRand * 0.56);
        if (Math.random() < 0.22) {
          nextDelay *= (1.45 + Math.random() * 0.75);
        }
        fireTimerId = setTimeout(scheduleNextFireEvent, Math.max(260, nextDelay));
      }
    }

    // --------------------------------------------------------------------------
    // B8. 触觉揉捏、微塑性形变与软胶声学物理合成器 (Squish & Micro-Deformation Engine)
    //     异构粘弹性重构：根除高增益纯正弦上扬水泡音/双正弦雾角音/同频机关枪破泡，
    //     实现 8 种真实形变拓扑（两阶段慢回弹吸气/膏体粘滞剥离/水凝胶液膜微泡/植物纤维错落微折/
    //     石英砂崩落流/预紧绷异频气泡膜/湿面筋延展气孔轻叹/双稳态硅胶正反翻转）与 4 种手法深度耦合
    // --------------------------------------------------------------------------
    function triggerSquishEvent(azimuthOverride = null, velScale = 1.0, styleModeOverride = null) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "squish") return;

      const now = scope.time();
      const mat = SQUISH_MATERIALS[state.currentSquishMat] || SQUISH_MATERIALS.memory_foam;
      const style = SQUISH_STYLES[state.currentSquishStyle] || SQUISH_STYLES.deep_slow_press;
      const mode = styleModeOverride || style.mode || "deep";
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      // 粘稠阻尼度越高 (squishViscosity -> 1)，高频截止越往下收敛以增强软垫吸音感
      const viscDamp = 0.62 + (1 - state.squishViscosity) * 0.64;
      const effectiveCutoff = Math.max(240, Math.min(state.userLowpass, (mat.warmthCutoff || 1400) * viscDamp));

      const rawAz = azimuthOverride !== null
        ? azimuthOverride
        : Math.max(-0.92, Math.min(0.92, (Math.random() * 1.1 - 0.55) + state.squishPanBias * 0.28));
      const azimuth = rawAz * state.stereoWidth;
      state.squishFocusAz = azimuth;

      const vel = Math.max(0.32, Math.min(1.15, velScale * (0.85 + Math.random() * 0.28)));
      const durScale = (style.durationScale || 1.0) * (0.88 + state.squishViscosity * 0.26);
      const clusterScale = style.poreClusterScale || 1.0;

      const squishBus = audioCtx.createGain();
      squishBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(squishBus, azimuth, now);

      // 1. 反重复宽频对数采样器：确保相邻微泡/气囊/纤维微折/硅胶碗绝不同频
      const sampleDistinctSquishPitch = (tierBias = null) => {
        let candidate = Math.random();
        if (tierBias === "low") {
          candidate = 0.04 + Math.random() * 0.32;
        } else if (tierBias === "mid") {
          candidate = 0.34 + Math.random() * 0.34;
        } else if (tierBias === "high") {
          candidate = 0.66 + Math.random() * 0.30;
        } else {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (Math.abs(candidate - state.squishLastPitchNorm) > 0.24) break;
            candidate = Math.random();
          }
        }
        state.squishLastPitchNorm = candidate;
        const range = mat.popFreqRange || [200, 860];
        const fMin = Math.max(120, range[0]);
        const fMax = Math.max(fMin * 1.35, Math.min(effectiveCutoff * 0.95, range[1]));
        const freq = fMin * Math.pow(fMax / fMin, candidate);
        return { norm: candidate, freq };
      };

      // 2. 整形宽频噪声形变包络发生器 (支持三点频率轨迹 fStart -> fPeak -> fEnd 与双波峰连续翻卷包络)
      const spawnSquishNoise = (filterType, fStart, fPeak, fEnd, qVal, peakGain, atkSec, holdSec, relSec, lpClamp = effectiveCutoff, delaySec = 0, dualCrest = false) => {
        const t0 = now + delaySec;
        const safeAtk = Math.max(0.0025, atkSec);
        const safeHold = Math.max(0.004, holdSec);
        const safeRel = Math.max(0.012, relSec);
        const totalDur = safeAtk + safeHold + safeRel;

        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        if (totalDur > 0.22) src.loop = true;

        const flt = audioCtx.createBiquadFilter();
        flt.type = filterType;
        const cStart = Math.max(65, Math.min(lpClamp, fStart));
        const cPeak = Math.max(65, Math.min(lpClamp, fPeak || fStart));
        const cEnd = Math.max(60, Math.min(lpClamp, fEnd || cPeak));
        flt.frequency.setValueAtTime(cStart, t0);
        flt.frequency.exponentialRampToValueAtTime(cPeak, t0 + safeAtk + safeHold * 0.45);
        flt.frequency.exponentialRampToValueAtTime(cEnd, t0 + totalDur);
        flt.Q.setValueAtTime(Math.max(0.5, qVal), t0);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(Math.max(130, Math.min(effectiveCutoff, lpClamp)), t0);
        lpf.Q.setValueAtTime(0.72, t0);

        const g = audioCtx.createGain();
        const safePeak = Math.max(0.0005, peakGain);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(safePeak, t0 + safeAtk);
        if (dualCrest && safeHold > 0.08) {
          // 连续折叠翻卷时的掌心推拢双波峰呼吸起伏
          g.gain.linearRampToValueAtTime(safePeak * 0.48, t0 + safeAtk + safeHold * 0.46);
          g.gain.linearRampToValueAtTime(safePeak * (0.86 + Math.random() * 0.18), t0 + safeAtk + safeHold * 0.88);
        } else {
          g.gain.setValueAtTime(safePeak * 0.78, t0 + safeAtk + safeHold);
        }
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + totalDur);

        src.connect(flt);
        flt.connect(lpf);
        lpf.connect(g);
        g.connect(squishBus);

        const maxOffset = Math.max(0.2, buf.duration - Math.min(buf.duration - 0.3, totalDur) - 0.1);
        src.start(t0, Math.random() * maxOffset);
        src.stop(t0 + totalDur + 0.015);
      };

      // 3. 短促高阻尼肉垫/腔体低频质量支撑 (仅作软组织与气腔缓冲，严禁高增益纯正弦长扫频或上扬水泡音)
      const spawnSquishModal = (fStart, fEnd, peakGain, atkSec, durSec, lpClamp = effectiveCutoff, delaySec = 0) => {
        const t0 = now + delaySec;
        const safeAtk = Math.max(0.0022, atkSec);
        const safeDur = Math.max(0.008, durSec);

        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(Math.max(42, fStart), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(38, fEnd), t0 + safeAtk + safeDur);

        const lpf = audioCtx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.setValueAtTime(Math.max(110, Math.min(effectiveCutoff, lpClamp)), t0);

        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0004, peakGain), t0 + safeAtk);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + safeAtk + safeDur);

        osc.connect(lpf);
        lpf.connect(g);
        g.connect(squishBus);

        osc.start(t0);
        osc.stop(t0 + safeAtk + safeDur + 0.01);
      };

      // 4. 阻尼液膜/微孔/气囊破裂瞬态 (毛细液膜宽频破裂瞬态 + 短促下沉腔体阻尼，零上扬电子水泡音)
      const spawnDampedPorePop = (delaySec, tierBias = null, gainScale = 1.0, bodyRatio = 0.55) => {
        const { norm, freq } = sampleDistinctSquishPitch(tierBias);
        const popDur = (0.014 + (1 - norm) * 0.016) * (0.85 + state.squishViscosity * 0.25);
        // 腔体泄压下沉模态 (短促高阻尼向下收敛，绝不向上扫频)
        if (bodyRatio > 0.05) {
          spawnSquishModal(
            freq * 0.92,
            Math.max(68, freq * (0.42 + (1 - state.squishViscosity) * 0.12)),
            0.16 * vel * gainScale * bodyRatio,
            0.002,
            popDur,
            Math.min(effectiveCutoff, freq * 1.45),
            delaySec
          );
        }
        // 液膜/孔壁分离宽频微瞬态
        spawnSquishNoise(
          "bandpass",
          freq * 1.12,
          freq * 0.86,
          freq * 0.72,
          2.4 + (1 - state.squishViscosity) * 0.8,
          0.20 * vel * gainScale,
          0.0018,
          0.003,
          popDur * 0.95,
          effectiveCutoff,
          delaySec,
          false
        );
        return { norm, freq, popDur };
      };

      if (state.currentSquishMat === "memory_foam") {
        // 🧽 1. 慢回弹记忆海绵：一阶段掌心深压开孔微泡排气 + 屏息驻留 + 二阶段绵长慢回弹吸气舒展与孔壁松解
        const pressDur = (0.28 + Math.random() * 0.14) * durScale;
        // 极轻柔掌心肉垫下沉质量感 (大幅收敛正弦占比，杜绝合成器鼓声)
        spawnSquishModal(104 + Math.random() * 16, 48, 0.13 * vel, 0.016, 0.095, 220, 0);
        // 第一阶段：掌心深压开孔聚氨酯微孔向外温和排气 (高频向低频收敛)
        const exhalePeak = (0.21 + (1 - state.squishViscosity) * 0.08) * vel;
        spawnSquishNoise("bandpass", 390, 290, 165, 1.35, exhalePeak, 0.045, pressDur * 0.45, pressDur * 0.55, Math.min(effectiveCutoff, 760), 0, mode === "fold");

        // 第二阶段：松手后延迟慢回弹吸气舒展 (0.75~1.55s 绵长开孔吸气微流 + 细微孔壁粘连松解)
        const reboundDelay = pressDur * (mode === "deep" ? 0.88 : 0.68) + (0.04 + Math.random() * 0.06);
        const reboundDur = (mode === "deep" ? 1.15 : 0.78) * durScale * (0.88 + Math.random() * 0.24);
        const inhalePeak = exhalePeak * (mode === "deep" ? 0.86 : 0.74);
        spawnSquishNoise("bandpass", 160, Math.min(effectiveCutoff, 470), 210, 1.45, inhalePeak, reboundDur * 0.28, reboundDur * 0.34, reboundDur * 0.38, Math.min(effectiveCutoff, 680), reboundDelay, false);
        spawnSquishNoise("lowpass", 240, 195, 130, 0.9, inhalePeak * 0.58, reboundDur * 0.22, reboundDur * 0.40, reboundDur * 0.38, 340, reboundDelay + 0.02, false);

        // 开孔海绵回弹过程中的细微孔壁松解微响
        const poreCount = Math.max(1, Math.round((2 + Math.floor(Math.random() * 2)) * clusterScale));
        let poreCursor = reboundDelay + 0.06;
        for (let i = 0; i < poreCount; i++) {
          spawnDampedPorePop(poreCursor, i === 0 ? "low" : null, 0.42 + Math.random() * 0.22, 0.35);
          poreCursor += (0.065 + Math.random() * 0.095) * (1 + i * 0.25);
        }

        createSquishVisualEvent("memory_foam", azimuth, vel);

      } else if (state.currentSquishMat === "warm_beeswax") {
        // 🍯 2. 温热天然蜂蜡：彻底移除双正弦电子雾角音，改用高阻尼温热膏体折叠剪切 + 抬指微粘滞剥离释放
        const foldDur = (0.36 + Math.random() * 0.18) * durScale;
        // 掌心温厚挤压低频基底 (低增益短阻尼)
        spawnSquishModal(92 + Math.random() * 14, 50, 0.14 * vel, 0.018, 0.105, 190, 0);
        // 温热蜂蜡膏体深层塑性推压 (双频段过阻尼低中频剪切层)
        spawnSquishNoise("lowpass", 175, 265, 145, 1.25, 0.24 * vel, 0.055, foldDur * 0.48, foldDur * 0.52, Math.min(effectiveCutoff, 420), 0, mode === "fold");
        spawnSquishNoise("bandpass", 230, 340, 190, 1.65, 0.18 * vel, 0.048, foldDur * 0.42, foldDur * 0.55, Math.min(effectiveCutoff, 560), 0.015, mode === "fold");

        // 指腹从温热蜂蜡表面缓慢抬离时的微粘滞剥离 (Micro-Tacky Detachment)
        const detachCount = mode === "bursts" ? (3 + Math.floor(Math.random() * 2)) : (1 + Math.floor(Math.random() * 2));
        let detachTime = foldDur * 0.58 + 0.025;
        for (let i = 0; i < detachCount; i++) {
          const { freq } = sampleDistinctSquishPitch(i === 0 ? "low" : "mid");
          spawnSquishModal(freq * 0.72, Math.max(62, freq * 0.38), 0.10 * vel, 0.003, 0.024, 340, detachTime);
          spawnSquishNoise("bandpass", freq, freq * 1.18, freq * 0.76, 2.2, 0.16 * vel, 0.004, 0.012, 0.036, Math.min(effectiveCutoff, 640), detachTime, false);
          detachTime += 0.048 + Math.random() * 0.055;
        }

        createSquishVisualEvent("warm_beeswax", azimuth, vel);

      } else if (state.currentSquishMat === "soft_slime") {
        // 🫧 3. 柔韧水晶泥软胶：移除上扬纯正弦水泡音，采用双共振峰水凝胶包裹拉伸 + 大中小三阶异频液膜钝感微泡
        const stretchDur = (0.30 + Math.random() * 0.16) * durScale;
        // 水凝胶团块柔性形变基底
        spawnSquishModal(118 + Math.random() * 18, 58, 0.12 * vel, 0.012, 0.075, 240, 0);
        // 双共振峰胶体流体包裹拉伸 (Wet Hydrogel Formant Glide)
        spawnSquishNoise("bandpass", 210, Math.min(effectiveCutoff, 460), 230, 2.1, 0.20 * vel, 0.038, stretchDur * 0.45, stretchDur * 0.55, Math.min(effectiveCutoff, 780), 0, mode === "fold");
        spawnSquishNoise("bandpass", 440, Math.min(effectiveCutoff, 780), 360, 2.4, 0.14 * vel, 0.045, stretchDur * 0.40, stretchDur * 0.52, effectiveCutoff, 0.018, mode === "fold");

        // 指缝挤压水晶泥时的变速 Rubato 异频液膜微泡 (大泡沉闷、中泡温润、细泡轻巧)
        const basePops = mode === "bursts" ? (4 + Math.floor(Math.random() * 3)) : (mode === "fold" ? (1 + Math.floor(Math.random() * 2)) : (2 + Math.floor(Math.random() * 2)));
        let popCursor = 0.032 + Math.random() * 0.025;
        for (let i = 0; i < basePops; i++) {
          const tier = i === 0 ? "low" : (i === basePops - 1 ? "high" : "mid");
          const popGain = (0.68 + Math.random() * 0.34) * (i === 0 ? 0.95 : 0.82);
          spawnDampedPorePop(popCursor, tier, popGain, 0.58);
          // 变速 Rubato 间隔：中段微紧凑、首尾舒展
          const rubatoStep = i === 1 ? (0.028 + Math.random() * 0.026) : (0.046 + Math.random() * 0.052);
          popCursor += rubatoStep * (0.85 + durScale * 0.2);
        }

        createSquishVisualEvent("soft_slime", azimuth, vel);

      } else if (state.currentSquishMat === "linen_parchment") {
        // 📜 4. 柔和亚麻纸褶：亚麻织物手掌拢合底波 + 疏密变速的植物羊皮纸纤维异频微折（告别等距机关枪噪声簇）
        const gatherDur = (0.32 + Math.random() * 0.16) * durScale;
        // 亚麻布囊柔性空气缓冲与织物摩擦底波
        spawnSquishModal(112 + Math.random() * 16, 56, 0.11 * vel, 0.010, 0.062, 220, 0);
        spawnSquishNoise("bandpass", 240, 420, 210, 1.35, 0.16 * vel, 0.035, gatherDur * 0.46, gatherDur * 0.54, Math.min(effectiveCutoff, 720), 0, true);

        // 植物羊皮纸纤维错落微折 (Rubato Fiber Creases，每折频段、时长与包络各异)
        const creaseCount = mode === "bursts" ? (4 + Math.floor(Math.random() * 3)) : (mode === "fold" ? 2 : (3 + Math.floor(Math.random() * 2)));
        let creaseCursor = 0.018;
        for (let i = 0; i < creaseCount; i++) {
          const tier = i === 0 ? "low" : (i % 2 === 1 ? "mid" : "high");
          const { freq } = sampleDistinctSquishPitch(tier);
          const cAtk = 0.003 + Math.random() * 0.005;
          const cHold = 0.008 + Math.random() * 0.014;
          const cRel = 0.024 + Math.random() * 0.028;
          const cGain = (0.15 + Math.random() * 0.08) * vel * (i === creaseCount - 1 ? 0.72 : 1.0);
          spawnSquishNoise("bandpass", freq * 0.92, freq * 1.08, freq * 0.78, 1.85 + Math.random() * 0.7, cGain, cAtk, cHold, cRel, Math.min(effectiveCutoff, 1280), creaseCursor, false);
          creaseCursor += (0.036 + Math.random() * 0.058) * (0.85 + i * 0.22);
        }
        // 纸页与亚麻松手后的轻柔舒展尾韵
        spawnSquishNoise("bandpass", 360, 280, 195, 1.4, 0.10 * vel, 0.025, 0.04, 0.14 * durScale, 640, creaseCursor + 0.02, false);

        createSquishVisualEvent("linen_parchment", azimuth, vel);

      } else if (state.currentSquishMat === "kinetic_sand") {
        // ⏳ 5. 流沙解压魔方：一阶段微聚物石英砂团聚切变推压 + 二阶段分 2~3 波黄油般缓慢崩落微沙流
        const sliceDur = (0.24 + Math.random() * 0.12) * durScale;
        // 砂块受压紧实低频缓冲 (去除原高增益正弦重低音)
        spawnSquishModal(98 + Math.random() * 14, 52, 0.13 * vel, 0.015, 0.085, 210, 0);
        // 第一阶段：切入/按压流沙时的致密石英砂聚物剪切阻力
        spawnSquishNoise("bandpass", 270, Math.min(effectiveCutoff, 510), 340, 1.65, 0.23 * vel, 0.038, sliceDur * 0.45, sliceDur * 0.55, Math.min(effectiveCutoff, 860), 0, false);

        // 第二阶段：流沙块沿切面分 2~3 波缓慢崩解滑落 (Buttery Crumble Avalanches)
        const waveCount = mode === "bursts" ? 3 : 2;
        let waveCursor = sliceDur * 0.62;
        for (let w = 0; w < waveCount; w++) {
          const { freq } = sampleDistinctSquishPitch(w === 0 ? "mid" : "low");
          const wDur = (0.22 + Math.random() * 0.16) * durScale * (1 - w * 0.16);
          const wGain = (0.19 - w * 0.045) * vel;
          spawnSquishNoise("bandpass", freq * 1.15, freq * 0.92, Math.max(170, freq * 0.62), 1.55, wGain, 0.028, wDur * 0.38, wDur * 0.62, Math.min(effectiveCutoff, 920), waveCursor, mode === "fold");
          waveCursor += wDur * 0.58 + (0.025 + Math.random() * 0.035);
        }

        createSquishVisualEvent("kinetic_sand", azimuth, vel);

      } else if (state.currentSquishMat === "bubble_wrap") {
        // 🫧 6. 双耳防震气泡膜：柔韧 LDPE 膜指腹预压微褶 + 跨八度大中小异频气囊沉闷微破（根除同频激光枪声）
        const filmDur = (0.10 + Math.random() * 0.08) * durScale;
        // 手指挪动与按压柔韧 PE 膜的低中频温润摩擦 (严控高频塑料声)
        spawnSquishNoise("bandpass", 240, 410, 260, 1.55, 0.12 * vel, 0.015, filmDur * 0.4, filmDur * 0.6, Math.min(effectiveCutoff, 680), 0, false);

        const popCount = mode === "bursts"
          ? (3 + Math.floor(Math.random() * 3))
          : (mode === "fold" ? (1 + (Math.random() < 0.45 ? 1 : 0)) : (1 + Math.floor(Math.random() * 2)));

        let popCursor = 0.024 + Math.random() * 0.020;
        for (let i = 0; i < popCount; i++) {
          const tier = popCount >= 3 ? (i === 0 ? "low" : (i === popCount - 1 ? "high" : "mid")) : null;
          const { freq } = sampleDistinctSquishPitch(tier);
          // 气囊破裂前 10ms 的薄膜受压预紧绷微响 (Pre-Pop Membrane Tension)
          spawnSquishNoise("bandpass", Math.min(effectiveCutoff, freq * 0.76), freq * 0.95, freq * 0.82, 2.2, 0.08 * vel, 0.003, 0.004, 0.010, Math.min(effectiveCutoff, 760), popCursor, false);

          const burstTime = popCursor + 0.011 + Math.random() * 0.005;
          const popGain = (0.76 + Math.random() * 0.28) * (i === 0 ? 1.0 : 0.86);
          // 气囊沉闷泄压腔体模态 + 柔化薄膜破口瞬态
          spawnSquishModal(freq * 0.88, Math.max(72, freq * 0.32), 0.22 * vel * popGain, 0.002, 0.022, Math.min(effectiveCutoff, 580), burstTime);
          spawnSquishNoise("bandpass", freq * 1.18, freq * 0.90, freq * 0.68, 2.55, 0.21 * vel * popGain, 0.0018, 0.0025, 0.016, effectiveCutoff, burstTime, false);

          // 拟真指尖捏泡非均匀间隔
          popCursor = burstTime + (0.055 + Math.random() * 0.085) * (1 + i * 0.28);
        }

        createSquishVisualEvent("bubble_wrap", azimuth, vel);

      } else if (state.currentSquishMat === "sourdough_knead") {
        // 🍞 7. 慢发酵酸种面团：高含水面团掌根深压延展 + 湿润面筋粘滞剥离 + 偶发发酵气孔温润轻叹
        const pressDur = (0.38 + Math.random() * 0.18) * durScale;
        // 湿重面团受压质量沉音 (温和克制，告别原 0.38 增益的 808 底鼓声)
        spawnSquishModal(82 + Math.random() * 12, 44, 0.15 * vel, 0.022, 0.125, 175, 0);
        // 掌根推压高含水酸种面团的厚实湿润形变
        spawnSquishNoise("lowpass", 155, 285, 140, 1.35, 0.23 * vel, 0.052, pressDur * 0.45, pressDur * 0.55, Math.min(effectiveCutoff, 440), 0, mode === "fold");
        spawnSquishNoise("bandpass", 220, 390, 185, 1.75, 0.19 * vel, 0.045, pressDur * 0.42, pressDur * 0.58, Math.min(effectiveCutoff, 620), 0.015, mode === "fold");

        // 翻折提起面团时的湿润面筋粘滞剥离 + 酵母气室缓慢排气轻叹 (Fermentation Gas Sigh)
        const sighDelay = pressDur * 0.62 + (0.02 + Math.random() * 0.04);
        const sighDur = (0.28 + Math.random() * 0.16) * durScale;
        const { freq } = sampleDistinctSquishPitch("low");
        spawnSquishNoise("bandpass", freq * 0.85, Math.min(effectiveCutoff, freq * 1.45), freq * 0.72, 1.95, 0.17 * vel, 0.032, sighDur * 0.38, sighDur * 0.62, Math.min(effectiveCutoff, 680), sighDelay, false);

        const porePops = mode === "bursts" ? (2 + Math.floor(Math.random() * 2)) : (Math.random() < 0.72 ? 1 : 2);
        for (let i = 0; i < porePops; i++) {
          spawnDampedPorePop(sighDelay + 0.035 + i * (0.065 + Math.random() * 0.06), i === 0 ? "low" : "mid", 0.58, 0.62);
        }

        createSquishVisualEvent("sourdough_knead", azimuth, vel);

      } else if (state.currentSquishMat === "silicone_pop") {
        // 🔘 8. 硅胶解压按按乐：厚实硅胶碗指腹预压阻尼 + 双稳态硅胶碗正反异频翻转钝响（支持单按与顺排变速连按）
        const dimpleCount = mode === "bursts"
          ? (3 + Math.floor(Math.random() * 2))
          : (mode === "fold" ? (2 + (Math.random() < 0.4 ? 1 : 0)) : (Math.random() < 0.32 ? 2 : 1));

        let dimpleCursor = 0;
        for (let i = 0; i < dimpleCount; i++) {
          state.squishDimplePolarity = -state.squishDimplePolarity;
          const isInward = state.squishDimplePolarity > 0;
          const tier = dimpleCount > 1 ? (i === 0 ? "low" : (i === dimpleCount - 1 ? "high" : "mid")) : null;
          const { freq } = sampleDistinctSquishPitch(tier);

          // 阶段 A：指腹按压柔韧硅胶碗壁的预屈曲橡胶阻尼微擦 (Pre-Buckling Silicone Flex)
          const preFlexDur = 0.018 + Math.random() * 0.010;
          spawnSquishNoise("bandpass", 190, 310, 220, 1.7, 0.11 * vel, 0.004, 0.005, preFlexDur, 540, dimpleCursor, false);

          // 阶段 B：硅胶碗跨过临界点的双稳态翻转钝响 (正向深按沉厚 Thock vs 反向顶出微弹 Pop)
          const snapTime = dimpleCursor + preFlexDur * 0.85;
          const domeStartF = isInward ? freq * 0.88 : freq * 1.06;
          const domeEndF = isInward ? Math.max(78, freq * 0.34) : Math.max(96, freq * 0.44);
          const hitVel = vel * (i === 0 ? 1.0 : (0.78 + Math.random() * 0.22));

          spawnSquishModal(domeStartF, domeEndF, 0.21 * hitVel, 0.0022, isInward ? 0.032 : 0.026, Math.min(effectiveCutoff, 580), snapTime);
          spawnSquishNoise(
            "bandpass",
            domeStartF * 1.25,
            domeStartF * 0.92,
            domeEndF * 1.35,
            2.35,
            0.20 * hitVel,
            0.002,
            0.003,
            isInward ? 0.024 : 0.020,
            effectiveCutoff,
            snapTime,
            false
          );

          // 顺排按压时的真人手指 Rubato 微时差
          dimpleCursor = snapTime + (0.085 + Math.random() * 0.075) * (0.85 + i * 0.18);
        }

        createSquishVisualEvent("silicone_pop", azimuth, vel);
      }
    }

    function scheduleNextSquishEvent() {
      if (!state.isPlaying || state.activeCategory !== "squish") return;

      const mat = SQUISH_MATERIALS[state.currentSquishMat] || SQUISH_MATERIALS.memory_foam;
      const style = SQUISH_STYLES[state.currentSquishStyle] || SQUISH_STYLES.deep_slow_press;

      // 1. 疏密均值回归随机游走 (Ornstein-Uhlenbeck Density Random Walk)，消除机械节拍器感
      state.squishDensityWalk += (1.0 - state.squishDensityWalk) * 0.25 + (Math.random() - 0.5) * 0.22;
      if (Math.random() < 0.12) {
        state.squishDensityWalk += (Math.random() < 0.55 ? 0.24 : -0.18);
      }
      state.squishDensityWalk = Math.max(0.64, Math.min(1.44, state.squishDensityWalk));

      const rateScale = style.rateScale || 1.0;
      const baseInterval = (mat.baseRate / Math.max(0.4, state.squishCadenceMultiplier * rateScale)) * state.squishDensityWalk;

      if (style.mode === "alternate") {
        // 双耳驻留揉抚：单侧耳畔温和驻留揉捏 1~3 次后平滑换手，融合左右手力度差与换手留白
        state.squishPhraseLeft -= 1;
        let isHandSwitch = false;
        if (state.squishPhraseLeft <= 0) {
          squishPanSide = -squishPanSide;
          state.squishPhraseLeft = 1 + Math.floor(Math.random() * 3); // 1~3 次同侧耳畔驻留
          isHandSwitch = true;
        }
        const earJitter = (Math.random() * 0.22 - 0.11);
        const az = Math.max(-0.95, Math.min(0.95, squishPanSide * (0.72 + Math.random() * 0.16) + earJitter));
        const handAsym = squishPanSide < 0 ? 0.94 : 1.02;
        const kneadVel = (0.82 + Math.random() * 0.24) * handAsym;
        triggerSquishEvent(az, kneadVel, "alternate");

        const switchPause = isHandSwitch ? (1.18 + Math.random() * 0.35) : (0.78 + Math.random() * 0.32);
        squishTimerId = setTimeout(scheduleNextSquishEvent, Math.max(420, baseInterval * switchPause));

      } else if (style.mode === "bursts") {
        // 指尖簇状捏泡：十指深捏激发异频微泡簇，偶发次级跟捏与松手换握自然停顿
        const az = Math.max(-0.90, Math.min(0.90, (Math.random() * 1.3 - 0.65) + state.squishPanBias * 0.30));
        const burstVel = 0.80 + Math.random() * 0.28;
        triggerSquishEvent(az, burstVel, "bursts");

        // 34% 概率触发指尖换位后的次级轻捏跟进
        if (Math.random() < 0.34) {
          const subDelay = 240 + Math.random() * 220;
          const subAz = Math.max(-0.92, Math.min(0.92, az + (Math.random() * 0.28 - 0.14)));
          scheduleSubTimer(() => {
            if (state.isPlaying && state.activeCategory === "squish") {
              triggerSquishEvent(subAz, burstVel * 0.72, "bursts");
            }
          }, subDelay);
        }

        // 25% 概率出现松手换握的自然呼吸留白
        const regripPause = Math.random() < 0.25 ? (1.38 + Math.random() * 0.55) : (0.74 + Math.random() * 0.42);
        squishTimerId = setTimeout(scheduleNextSquishEvent, Math.max(380, baseInterval * regripPause));

      } else if (style.mode === "fold") {
        // 绵延折叠翻卷：弃用单一正弦周期，改用双无理数波叠加 + 随机折返步长实现平滑双耳游走翻卷
        const stepDir = Math.random() < 0.18 ? -1 : 1;
        squishCyclePhase += stepDir * (0.28 + Math.random() * 0.24);
        const w1 = Math.sin(squishCyclePhase);
        const w2 = Math.sin(squishCyclePhase * Math.SQRT2 + 1.15);
        const pan = Math.max(-0.88, Math.min(0.88, (w1 * 0.62 + w2 * 0.38) * 0.76 + state.squishPanBias * 0.22));
        const foldVel = 0.76 + Math.random() * 0.26;
        triggerSquishEvent(pan, foldVel, "fold");

        const nextDelay = baseInterval * (0.78 + Math.random() * 0.38);
        squishTimerId = setTimeout(scheduleNextSquishEvent, Math.max(460, nextDelay));

      } else {
        // 深沉慢速按压 (deep_slow_press)：悠长呼吸周期深压与完整慢回弹，偶发静谧舒展留白
        const az = Math.max(-0.78, Math.min(0.78, (Math.random() * 0.76 - 0.38) + state.squishPanBias * 0.32));
        const deepVel = 0.88 + Math.random() * 0.22;
        triggerSquishEvent(az, deepVel, "deep");

        const breathPause = Math.random() < 0.20 ? (1.32 + Math.random() * 0.45) : (0.88 + Math.random() * 0.28);
        squishTimerId = setTimeout(scheduleNextSquishEvent, Math.max(680, baseInterval * breathPause));
      }
    }

    // --------------------------------------------------------------------------
    // B9. 客制化机械键盘声学合成核心 (Mechanical Keyboards Synthesizer Engine)
    //     程序化去机械感重构：行位声学阶梯、大键/空格卫星轴浑厚 Thock、真实单词连击微律动 (Rubato)、
    //     退格纠错 (Backspace Correction) 与两段式抬指释放 (Upstroke Top-Out)
    // --------------------------------------------------------------------------

    function triggerKeystroke(azimuthOverride = null, velScale = 1.0, isStabilizerKey = false, keyType = "alpha") {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "keyboard") return;

      const sw = KEYBOARD_SWITCHES[state.currentKeySwitch];
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      const isSpacebar = (keyType === "spacebar");
      const isModifier = (keyType === "modifier") || isStabilizerKey;

      // 双手打字空间方位分布 (空格与大键居中微偏，左右手按键偏置 Pan -0.55 ~ +0.55)
      let azimuth = 0;
      if (azimuthOverride !== null) {
        azimuth = azimuthOverride * state.stereoWidth;
      } else if (isSpacebar) {
        azimuth = (Math.random() * 0.18 - 0.09) * state.stereoWidth;
      } else if (isModifier) {
        azimuth = (Math.random() > 0.5 ? 0.42 : -0.42) * (0.8 + Math.random() * 0.3) * state.stereoWidth;
      } else {
        state.keyHandAlternation = (state.keyHandAlternation + 1) % 2;
        const side = state.keyHandAlternation === 0 ? -1 : 1;
        azimuth = side * (0.24 + Math.random() * 0.38) * state.stereoWidth;
      }

      const effectiveCutoff = Math.min(state.userLowpass, sw.warmthCutoff * (0.65 + (1 - state.keyThockDamping) * 0.7));
      const keyBus = audioCtx.createGain();
      keyBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(keyBus, azimuth, now);

      if (state.currentKeySwitch === "walnut_rest") {
        // 4. 实木掌托轻叩 (Solid Walnut Wrist Rest)：指腹肉感软垫 + 黑胡桃实木块双阶空腔谐振
        const fleshOsc = audioCtx.createOscillator();
        fleshOsc.type = "sine";
        fleshOsc.frequency.setValueAtTime(118 * (0.95 + Math.random() * 0.1), now);
        fleshOsc.frequency.exponentialRampToValueAtTime(48, now + 0.025);
        const fleshGain = audioCtx.createGain();
        fleshGain.gain.setValueAtTime(0.0001, now);
        fleshGain.gain.linearRampToValueAtTime(0.28 * velScale, now + 0.003);
        fleshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

        const woodOsc1 = audioCtx.createOscillator();
        const woodOsc2 = audioCtx.createOscillator();
        woodOsc1.type = "sine";
        woodOsc2.type = "sine";
        const wf = sw.baseFreq * (0.94 + Math.random() * 0.12);
        woodOsc1.frequency.setValueAtTime(wf * 1.12, now);
        woodOsc1.frequency.exponentialRampToValueAtTime(wf, now + 0.008);
        woodOsc2.frequency.setValueAtTime(Math.min(effectiveCutoff, wf * 2.08), now);

        const wg1 = audioCtx.createGain();
        wg1.gain.setValueAtTime(0.0001, now);
        wg1.gain.linearRampToValueAtTime(0.34 * velScale, now + 0.0028);
        wg1.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

        const wg2 = audioCtx.createGain();
        wg2.gain.setValueAtTime(0.0001, now);
        wg2.gain.linearRampToValueAtTime(0.11 * velScale * (1 - state.keyThockDamping * 0.4), now + 0.002);
        wg2.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

        fleshOsc.connect(fleshGain);
        woodOsc1.connect(wg1);
        woodOsc2.connect(wg2);
        fleshGain.connect(keyBus);
        wg1.connect(keyBus);
        wg2.connect(keyBus);

        fleshOsc.start(now);
        woodOsc1.start(now);
        woodOsc2.start(now);
        fleshOsc.stop(now + 0.035);
        woodOsc1.stop(now + 0.062);
        woodOsc2.stop(now + 0.03);

      } else if (state.currentKeySwitch === "coiled_cable") {
        // 5. 航插螺旋线轻弹 (Coiled Aviator Cable)：PU 螺旋线弹性阻尼回弹 + GX16 航插金属环柔化微碰
        const coilOsc = audioCtx.createOscillator();
        coilOsc.type = "sine";
        coilOsc.frequency.setValueAtTime(240 * (0.95 + Math.random() * 0.1), now);
        coilOsc.frequency.exponentialRampToValueAtTime(480, now + 0.018);
        coilOsc.frequency.exponentialRampToValueAtTime(175, now + 0.068);
        const coilGain = audioCtx.createGain();
        coilGain.gain.setValueAtTime(0.0001, now);
        coilGain.gain.linearRampToValueAtTime(0.32 * velScale, now + 0.004);
        coilGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

        const collarSrc = audioCtx.createBufferSource();
        collarSrc.buffer = buf;
        const collarBp = audioCtx.createBiquadFilter();
        collarBp.type = "bandpass";
        collarBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 960 + Math.random() * 220), now);
        collarBp.Q.setValueAtTime(3.4, now);
        const collarGain = audioCtx.createGain();
        collarGain.gain.setValueAtTime(0.0001, now);
        collarGain.gain.linearRampToValueAtTime(0.24 * velScale, now + 0.002);
        collarGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

        coilOsc.connect(coilGain);
        collarSrc.connect(collarBp);
        collarBp.connect(collarGain);
        coilGain.connect(keyBus);
        collarGain.connect(keyBus);

        coilOsc.start(now);
        coilOsc.stop(now + 0.082);
        collarSrc.start(now, Math.random() * 2.5);
        collarSrc.stop(now + 0.028);

      } else {
        // 1/2/3. 机械轴体与静电容轴 (lubed_red / topre_capacitive / holy_panda)
        const isPanda = state.currentKeySwitch === "holy_panda";
        const isTopre = state.currentKeySwitch === "topre_capacitive";

        // 键帽位置与形态声学映射 (Keycap Profile & Row Acoustic Variance)
        let pitchMul = 1.0;
        let effectiveVel = velScale;

        if (isSpacebar) {
          // 空格键 (6.25U/7U 大键)：沉闷深厚空腔 (0.70x 音高) + 大拇指较重肉感打击力度
          pitchMul = 0.70 * (0.96 + Math.random() * 0.08);
          effectiveVel = velScale * 1.15;
        } else if (isModifier) {
          // 修饰大键 (Enter / Backspace / Shift 2U~2.75U)：浑厚卫星轴阻尼与箱体共鸣
          pitchMul = 0.82 * (0.95 + Math.random() * 0.10);
          effectiveVel = velScale * 1.05;
        } else {
          // 字母按键 R1~R4 行位声学阶梯 (R1数字行偏高脆 1.12x，R4底行偏沉厚 0.93x)
          const rowBiases = [1.12, 1.04, 1.00, 0.93];
          const rowMul = rowBiases[Math.floor(Math.random() * 4)];
          pitchMul = rowMul * (0.97 + Math.random() * 0.06);
          effectiveVel = velScale * (0.86 + Math.random() * 0.25);
        }

        const mainTime = isPanda ? now + 0.010 : now;

        // 圣熊猫提前大段落 (Holy Panda Tactile Pre-Bump ~10ms 提前圆润段落反馈)
        if (isPanda) {
          const bumpOsc = audioCtx.createOscillator();
          bumpOsc.type = "sine";
          bumpOsc.frequency.setValueAtTime(460 * pitchMul, now);
          bumpOsc.frequency.exponentialRampToValueAtTime(210, now + 0.009);
          const bumpGain = audioCtx.createGain();
          bumpGain.gain.setValueAtTime(0.0001, now);
          bumpGain.gain.linearRampToValueAtTime(0.18 * effectiveVel, now + 0.0018);
          bumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.010);
          bumpOsc.connect(bumpGain);
          bumpGain.connect(keyBus);
          bumpOsc.start(now);
          bumpOsc.stop(now + 0.012);
        }

        // 轴心触底钝音 (Bottom-Out Thock / Topre Raindrop)
        const thockOsc = audioCtx.createOscillator();
        thockOsc.type = "sine";
        const baseF = sw.baseFreq * pitchMul;
        thockOsc.frequency.setValueAtTime(baseF * (isTopre ? 1.08 : 1.18), mainTime);
        thockOsc.frequency.exponentialRampToValueAtTime(Math.max(44, baseF * 0.36), mainTime + sw.thockDamp);

        const thockGain = audioCtx.createGain();
        const thockPeak = (0.38 + state.keyThockDamping * 0.16) * effectiveVel * (isSpacebar ? 1.22 : (isModifier ? 1.12 : 1.0));
        thockGain.gain.setValueAtTime(0.0001, mainTime);
        thockGain.gain.linearRampToValueAtTime(thockPeak, mainTime + (isTopre ? 0.004 : 0.0028));
        thockGain.gain.exponentialRampToValueAtTime(0.0001, mainTime + sw.thockDamp + 0.018);

        // 键帽与轴壳碰撞微声 (PBT Keycap & Housing Clack)
        const clackSrc = audioCtx.createBufferSource();
        clackSrc.buffer = buf;
        const clackBp = audioCtx.createBiquadFilter();
        clackBp.type = "bandpass";
        clackBp.frequency.setValueAtTime(Math.min(effectiveCutoff, sw.clackFreq * pitchMul), mainTime);
        clackBp.Q.setValueAtTime(isTopre ? 2.0 : 2.8, mainTime);

        const clackGain = audioCtx.createGain();
        const clackPeak = (0.26 + (1 - state.keyThockDamping) * 0.22) * effectiveVel;
        clackGain.gain.setValueAtTime(0.0001, mainTime);
        clackGain.gain.linearRampToValueAtTime(clackPeak, mainTime + 0.002);
        clackGain.gain.exponentialRampToValueAtTime(0.0001, mainTime + (isTopre ? 0.024 : 0.016));

        // 键盘桌垫吸音毛毡微下潜沉音 (Desk Mat Sub-Bass Thump: 105Hz -> 48Hz)
        const matThump = audioCtx.createOscillator();
        matThump.type = "sine";
        matThump.frequency.setValueAtTime(105 * (0.95 + Math.random() * 0.1), mainTime);
        matThump.frequency.exponentialRampToValueAtTime(48, mainTime + 0.038);
        const matGain = audioCtx.createGain();
        matGain.gain.setValueAtTime(0.0001, mainTime);
        matGain.gain.linearRampToValueAtTime(0.12 * effectiveVel * (isSpacebar ? 1.35 : 1.0), mainTime + 0.003);
        matGain.gain.exponentialRampToValueAtTime(0.0001, mainTime + 0.042);

        // 卫星轴钢丝微油润咬合声 (Stabilizer Wire Lubricated Micro-Tick for Spacebar/Mods)
        if (isSpacebar || isModifier) {
          const wireSrc = audioCtx.createBufferSource();
          wireSrc.buffer = buf;
          const wireBp = audioCtx.createBiquadFilter();
          wireBp.type = "bandpass";
          wireBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 1250 + Math.random() * 200), mainTime);
          wireBp.Q.setValueAtTime(3.6, mainTime);
          const wireGain = audioCtx.createGain();
          wireGain.gain.setValueAtTime(0.0001, mainTime);
          wireGain.gain.linearRampToValueAtTime(0.08 * effectiveVel * (1 - state.keyThockDamping * 0.35), mainTime + 0.0018);
          wireGain.gain.exponentialRampToValueAtTime(0.0001, mainTime + 0.012);
          wireSrc.connect(wireBp);
          wireBp.connect(wireGain);
          wireGain.connect(keyBus);
          wireSrc.start(mainTime, Math.random() * 2.0);
          wireSrc.stop(mainTime + 0.016);
        }

        thockOsc.connect(thockGain);
        clackSrc.connect(clackBp);
        clackBp.connect(clackGain);
        matThump.connect(matGain);
        thockGain.connect(keyBus);
        clackGain.connect(keyBus);
        matGain.connect(keyBus);

        thockOsc.start(mainTime);
        thockOsc.stop(mainTime + sw.thockDamp + 0.028);
        clackSrc.start(mainTime, Math.random() * 2.5);
        clackSrc.stop(mainTime + 0.03);
        matThump.start(mainTime);
        matThump.stop(mainTime + 0.045);

        // 键帽回弹上盖微声 (Upstroke Top-Out Return 随手指按压驻留时间 Dwell Time 解耦)
        const dwellTime = (isSpacebar || isModifier) ? (0.052 + Math.random() * 0.032) : (0.030 + Math.random() * 0.022);
        const upTime = mainTime + dwellTime;
        const upOsc = audioCtx.createOscillator();
        upOsc.type = "sine";
        upOsc.frequency.setValueAtTime(Math.min(effectiveCutoff, baseF * (isTopre ? 1.15 : 1.45)), upTime);
        upOsc.frequency.exponentialRampToValueAtTime(baseF * 0.72, upTime + 0.018);
        const upGain = audioCtx.createGain();
        upGain.gain.setValueAtTime(0.0001, upTime);
        upGain.gain.linearRampToValueAtTime(thockPeak * (isTopre ? 0.28 : 0.22), upTime + 0.002);
        upGain.gain.exponentialRampToValueAtTime(0.0001, upTime + 0.022);
        upOsc.connect(upGain);
        upGain.connect(keyBus);
        upOsc.start(upTime);
        upOsc.stop(upTime + 0.026);
      }

      // 驱动 3Dio 声学雷达、双耳 VU 电平表与人耳波纹
      if (document.hidden || reducedMotion.matches) return;
      registerAcousticEvent(azimuth, velScale * 0.85, "keyboard", "Key · " + state.currentKeySwitch);
      if (azimuth < 0) {
        earWavesL.push({ r: 6, maxR: 42 + velScale * 26, alpha: 0.8 });
      } else {
        earWavesR.push({ r: 6, maxR: 42 + velScale * 26, alpha: 0.8 });
      }

      keycapVisualEvents.push({
        x: view.getDimensions().width * (0.5 + azimuth * 0.38),
        y: view.getDimensions().height * 0.5 + (Math.random() * 40 - 20),
        radius: isSpacebar ? 14 : (isModifier ? 11 : 8),
        maxR: (isSpacebar ? 52 : (isModifier ? 42 : 35)) + velScale * 25,
        alpha: 0.72,
        color: state.currentKeySwitch === "lubed_red" ? "#f43f5e" : (state.currentKeySwitch === "topre_capacitive" ? "#38bdf8" : "#fbbf24")
      });
    }

    function scheduleNextKeystroke() {
      if (!state.isPlaying || state.activeCategory !== "keyboard") return;
      const style = KEYBOARD_STYLES[state.currentKeyStyle];
      state.keyCadenceWalk = Math.max(0.82, Math.min(1.22, (state.keyCadenceWalk || 1.0) * 0.90 + (0.85 + Math.random() * 0.3) * 0.10));
      const baseDelay = (style.baseInterval / state.keyCadenceMultiplier) * state.keyCadenceWalk;
      const jitter = (Math.random() * 2 - 1) * (baseDelay * style.jitter);

      // 模拟真人错字纠错回退机制 (Typo Correction Rubato: 错字 -> 思考微顿 -> 快速退格 -> 恢复键入)
      if (state.keyInTypoCorrection) {
        triggerKeystroke(null, 0.96, true, "modifier");
        state.keyTypoBackspacesLeft = (state.keyTypoBackspacesLeft || 1) - 1;
        if (state.keyTypoBackspacesLeft <= 0) {
          state.keyInTypoCorrection = false;
          // 修正完毕后的短暂构思留白 (140~240ms)
          const delay = Math.max(68, baseDelay * (1.25 + Math.random() * 0.45));
          keyTimerId = setTimeout(scheduleNextKeystroke, delay);
          return;
        } else {
          // 连按退格键轻快节奏 (50~75ms)
          const delay = Math.max(48, baseDelay * (0.45 + Math.random() * 0.15));
          keyTimerId = setTimeout(scheduleNextKeystroke, delay);
          return;
        }
      }

      // 7% 概率发生真实手误输入 (在沉思与心流打字场景中激发生动伴读感)
      if ((state.currentKeyStyle === "flow_typing" || state.currentKeyStyle === "slow_code") && Math.random() < 0.07 && keyStrokeCounter > 8 && (state.keyWordKeysLeft || 4) > 1) {
        triggerKeystroke(null, 0.85 + Math.random() * 0.20, false, "alpha");
        state.keyInTypoCorrection = true;
        state.keyTypoBackspacesLeft = 1 + (Math.random() < 0.35 ? 1 : 0);
        // 错字意识到停顿反应时间 (110~180ms)
        const delay = Math.max(85, baseDelay * (1.15 + Math.random() * 0.45));
        keyTimerId = setTimeout(scheduleNextKeystroke, delay);
        return;
      }

      // 真人打字单词块律动 (Word Clusters & Spacebar Cadence)
      keyStrokeCounter++;
      state.keyWordKeysLeft = (state.keyWordKeysLeft || 4) - 1;

      if (state.keyWordKeysLeft <= 0) {
        // 单词结束：敲击空格键 (Spacebar)，并进入词间思考自然微顿
        triggerKeystroke(null, 1.15 + Math.random() * 0.12, true, "spacebar");
        state.keyWordKeysLeft = 3 + Math.floor(Math.random() * 6);
        const wordPause = baseDelay * (0.75 + Math.random() * 0.55);
        const delay = Math.max(50, baseDelay + jitter + wordPause);
        keyTimerId = setTimeout(scheduleNextKeystroke, delay);

      } else if (keyStrokeCounter % 32 === 0) {
        // 句子/段落结束：敲击回车键 (Enter)，并沉思留白
        triggerKeystroke(null, 1.18 + Math.random() * 0.15, true, "modifier");
        const sentencePause = baseDelay * (2.1 + Math.random() * 1.4);
        const delay = Math.max(90, baseDelay + sentencePause);
        keyTimerId = setTimeout(scheduleNextKeystroke, delay);

      } else {
        // 单词内部按键：如果左右手交替，触发顺畅轻快的连击双拍 (Digraph Roll ~65-95ms)
        state.keyHandAlternation = (state.keyHandAlternation + 1) % 2;
        const isAltRoll = (state.keyHandAlternation === 0);
        triggerKeystroke(null, 0.88 + Math.random() * 0.22, false, "alpha");
        const rollFactor = isAltRoll ? 0.72 : 1.08;
        const delay = Math.max(40, (baseDelay * rollFactor) + jitter * 0.5);
        keyTimerId = setTimeout(scheduleNextKeystroke, delay);
      }
    }

    // --------------------------------------------------------------------------
    // B10. 复古模拟与深空漫游声学合成核心 (Cosmic Drone & Vintage Analog Engine)
    //      去周期性重构：33⅓ RPM 黑胶转盘微偏心、黑胶微尘与周期划痕、磁带抖晃压带轮啮合、短波外差啸叫连续调谐漫游
    // --------------------------------------------------------------------------

    function triggerAmbientMicroEvent(azimuthOverride = null, velScale = 1.0) {
      if (!audioCtx || (!state.isPlaying && azimuthOverride === null) || state.activeCategory !== "ambient") return;

      const med = AMBIENT_MEDIA[state.currentAmbMedia];
      const now = scope.time();
      const buf = getFrictionNoiseBuffer();
      if (!buf) return;

      let azimuth = 0;
      if (azimuthOverride !== null) {
        azimuth = azimuthOverride * state.stereoWidth;
      } else {
        azimuth = (Math.random() * 1.6 - 0.8) * state.stereoWidth;
      }

      const effectiveCutoff = Math.min(state.userLowpass, med.warmthCutoff);
      const ambBus = audioCtx.createGain();
      ambBus.gain.setValueAtTime(1.0, now);
      connectTo3DioStage(ambBus, azimuth, now);

      if (state.currentAmbMedia === "vinyl_record") {
        // 1. 复古黑胶唱机：33⅓ RPM 旋转偏心微抖晃 (1.818s周期) + 音轨微尘轻爆 + 偶发周期性划痕微响 (Groove Speck)
        state.ambTurntableAngle = ((state.ambTurntableAngle || 0) + 0.55 * Math.PI * 2 * 0.18) % (Math.PI * 2);

        // 微尘爆音 (Micro-Dust Crackles)
        const isSpeck = (state.ambVinylSpeckRemaining || 0) > 0;
        if (isSpeck) {
          state.ambVinylSpeckRemaining--;
        } else if (Math.random() < 0.20) {
          state.ambVinylSpeckRemaining = 1 + Math.floor(Math.random() * 2);
        }

        const popCount = isSpeck ? 1 : (1 + (Math.random() < 0.35 ? 1 : 0));
        for (let i = 0; i < popCount; i++) {
          const popTime = now + i * 0.022;
          const popSrc = audioCtx.createBufferSource();
          popSrc.buffer = buf;

          const bp = audioCtx.createBiquadFilter();
          bp.type = "bandpass";
          const centerF = isSpeck ? (1450 + Math.random() * 350) : (880 + Math.random() * 420);
          bp.frequency.setValueAtTime(Math.min(effectiveCutoff, centerF), popTime);
          bp.Q.setValueAtTime(isSpeck ? 4.2 : 3.4, popTime);

          const gain = audioCtx.createGain();
          gain.gain.setValueAtTime(0.0001, popTime);
          const popVel = (isSpeck ? 0.28 : 0.22) * state.ambGrain * velScale;
          gain.gain.linearRampToValueAtTime(popVel, popTime + 0.0018);
          gain.gain.exponentialRampToValueAtTime(0.0001, popTime + (isSpeck ? 0.012 : 0.018));

          popSrc.connect(bp);
          bp.connect(gain);
          gain.connect(ambBus);

          popSrc.start(popTime, Math.random() * 2.5);
          popSrc.stop(popTime + 0.024);
        }

        // 唱臂唱针音轨低频惯性沉音 (Tonearm Cartridge Compliance Thump: 95Hz -> 44Hz)
        const grooveThump = audioCtx.createOscillator();
        grooveThump.type = "sine";
        grooveThump.frequency.setValueAtTime(95 * (0.95 + Math.random() * 0.1), now);
        grooveThump.frequency.exponentialRampToValueAtTime(44, now + 0.038);
        const thumpGain = audioCtx.createGain();
        thumpGain.gain.setValueAtTime(0.0001, now);
        thumpGain.gain.linearRampToValueAtTime(0.14 * state.ambGrain * velScale, now + 0.004);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);
        grooveThump.connect(thumpGain);
        thumpGain.connect(ambBus);
        grooveThump.start(now);
        grooveThump.stop(now + 0.048);

      } else if (state.currentAmbMedia === "starship_drone") {
        // 2. 星际飞船低频舱鸣：深空舱体压力平衡气阀轻叹与次低频谐波对流
        const hullOsc = audioCtx.createOscillator();
        hullOsc.type = "sine";
        hullOsc.frequency.setValueAtTime(55 * (0.98 + Math.random() * 0.04), now);
        hullOsc.frequency.linearRampToValueAtTime(78.5, now + 0.55);
        hullOsc.frequency.exponentialRampToValueAtTime(48, now + 1.45);

        const hullGain = audioCtx.createGain();
        hullGain.gain.setValueAtTime(0.0001, now);
        hullGain.gain.linearRampToValueAtTime(0.20 * state.ambDepth * velScale, now + 0.35);
        hullGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

        const ventSrc = audioCtx.createBufferSource();
        ventSrc.buffer = buf;
        const ventBp = audioCtx.createBiquadFilter();
        ventBp.type = "bandpass";
        ventBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 260 + Math.random() * 40), now);
        ventBp.Q.setValueAtTime(2.2, now);
        const ventGain = audioCtx.createGain();
        ventGain.gain.setValueAtTime(0.0001, now);
        ventGain.gain.linearRampToValueAtTime(0.12 * state.ambGrain * velScale, now + 0.25);
        ventGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        hullOsc.connect(hullGain);
        ventSrc.connect(ventBp);
        ventBp.connect(ventGain);
        hullGain.connect(ambBus);
        ventGain.connect(ambBus);

        hullOsc.start(now);
        hullOsc.stop(now + 1.55);
        ventSrc.start(now, Math.random() * 2.5);
        ventSrc.stop(now + 1.25);

      } else if (state.currentAmbMedia === "shortwave_radio") {
        // 3. 模拟短波收音机：深夜电离层载波连续调谐频漂外差微啸 (Analog Heterodyne Whistle Glide) + 柔和静电微爆
        state.ambRadioWhistleTarget = 320 + Math.random() * 420;
        state.ambRadioWhistleFreq = (state.ambRadioWhistleFreq || 460) * 0.72 + state.ambRadioWhistleTarget * 0.28;

        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        const startF = Math.min(effectiveCutoff, state.ambRadioWhistleFreq);
        osc.frequency.setValueAtTime(startF, now);
        osc.frequency.linearRampToValueAtTime(startF + (Math.random() * 60 - 30), now + 0.55);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.085 * state.ambGrain * velScale, now + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

        // 电离层天电杂音微脉冲 (Atmospheric Static Burst)
        const burstSrc = audioCtx.createBufferSource();
        burstSrc.buffer = buf;
        const burstBp = audioCtx.createBiquadFilter();
        burstBp.type = "bandpass";
        burstBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 650 + Math.random() * 250), now);
        burstBp.Q.setValueAtTime(1.8, now);
        const burstGain = audioCtx.createGain();
        burstGain.gain.setValueAtTime(0.0001, now);
        burstGain.gain.linearRampToValueAtTime(0.09 * state.ambGrain * velScale, now + 0.015);
        burstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
        burstSrc.connect(burstBp);
        burstBp.connect(burstGain);
        burstGain.connect(ambBus);
        burstSrc.start(now, Math.random() * 2.0);
        burstSrc.stop(now + 0.095);

        osc.connect(gain);
        gain.connect(ambBus);
        osc.start(now);
        osc.stop(now + 0.66);

      } else if (state.currentAmbMedia === "walkman_tape") {
        // 4. 磁带随身听机械底噪：微型压带轮/惰轮齿轮轻转微咔 + 磁头微温饱和方位角漂移
        const gearOsc = audioCtx.createOscillator();
        gearOsc.type = "sine";
        gearOsc.frequency.setValueAtTime(420 * (0.95 + Math.random() * 0.1), now);
        gearOsc.frequency.exponentialRampToValueAtTime(165, now + 0.018);
        const gearGain = audioCtx.createGain();
        gearGain.gain.setValueAtTime(0.0001, now);
        gearGain.gain.linearRampToValueAtTime(0.15 * state.ambGrain * velScale, now + 0.002);
        gearGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

        const tapeSrc = audioCtx.createBufferSource();
        tapeSrc.buffer = buf;
        const tapeBp = audioCtx.createBiquadFilter();
        tapeBp.type = "bandpass";
        tapeBp.frequency.setValueAtTime(Math.min(effectiveCutoff, 520), now);
        tapeBp.frequency.linearRampToValueAtTime(Math.min(effectiveCutoff, 740), now + 0.18);
        tapeBp.Q.setValueAtTime(2.0, now);
        const tapeGain = audioCtx.createGain();
        tapeGain.gain.setValueAtTime(0.0001, now);
        tapeGain.gain.linearRampToValueAtTime(0.16 * state.ambGrain * velScale, now + 0.06);
        tapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

        gearOsc.connect(gearGain);
        tapeSrc.connect(tapeBp);
        tapeBp.connect(tapeGain);
        gearGain.connect(ambBus);
        tapeGain.connect(ambBus);

        gearOsc.start(now);
        gearOsc.stop(now + 0.025);
        tapeSrc.start(now, Math.random() * 2.5);
        tapeSrc.stop(now + 0.38);

      } else if (state.currentAmbMedia === "glacier_resonance") {
        // 5. 极地冰川深层共鸣：深海冰架次声波应力舒展 (78Hz->32Hz) + 冰晶声学频散微鸣 (420Hz->240Hz)
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(78 + Math.random() * 38, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.32);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.32 * state.ambDepth * velScale, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

        const iceChime = audioCtx.createOscillator();
        iceChime.type = "sine";
        const cStart = Math.min(effectiveCutoff, 420 + Math.random() * 120);
        iceChime.frequency.setValueAtTime(cStart, now);
        iceChime.frequency.exponentialRampToValueAtTime(cStart * 0.58, now + 0.16);
        const chimeGain = audioCtx.createGain();
        chimeGain.gain.setValueAtTime(0.0001, now);
        chimeGain.gain.linearRampToValueAtTime(0.11 * state.ambGrain * velScale, now + 0.008);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

        osc.connect(gain);
        iceChime.connect(chimeGain);
        gain.connect(ambBus);
        chimeGain.connect(ambBus);

        osc.start(now);
        osc.stop(now + 0.42);
        iceChime.start(now);
        iceChime.stop(now + 0.22);
      }

      if (document.hidden || reducedMotion.matches) return;
      registerAcousticEvent(azimuth, velScale * 0.65, "ambient", "Cosmic · " + state.currentAmbMedia);
      if (azimuth < 0) {
        earWavesL.push({ r: 6, maxR: 40 + velScale * 24, alpha: 0.72 });
      } else {
        earWavesR.push({ r: 6, maxR: 40 + velScale * 24, alpha: 0.72 });
      }

      cosmicVisualEvents.push({
        x: view.getDimensions().width * (0.5 + azimuth * 0.4),
        y: view.getDimensions().height * 0.5 + (Math.random() * 50 - 25),
        radius: 4,
        maxR: 45 + velScale * 30,
        alpha: 0.55,
        color: state.currentAmbMedia === "vinyl_record" ? "#fb923c" : (state.currentAmbMedia === "starship_drone" ? "#818cf8" : "#2dd4bf")
      });
    }

    function scheduleNextAmbientEvent() {
      if (!state.isPlaying || state.activeCategory !== "ambient") return;
      const med = AMBIENT_MEDIA[state.currentAmbMedia];
      const delay = (1000 / (med.driftRate || 0.5)) * (0.68 + Math.random() * 0.68);

      triggerAmbientMicroEvent();
      ambTimerId = setTimeout(scheduleNextAmbientEvent, delay);
    }

    // --------------------------------------------------------------------------
    // B11. 连续底声双耳空间动态调制器与启停调度 (Continuous Spatial & Filter Modulator)
    // --------------------------------------------------------------------------
    function scheduleContinuousModulation() {
      if (!state.isPlaying || !audioCtx) return;
      const now = scope.time();
      continuousModPhase += 0.18;

      if (state.activeCategory === "rain") {
        // 雨声非周期阵风起伏、双耳不对称微漂移与掩体腔体动态耦合（消除固定正弦周期的机械呼吸感）
        const rain = RAIN_PRESETS[state.currentRain] || RAIN_PRESETS.drizzle;
        const surf = RAIN_SURFACES[state.currentSurface] || RAIN_SURFACES.tent;
        const wSpd = rain.windSpeed || 0.7;

        // 随机阵风包络游走 (Ornstein-Uhlenbeck 均值回归随机过程)
        if (Math.random() < 0.16) {
          state.rainGustTarget = (Math.random() * 1.9 - 0.85) * (0.22 + wSpd * 0.14);
        }
        state.rainGustEnv += (state.rainGustTarget - state.rainGustEnv) * 0.14;
        state.rainGustPanBias = Math.max(-0.65, Math.min(0.65, state.rainGustPanBias * 0.92 + (Math.random() - 0.5) * 0.14));

        // 三重无理数频率叠加 + 随机阵风包络，永不重复
        const wave1 = Math.sin(continuousModPhase * 0.29 * wSpd);
        const wave2 = Math.sin(continuousModPhase * 0.67 * Math.SQRT2 * wSpd + 1.73);
        const wave3 = Math.cos(continuousModPhase * 0.19 * Math.PI * wSpd + 3.14);
        const windSwellL = (wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.20) * 0.12 + state.rainGustEnv * 0.35;
        const windSwellR = (Math.sin(continuousModPhase * 0.31 * wSpd + 0.9) * 0.45 + wave3 * 0.35 - wave2 * 0.20) * 0.12 + state.rainGustEnv * 0.28;

        const shelterCutoff = Math.max(280, Math.min(state.userLowpass, rain.filterFreq * (surf.lpScale || 0.8)));
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(Math.max(220, shelterCutoff * (1 + windSwellL)), now, 0.18);
          noiseFilterR.frequency.setTargetAtTime(Math.max(220, shelterCutoff * (1 + windSwellR)), now, 0.18);
        }
        if (bedPeakingL && bedPeakingR && surf) {
          const pFreq = Math.min(shelterCutoff * 0.92, surf.peakingFreq || surf.freq);
          bedPeakingL.frequency.setTargetAtTime(pFreq * (1 + windSwellL * 0.25), now, 0.18);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.04 * (1 + windSwellR * 0.25), now, 0.18);
        }
        if (bedGainL && bedGainR) {
          const panDrift = (state.rainGustPanBias * 0.22 + (windSwellL - windSwellR) * 0.45) * state.stereoWidth;
          bedGainL.gain.setTargetAtTime(Math.max(0.45, 1.0 + panDrift), now, 0.18);
          bedGainR.gain.setTargetAtTime(Math.max(0.45, 1.0 - panDrift), now, 0.18);
        }
        if (noiseGain) {
          const baseBed = rain.baseVolume * (surf.bedGainScale || 0.85);
          const swellVol = Math.max(0.05, baseBed * (1 + state.rainGustEnv * 0.22 + wave1 * 0.05));
          noiseGain.gain.setTargetAtTime(swellVol, now, 0.20);
        }
      } else if (state.activeCategory === "water") {
        // 水流声非周期双耳流体调制：三重无理数波叠加 + Ornstein-Uhlenbeck 均值回归湍流游走
        const scene = WATER_SCENARIOS[state.currentWaterScene] || WATER_SCENARIOS.spring;
        const style = WATER_STYLES[state.currentWaterStyle] || WATER_STYLES.meander;
        const baseFreq = Math.max(240, Math.min(scene.filterFreq * (0.78 + (1 - state.waterSoftness) * 0.32), state.userLowpass));
        const undSpd = (scene.undulationSpeed || 0.7) * state.waterSpeedMultiplier;

        if (Math.random() < 0.18) {
          state.waterFlowTarget = (Math.random() * 1.8 - 0.85) * 0.34;
        }
        state.waterFlowEnv += (state.waterFlowTarget - state.waterFlowEnv) * 0.15;
        state.waterPanBias = Math.max(-0.68, Math.min(0.68, state.waterPanBias * 0.90 + (Math.random() - 0.5) * 0.16));

        const w1 = Math.sin(continuousModPhase * 0.33 * undSpd);
        const w2 = Math.sin(continuousModPhase * 0.51 * Math.SQRT2 * undSpd + 1.42);
        const w3 = Math.cos(continuousModPhase * 0.21 * Math.PI * undSpd + 2.71);
        const rippleL = (w1 * 0.46 + w2 * 0.34 + w3 * 0.20) * 0.14 + state.waterFlowEnv * 0.26;
        const rippleR = (Math.cos(continuousModPhase * 0.37 * undSpd + 0.8) * 0.46 - w2 * 0.30 + w3 * 0.24) * 0.14 + state.waterFlowEnv * 0.22;

        const baseBedVol = scene.baseVolume * (scene.bedGainScale || 0.72) * (style.bedScale || 1.0);

        if (style.binauralMode === "eddy") {
          const panWave = (w1 * 0.65 + w2 * 0.35 + state.waterPanBias * 0.35) * 0.44 * state.stereoWidth;
          if (bedGainL && bedGainR) {
            bedGainL.gain.setTargetAtTime(Math.max(0.38, 1.0 - panWave), now, 0.16);
            bedGainR.gain.setTargetAtTime(Math.max(0.38, 1.0 + panWave), now, 0.16);
          }
          if (noiseFilterL && noiseFilterR) {
            noiseFilterL.frequency.setTargetAtTime(Math.max(200, baseFreq * (1 + rippleL - panWave * 0.18)), now, 0.16);
            noiseFilterR.frequency.setTargetAtTime(Math.max(200, baseFreq * (1 + rippleR + panWave * 0.18)), now, 0.16);
          }
          if (noiseGain) {
            noiseGain.gain.setTargetAtTime(Math.max(0.04, baseBedVol * (1 + state.waterFlowEnv * 0.18)), now, 0.18);
          }
        } else if (style.binauralMode === "lapping" || state.currentWaterScene === "gentle_tide") {
          // 非周期复合潮汐浪涌与退潮回落
          const tideWave = w1 * 0.55 + w2 * 0.30 + w3 * 0.15 + state.waterFlowEnv * 0.35;
          const volMod = Math.max(0.04, baseBedVol * (0.76 + 0.30 * tideWave));
          if (noiseGain) noiseGain.gain.setTargetAtTime(volMod, now, 0.18);
          if (noiseFilterL && noiseFilterR) {
            noiseFilterL.frequency.setTargetAtTime(Math.max(200, baseFreq * (0.84 + 0.24 * tideWave)), now, 0.16);
            noiseFilterR.frequency.setTargetAtTime(Math.max(200, baseFreq * (0.84 + 0.20 * tideWave + (rippleR - rippleL) * 0.3)), now, 0.16);
          }
        } else {
          if (noiseFilterL && noiseFilterR) {
            noiseFilterL.frequency.setTargetAtTime(Math.max(200, baseFreq * (1 + rippleL)), now, 0.16);
            noiseFilterR.frequency.setTargetAtTime(Math.max(200, baseFreq * (1 + rippleR)), now, 0.16);
          }
          if (bedGainL && bedGainR) {
            const drift = (state.waterPanBias * 0.18 + (rippleL - rippleR) * 0.35) * state.stereoWidth;
            bedGainL.gain.setTargetAtTime(Math.max(0.55, 1.0 + drift), now, 0.18);
            bedGainR.gain.setTargetAtTime(Math.max(0.55, 1.0 - drift), now, 0.18);
          }
          if (noiseGain) {
            noiseGain.gain.setTargetAtTime(Math.max(0.04, baseBedVol * (1 + state.waterFlowEnv * 0.20 + w1 * 0.05)), now, 0.18);
          }
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(baseFreq * 0.92, scene.peakingFreq || 560);
          bedPeakingL.frequency.setTargetAtTime(pFreq * (1 + rippleL * 0.3), now, 0.18);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.05 * (1 + rippleR * 0.3), now, 0.18);
        }
      } else if (state.activeCategory === "fire") {
        // 壁炉与自然热流非周期双耳调制：三重无理数波叠加 + Ornstein-Uhlenbeck 热对流均值回归游走 + 场景腔体耦合
        const inst = FIRE_INSTRUMENTS[state.currentFireInst] || FIRE_INSTRUMENTS.pine_fireplace;
        const style = FIRE_STYLES[state.currentFireStyle] || FIRE_STYLES.hearth_calm;
        const isGust = state.currentFireStyle === "night_wind_gust";
        const cSpd = (inst.convectionSpeed || 0.5) * (isGust ? 1.35 : 0.85);

        if (Math.random() < 0.16) {
          state.fireConvectionTarget = (Math.random() * 1.8 - 0.85) * (isGust ? 0.38 : 0.22);
        }
        state.fireConvectionEnv += (state.fireConvectionTarget - state.fireConvectionEnv) * 0.14;
        state.firePanBias = Math.max(-0.62, Math.min(0.62, state.firePanBias * 0.91 + (Math.random() - 0.5) * 0.14));

        const w1 = Math.sin(continuousModPhase * 0.27 * cSpd);
        const w2 = Math.sin(continuousModPhase * 0.43 * Math.SQRT2 * cSpd + 1.57);
        const w3 = Math.cos(continuousModPhase * 0.19 * Math.PI * cSpd + 2.85);
        const draftL = (w1 * 0.48 + w2 * 0.32 + w3 * 0.20) * (isGust ? 0.22 : 0.11) + state.fireConvectionEnv * 0.34;
        const draftR = (Math.cos(continuousModPhase * 0.31 * cSpd + 0.95) * 0.46 - w2 * 0.28 + w3 * 0.26) * (isGust ? 0.22 : 0.11) + state.fireConvectionEnv * 0.28;

        const baseFilterF = inst.bedFilterFreq || 320;
        const targetFreq = Math.max(150, Math.min(state.userLowpass, baseFilterF * (0.72 + state.fireWarmth * 0.55)));
        const baseBedVol = 0.20 * state.fireWarmth * (inst.bedGainScale || 0.75) * (style.bedScale || 1.0);

        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(Math.max(130, targetFreq * (1 + draftL * 0.55)), now, 0.18);
          noiseFilterR.frequency.setTargetAtTime(Math.max(130, targetFreq * (1 + draftR * 0.50)), now, 0.18);
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(targetFreq * 0.92, inst.peakingFreq || 210);
          bedPeakingL.frequency.setTargetAtTime(pFreq * (1 + draftL * 0.25), now, 0.18);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.04 * (1 + draftR * 0.25), now, 0.18);
        }
        if (bedGainL && bedGainR) {
          const panDrift = (state.firePanBias * 0.20 + (draftL - draftR) * 0.38) * state.stereoWidth;
          bedGainL.gain.setTargetAtTime(Math.max(0.50, 1.0 + panDrift), now, 0.18);
          bedGainR.gain.setTargetAtTime(Math.max(0.50, 1.0 - panDrift), now, 0.18);
        }
        if (noiseGain) {
          noiseGain.gain.setTargetAtTime(Math.max(0.008, baseBedVol * (1 + state.fireConvectionEnv * 0.24 + w1 * 0.06)), now, 0.18);
        }
      } else if (state.activeCategory === "squish") {
        // 触觉揉捏与软胶非周期双耳粘弹性呼吸调制：三重无理数波 + Ornstein-Uhlenbeck 形变游走 + 材质腔体耦合
        const mat = SQUISH_MATERIALS[state.currentSquishMat] || SQUISH_MATERIALS.memory_foam;
        const style = SQUISH_STYLES[state.currentSquishStyle] || SQUISH_STYLES.deep_slow_press;
        const bSpd = (mat.breathSpeed || 0.45) * (0.78 + state.squishCadenceMultiplier * 0.22);

        if (Math.random() < 0.16) {
          state.squishDeformTarget = (Math.random() * 1.8 - 0.85) * 0.26;
        }
        state.squishDeformEnv += (state.squishDeformTarget - state.squishDeformEnv) * 0.14;
        state.squishPanBias = Math.max(-0.62, Math.min(0.62, state.squishPanBias * 0.91 + (Math.random() - 0.5) * 0.14));

        const w1 = Math.sin(continuousModPhase * 0.25 * bSpd);
        const w2 = Math.sin(continuousModPhase * 0.41 * Math.SQRT2 * bSpd + 1.38);
        const w3 = Math.cos(continuousModPhase * 0.17 * Math.PI * bSpd + 2.64);
        const breathL = (w1 * 0.48 + w2 * 0.32 + w3 * 0.20) * 0.14 + state.squishDeformEnv * 0.32;
        const breathR = (Math.cos(continuousModPhase * 0.29 * bSpd + 0.88) * 0.46 - w2 * 0.28 + w3 * 0.26) * 0.14 + state.squishDeformEnv * 0.26;

        // 粘稠阻尼越高 (squishViscosity -> 1)，底声截止频率越低沉温厚
        const baseFilterF = mat.bedFilterFreq || 260;
        const targetFreq = Math.max(135, Math.min(state.userLowpass, baseFilterF * (1.16 - state.squishViscosity * 0.42)));
        const baseBedVol = (0.018 + 0.032 * state.squishViscosity) * (mat.bedGainScale || 0.68) * (style.bedScale || 1.0);

        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(Math.max(120, targetFreq * (1 + breathL * 0.48)), now, 0.18);
          noiseFilterR.frequency.setTargetAtTime(Math.max(120, targetFreq * (1 + breathR * 0.44)), now, 0.18);
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(targetFreq * 0.92, mat.peakingFreq || 195);
          bedPeakingL.frequency.setTargetAtTime(pFreq * (1 + breathL * 0.22), now, 0.18);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.04 * (1 + breathR * 0.22), now, 0.18);
        }
        if (bedGainL && bedGainR) {
          const panDrift = (state.squishPanBias * 0.22 + (breathL - breathR) * 0.36) * state.stereoWidth;
          bedGainL.gain.setTargetAtTime(Math.max(0.52, 1.0 + panDrift), now, 0.18);
          bedGainR.gain.setTargetAtTime(Math.max(0.52, 1.0 - panDrift), now, 0.18);
        }
        if (noiseGain) {
          noiseGain.gain.setTargetAtTime(Math.max(0.004, baseBedVol * (1 + state.squishDeformEnv * 0.22 + w1 * 0.06)), now, 0.18);
        }
      } else if (state.activeCategory === "ambient") {
        // 复古模拟与深空漫游：非周期无理数多波叠加 + 3Dio 双耳轨道洄游 / 呼吸式次低频潮汐 / 极光立体声频散
        const med = AMBIENT_MEDIA[state.currentAmbMedia];
        const style = AMBIENT_STYLES[state.currentAmbStyle];
        const baseDroneVol = Math.max(0.001, med.subDrone * state.ambDepth * 0.26);
        const baseBedVol = 0.12 * state.ambDepth + 0.16 * state.ambGrain;

        // 三阶非周期无理数波叠加 (彻底根除单一正弦固定周期机械感)
        const w1 = Math.sin(continuousModPhase * 0.173);
        const w2 = Math.sin(continuousModPhase * 0.281 + 1.35);
        const w3 = Math.sin(continuousModPhase * 0.443 + 2.68);
        state.ambDriftWalk = Math.max(-0.4, Math.min(0.4, (state.ambDriftWalk || 0) * 0.94 + (Math.random() - 0.5) * 0.08));
        state.ambFilterWalk = Math.max(0.85, Math.min(1.15, (state.ambFilterWalk || 1.0) * 0.92 + (0.88 + Math.random() * 0.24) * 0.08));

        if (state.currentAmbStyle === "binaural_orbit") {
          // 非周期多维 3Dio 椭圆漫游：声相轨迹永不机械重复
          const orbitAz = (w1 * 0.62 + w2 * 0.38 + state.ambDriftWalk * 0.30) * style.orbitDepth * state.stereoWidth;
          if (ambDronePanner) ambDronePanner.pan.setTargetAtTime(orbitAz, now, 0.16);
          if (bedGainL && bedGainR) {
            bedGainL.gain.setTargetAtTime(1.0 - orbitAz * 0.45, now, 0.16);
            bedGainR.gain.setTargetAtTime(1.0 + orbitAz * 0.45, now, 0.16);
          }
        } else if (state.currentAmbStyle === "pulsing_tide") {
          // 非对称慢速深呼吸次低频潮汐起伏
          const breath = 0.72 + 0.20 * w1 + 0.12 * w2 + 0.06 * w3;
          if (ambDroneGain) ambDroneGain.gain.setTargetAtTime(baseDroneVol * breath, now, 0.16);
          if (noiseGain) noiseGain.gain.setTargetAtTime(baseBedVol * (0.76 + 0.25 * breath), now, 0.16);
        } else if (state.currentAmbStyle === "distant_aurora") {
          // 极光频散：双耳独立异相共振峰漫步与模拟微暖温漂
          const auroraL = med.filterFreq * (0.80 + 0.20 * w1 + 0.10 * w3) * state.ambFilterWalk;
          const auroraR = med.filterFreq * (0.80 + 0.20 * w2 + 0.10 * w1) * state.ambFilterWalk;
          if (bedPeakingL && bedPeakingR) {
            bedPeakingL.frequency.setTargetAtTime(Math.min(state.userLowpass, auroraL), now, 0.16);
            bedPeakingR.frequency.setTargetAtTime(Math.min(state.userLowpass, auroraR), now, 0.16);
          }
        } else {
          // 沉浸静止空间茧：低频微滤通温和呼吸
          const cocoonFilter = Math.min(state.userLowpass, med.filterFreq * (0.95 + 0.08 * w1));
          if (noiseFilterL && noiseFilterR) {
            noiseFilterL.frequency.setTargetAtTime(cocoonFilter, now, 0.16);
            noiseFilterR.frequency.setTargetAtTime(cocoonFilter * 0.98, now, 0.16);
          }
        }
      }

      continuousModTimerId = setTimeout(scheduleContinuousModulation, 180);
    }

    function clearAllCategoryTimers() {
      if (rainDropTimerId) { clearTimeout(rainDropTimerId); rainDropTimerId = null; }
      if (thunderTimerId) { clearTimeout(thunderTimerId); thunderTimerId = null; }
      if (tapTimerId) { clearTimeout(tapTimerId); tapTimerId = null; }
      if (fricTimerId) { clearTimeout(fricTimerId); fricTimerId = null; }
      if (waterBubbleTimerId) { clearTimeout(waterBubbleTimerId); waterBubbleTimerId = null; }
      if (shishiTimerId) { clearTimeout(shishiTimerId); shishiTimerId = null; }
      if (bowlTimerId) { clearTimeout(bowlTimerId); bowlTimerId = null; }
      if (toolTimerId) { clearTimeout(toolTimerId); toolTimerId = null; }
      if (fireTimerId) { clearTimeout(fireTimerId); fireTimerId = null; }
      if (squishTimerId) { clearTimeout(squishTimerId); squishTimerId = null; }
      if (keyTimerId) { clearTimeout(keyTimerId); keyTimerId = null; }
      if (ambTimerId) { clearTimeout(ambTimerId); ambTimerId = null; }
      if (continuousModTimerId) { clearTimeout(continuousModTimerId); continuousModTimerId = null; }
      clearAllSubTimers();
    }

    function startAudio() {
      initAudioEngine();
      clearAllCategoryTimers();
      state.isPlaying = true;
      updateAcousticNodes();
      if (["rain", "water", "fire", "squish", "ambient"].includes(state.activeCategory)) scheduleContinuousModulation();

      if (state.activeCategory === "rain") {
        scheduleNextRainDrop();
        if (RAIN_PRESETS[state.currentRain].thunder) {
          thunderTimerId = setTimeout(scheduleNextThunder, 2500);
        }
      } else if (state.activeCategory === "tapping") {
        scheduleNextTap();
      } else if (state.activeCategory === "friction") {
        scheduleNextFrictionStroke();
      } else if (state.activeCategory === "water") {
        scheduleNextWaterBubble();
        if (WATER_SCENARIOS[state.currentWaterScene].shishi) {
          shishiTimerId = setTimeout(scheduleNextShishiOdoshi, 3000);
        }
      } else if (state.activeCategory === "bowls") {
        scheduleNextBowlEvent();
      } else if (state.activeCategory === "tools") {
        scheduleNextToolEvent();
      } else if (state.activeCategory === "fire") {
        scheduleNextFireEvent();
      } else if (state.activeCategory === "squish") {
        scheduleNextSquishEvent();
      } else if (state.activeCategory === "keyboard") {
        scheduleNextKeystroke();
      } else if (state.activeCategory === "ambient") {
        scheduleNextAmbientEvent();
      }

    }

    function updateAcousticNodes() {
      if (!audioCtx) return;
      const now = scope.time();

      // 1. 总音量与全局高频柔化防线同步更新
      masterGain.gain.setTargetAtTime(state.isPlaying ? 1 : 0, now, 0.05);
      if (masterWarmthFilter) {
        masterWarmthFilter.frequency.setTargetAtTime(state.userLowpass, now, 0.08);
      }

      // 2. 默认复位次低频深空谐波发生器与立体声共振峰 (仅在对应模式下开启)
      if (state.activeCategory !== "ambient" && ambDroneGain) {
        ambDroneGain.gain.setTargetAtTime(0.0001, now, 0.12);
      }
      if (bedGainL && bedGainR) {
        bedGainL.gain.setTargetAtTime(1.0, now, 0.1);
        bedGainR.gain.setTargetAtTime(1.0, now, 0.1);
      }
      if (bedPeakingL && bedPeakingR && state.activeCategory !== "water" && state.activeCategory !== "rain" && state.activeCategory !== "fire" && state.activeCategory !== "squish" && state.activeCategory !== "ambient") {
        bedPeakingL.gain.setTargetAtTime(0, now, 0.1);
        bedPeakingR.gain.setTargetAtTime(0, now, 0.1);
      }

      if (state.activeCategory === "rain") {
        // 雨声模式：启动粉红噪声底噪 + 听雨掩体空间隔音低通与腔体共振峰塑形
        const rain = RAIN_PRESETS[state.currentRain] || RAIN_PRESETS.drizzle;
        const surf = RAIN_SURFACES[state.currentSurface] || RAIN_SURFACES.tent;
        const bedVol = rain.baseVolume * (surf.bedGainScale || 0.85);
        if (noiseGain) noiseGain.gain.setTargetAtTime(state.isPlaying ? bedVol : 0.0001, now, 0.1);

        const targetFreq = Math.max(260, Math.min(state.userLowpass, rain.filterFreq * (surf.lpScale || 0.8)));
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterR.frequency.setTargetAtTime(targetFreq * 0.97, now, 0.08);
          noiseFilterL.Q.setTargetAtTime(0.75, now, 0.08);
          noiseFilterR.Q.setTargetAtTime(0.75, now, 0.08);
        }
        if (bedPeakingL && bedPeakingR && surf) {
          const pFreq = Math.min(targetFreq * 0.92, surf.peakingFreq || surf.freq);
          const pQ = surf.peakingQ || 1.4;
          const pGain = surf.peakingGain !== undefined ? surf.peakingGain : 3.2;
          bedPeakingL.frequency.setTargetAtTime(pFreq, now, 0.1);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.05, now, 0.1);
          bedPeakingL.Q.setTargetAtTime(pQ, now, 0.1);
          bedPeakingR.Q.setTargetAtTime(pQ, now, 0.1);
          bedPeakingL.gain.setTargetAtTime(pGain, now, 0.1);
          bedPeakingR.gain.setTargetAtTime(pGain, now, 0.1);
        }

        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(targetFreq) + " Hz";
      } else if (state.activeCategory === "tapping") {
        // 敲击声模式：关闭雨声持续底噪，保持极度干净干燥的敲击直达声
        if (noiseGain) noiseGain.gain.setTargetAtTime(0.0001, now, 0.1);

        const cutoff = Math.min(state.userLowpass, 1200 + (1 - state.tapSoftness) * 1100);
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(cutoff) + " Hz";
      } else if (state.activeCategory === "friction") {
        // 摩擦声模式：关闭雨声底噪，由调度器触发平滑软触剪切包络
        if (noiseGain) noiseGain.gain.setTargetAtTime(0.0001, now, 0.1);

        const mat = FRICTION_MATERIALS[state.currentFricMat];
        const baseCutoff = mat.baseFreq * (0.65 + (1 - state.fricCushion) * 0.7);
        const cutoff = Math.min(state.userLowpass, baseCutoff);
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(cutoff) + " Hz";
      } else if (state.activeCategory === "water") {
        // 水流声模式：启动微扰动清润水体底流 (Water Stream Bed) + 场景专属水体腔体共振峰
        const scene = WATER_SCENARIOS[state.currentWaterScene] || WATER_SCENARIOS.spring;
        const style = WATER_STYLES[state.currentWaterStyle] || WATER_STYLES.meander;
        const targetFreq = Math.max(240, Math.min(scene.filterFreq * (0.78 + (1 - state.waterSoftness) * 0.32), state.userLowpass));
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterR.frequency.setTargetAtTime(targetFreq * 0.97, now, 0.08);
          noiseFilterL.Q.setTargetAtTime(scene.filterQ || 1.5, now, 0.08);
          noiseFilterR.Q.setTargetAtTime(scene.filterQ || 1.5, now, 0.08);
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(targetFreq * 0.92, scene.peakingFreq || 580);
          const pQ = scene.peakingQ || 1.6;
          const pGain = scene.peakingGain || 3.5;
          bedPeakingL.frequency.setTargetAtTime(pFreq, now, 0.08);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.05, now, 0.08);
          bedPeakingL.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingR.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingL.gain.setTargetAtTime(pGain, now, 0.08);
          bedPeakingR.gain.setTargetAtTime(pGain, now, 0.08);
        }
        if (noiseGain) {
          const streamVol = state.isPlaying
            ? (scene.baseVolume * (scene.bedGainScale || 0.72) * (style.bedScale || 1.0))
            : 0.0001;
          noiseGain.gain.setTargetAtTime(streamVol, now, 0.1);
        }
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(targetFreq) + " Hz";
      } else if (state.activeCategory === "bowls") {
        // 能量泛音模式：关闭宽带底噪，呈现极度纯净通透的高纯正弦驻波
        if (noiseGain) noiseGain.gain.setTargetAtTime(0.0001, now, 0.1);

        const inst = BOWLS_INSTRUMENTS[state.currentBowlInst];
        const effectiveCutoff = Math.min(state.userLowpass, inst.warmthCutoff * (0.65 + (1 - state.bowlWarmth) * 0.7));
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(effectiveCutoff) + " Hz";
      } else if (state.activeCategory === "tools") {
        // 伴读工具与微机械模式：关闭宽带底噪，保持极度干燥的耳侧直达声
        if (noiseGain) noiseGain.gain.setTargetAtTime(0.0001, now, 0.1);

        const inst = TOOLS_INSTRUMENTS[state.currentToolInst];
        const effectiveCutoff = Math.min(state.userLowpass, inst.warmthCutoff * (0.7 + (1 - state.toolWarmth) * 0.6));
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(effectiveCutoff) + " Hz";
      } else if (state.activeCategory === "fire") {
        // 暖冬壁炉与自然微裂模式：按具体场景（砖石炉膛/秋林/营火/备长炭/桑拿房/铁砂锅）耦合连续热流底噪与腔体共振峰
        const inst = FIRE_INSTRUMENTS[state.currentFireInst] || FIRE_INSTRUMENTS.pine_fireplace;
        const style = FIRE_STYLES[state.currentFireStyle] || FIRE_STYLES.hearth_calm;
        const baseFilterF = inst.bedFilterFreq || 320;
        const targetFreq = Math.max(150, Math.min(state.userLowpass, baseFilterF * (0.72 + state.fireWarmth * 0.55)));
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterR.frequency.setTargetAtTime(targetFreq * 0.97, now, 0.08);
          noiseFilterL.Q.setTargetAtTime(inst.bedFilterQ || 1.25, now, 0.08);
          noiseFilterR.Q.setTargetAtTime(inst.bedFilterQ || 1.25, now, 0.08);
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(targetFreq * 0.92, inst.peakingFreq || 210);
          const pQ = inst.peakingQ || 1.45;
          const pGain = inst.peakingGain !== undefined ? inst.peakingGain : 3.4;
          bedPeakingL.frequency.setTargetAtTime(pFreq, now, 0.08);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.04, now, 0.08);
          bedPeakingL.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingR.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingL.gain.setTargetAtTime(pGain, now, 0.08);
          bedPeakingR.gain.setTargetAtTime(pGain, now, 0.08);
        }
        if (noiseGain) {
          const convectionVol = state.isPlaying
            ? (0.20 * state.fireWarmth * (inst.bedGainScale || 0.75) * (style.bedScale || 1.0))
            : 0.0001;
          noiseGain.gain.setTargetAtTime(convectionVol, now, 0.1);
        }
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(targetFreq) + " Hz";
      } else if (state.activeCategory === "squish") {
        // 触觉揉捏模式：耦合具体软体材质（记忆海绵/蜂蜡/水晶泥/亚麻/流沙/气泡膜/酸种面团/硅胶）的低中频粘弹性腔体声底
        const mat = SQUISH_MATERIALS[state.currentSquishMat] || SQUISH_MATERIALS.memory_foam;
        const style = SQUISH_STYLES[state.currentSquishStyle] || SQUISH_STYLES.deep_slow_press;
        const baseFilterF = mat.bedFilterFreq || 260;
        const targetFreq = Math.max(135, Math.min(state.userLowpass, baseFilterF * (1.16 - state.squishViscosity * 0.42)));
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterR.frequency.setTargetAtTime(targetFreq * 0.96, now, 0.08);
          noiseFilterL.Q.setTargetAtTime(mat.bedFilterQ || 1.2, now, 0.08);
          noiseFilterR.Q.setTargetAtTime(mat.bedFilterQ || 1.2, now, 0.08);
        }
        if (bedPeakingL && bedPeakingR) {
          const pFreq = Math.min(targetFreq * 0.92, mat.peakingFreq || 195);
          const pQ = mat.peakingQ || 1.45;
          const pGain = mat.peakingGain !== undefined ? mat.peakingGain : 2.8;
          bedPeakingL.frequency.setTargetAtTime(pFreq, now, 0.08);
          bedPeakingR.frequency.setTargetAtTime(pFreq * 1.04, now, 0.08);
          bedPeakingL.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingR.Q.setTargetAtTime(pQ, now, 0.08);
          bedPeakingL.gain.setTargetAtTime(pGain, now, 0.08);
          bedPeakingR.gain.setTargetAtTime(pGain, now, 0.08);
        }
        if (noiseGain) {
          const bedVol = state.isPlaying
            ? ((0.018 + 0.032 * state.squishViscosity) * (mat.bedGainScale || 0.68) * (style.bedScale || 1.0))
            : 0.0001;
          noiseGain.gain.setTargetAtTime(bedVol, now, 0.1);
        }
        const effectiveCutoff = Math.max(240, Math.min(state.userLowpass, (mat.warmthCutoff || 1400) * (0.62 + (1 - state.squishViscosity) * 0.64)));
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(effectiveCutoff) + " Hz";
      } else if (state.activeCategory === "keyboard") {
        // 机械键盘模式：关闭雨声宽带底噪，保持干燥耳侧直达声
        if (noiseGain) noiseGain.gain.setTargetAtTime(0.0001, now, 0.1);
        const sw = KEYBOARD_SWITCHES[state.currentKeySwitch];
        const effectiveCutoff = Math.min(state.userLowpass, sw.warmthCutoff * (0.65 + (1 - state.keyThockDamping) * 0.7));
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(effectiveCutoff) + " Hz";
      } else if (state.activeCategory === "ambient") {
        // 复古模拟与深空模式：启动深层次低频谐波发生器 (ambDroneOsc1/2/Sub) + 温热磁带/黑胶底流
        const med = AMBIENT_MEDIA[state.currentAmbMedia];
        const targetFreq = Math.min(state.userLowpass, med.filterFreq);
        if (noiseFilterL && noiseFilterR) {
          noiseFilterL.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterR.frequency.setTargetAtTime(targetFreq, now, 0.08);
          noiseFilterL.Q.setTargetAtTime(1.5, now, 0.08);
          noiseFilterR.Q.setTargetAtTime(1.5, now, 0.08);
        }
        if (bedPeakingL && bedPeakingR) {
          bedPeakingL.frequency.setTargetAtTime(Math.min(targetFreq, med.baseFreq * 2.4), now, 0.1);
          bedPeakingR.frequency.setTargetAtTime(Math.min(targetFreq, med.baseFreq * 2.55), now, 0.1);
          bedPeakingL.gain.setTargetAtTime(3.2, now, 0.1);
          bedPeakingR.gain.setTargetAtTime(3.2, now, 0.1);
        }
        if (noiseGain) {
          const bedVol = state.isPlaying ? (0.12 * state.ambDepth + 0.16 * state.ambGrain) : 0.0001;
          noiseGain.gain.setTargetAtTime(bedVol, now, 0.12);
        }
        if (ambDroneOsc1 && ambDroneOsc2 && ambSubOsc && ambDroneFilter && ambDroneGain) {
          ambDroneOsc1.frequency.setTargetAtTime(med.baseFreq, now, 0.12);
          ambDroneOsc2.frequency.setTargetAtTime(med.baseFreq * 1.498, now, 0.12);
          ambSubOsc.frequency.setTargetAtTime(Math.max(24, med.baseFreq * 0.5), now, 0.12);
          ambDroneFilter.frequency.setTargetAtTime(Math.min(state.userLowpass, med.warmthCutoff * 0.45), now, 0.12);
          const subGainVal = state.isPlaying ? Math.max(0.001, med.subDrone * state.ambDepth * 0.26) : 0.0001;
          ambDroneGain.gain.setTargetAtTime(subGainVal, now, 0.15);
        }
        if (ambDronePanner && state.currentAmbStyle === "deep_cocoon") {
          ambDronePanner.pan.setTargetAtTime(0, now, 0.15);
        }
        const hudFreq = document.getElementById("hudFilterFreq");
        if (hudFreq) hudFreq.textContent = "LPF " + Math.round(targetFreq) + " Hz";
      }
    }

    return {
      start(when) { initAudioEngine(); scope.run(startAudio, when); },
      update(patch) { Object.assign(state, patch); scope.run(updateAcousticNodes, scope.time()); },
      audition(azimuth) {
        scope.run(() => {
          const triggers = { rain: triggerBinauralRainDrop, tapping: triggerSingleTap,
            water: triggerWaterBubble, bowls: triggerBowlStrike, tools: triggerToolEvent,
            fire: triggerFireEvent, squish: triggerSquishEvent, keyboard: triggerKeystroke,
            ambient: triggerAmbientMicroEvent };
          if (state.activeCategory === 'friction') triggerFrictionStroke(azimuth, -azimuth, 1, 0.9);
          else triggers[state.activeCategory](azimuth);
        }, scope.time() + 0.01);
      },
      stop() { state.isPlaying = false; clearAllCategoryTimers(); scope.cancel(); },
      dispose() { state.isPlaying = false; scope.dispose(); },
      get scope() { return scope; }
    };
  }


  window.AsmrVoices = { create: createVoice };
})();
