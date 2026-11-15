(() => {
  function initLcdStripSimulator() {
    const root = document.getElementById('strip-demo-app');
    if (!root) return;

    const FORCE_SEQ = [45.20, 89.60, 63.80, 28.40];
    let forceSeqIdx = 0;

    let currentStrip = 0;       // 0..39: currently rendered strip in SRAM & GRAM
    let frameComplete = true;   // true when all 40 strips of current frame are complete
    let frameNumber = 1;
    let snapshotEnabled = true;
    let autoJumpEnabled = false;

    let realTimeVal = FORCE_SEQ[0];
    let snapshotVal = FORCE_SEQ[0];
    let prevFrameVal = FORCE_SEQ[0];
    let peakVal = 92.40;

    let frameWavePhase = 0;
    let liveWavePhase = 0;
    let prevFramePhase = 0;

    // Raw live value and wave phase at the moment each strip 0..39 was scanned in current frame
    const stripRawValues = new Float64Array(40).fill(realTimeVal);
    const stripRawPhases = new Float64Array(40).fill(0);
    let midFrameJumpHappened = false;

    let isRunning = false;
    let autoJumpTimer = null;
    let stepInterval = 45;

    // requestAnimationFrame scheduler: state changes only mark the view dirty,
    // and canvas / DOM are refreshed at most once per display frame.
    let rafId = 0;
    let lastTs = 0;
    let stepAccum = 0;
    let renderDirty = false;
    let pulseStart = -1; // >= 0 while a manual-step pipeline pulse is animating
    let activeStage = -1;
    const LOG_MAX_LINES = 120;
    const FRAME_CACHE_MAX = 8;
    const frameCache = new Map(); // key -> pre-rendered 240x320 canvas

    // Viewport & Canvases
    const screenViewport = root.querySelector('#strip-screen-viewport');
    const screenCanvas = root.querySelector('#strip-screen-canvas');
    const sramCanvas = root.querySelector('#strip-sram-canvas');
    const elScanLine = root.querySelector('#strip-band');
    const elScanTag = root.querySelector('#strip-scan-tag');
    const elTearSeam = root.querySelector('#strip-tear-seam');
    const elTearBadge = root.querySelector('#strip-tear-badge');
    const elDmaBadge = root.querySelector('#strip-dma-badge');
    const elClipInfo = root.querySelector('#strip-clip-info');
    const elFrameCounter = root.querySelector('#strip-frame-counter');
    const elProgGrid = root.querySelector('#strip-progress-grid');

    // Pipeline stages
    const stClip = root.querySelector('#strip-st-clip');
    const stWin = root.querySelector('#strip-st-win');
    const stDma = root.querySelector('#strip-st-dma');
    const stWait = root.querySelector('#strip-st-wait');

    // Diagnostic stat elements
    const elStatStrip = root.querySelector('#strip-stat-strip');
    const elStatY = root.querySelector('#strip-stat-y');
    const elStatTear = root.querySelector('#strip-stat-tear');
    const elStatLive = root.querySelector('#strip-stat-live');
    const elStatSnap = root.querySelector('#strip-stat-snap');
    const elStatPending = root.querySelector('#strip-stat-pending');
    const elStatSeam = root.querySelector('#strip-stat-seam');
    const elLog = root.querySelector('#strip-log');
    if (elLog) elLog.setAttribute('aria-live', 'off');

    // Controls
    const chkSnapshot = root.querySelector('#strip-chk-snapshot');
    const chkAutoJump = root.querySelector('#strip-chk-auto-jump');
    const speedSelect = root.querySelector('#strip-speed-select');
    const elBtnStep = root.querySelector('#strip-btn-step');
    const elBtnRun = root.querySelector('#strip-btn-run');
    const elBtnJump = root.querySelector('#strip-btn-jump');
    const elBtnReset = root.querySelector('#strip-btn-reset');
    const elPresetSafe = root.querySelector('#strip-preset-safe');
    const elPresetTear = root.querySelector('#strip-preset-tear');
    const elPresetInspect = root.querySelector('#strip-preset-inspect');

    // Legacy DOM text readout compatibility
    const elVal = root.querySelector('#strip-screen-val');

    const screenCtx = screenCanvas ? screenCanvas.getContext('2d') : null;
    const sramCtx = sramCanvas ? sramCanvas.getContext('2d') : null;

    // Build 40-strip interactive progress cells
    const progCells = [];
    if (elProgGrid) {
      elProgGrid.innerHTML = '';
      for (let i = 0; i < 40; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'strip-prog-cell';
        cell.title = `点击定位至 Strip ${i} (y = ${i * 8}..${i * 8 + 7})`;
        cell.setAttribute('aria-label', `定位至条带 ${i}`);
        cell.addEventListener('click', () => jumpToStrip(i));
        elProgGrid.appendChild(cell);
        progCells.push(cell);
      }
    }

    const LOG_VISIBLE = 6; // 135px viewport fits ~5-6 lines; keep a pre-allocated ring of 6 rows (zero scrollHeight layout!)
    const logHistory = [];
    let logDirty = false;
    const logPool = [];
    if (elLog) {
      elLog.textContent = '';
      for (let i = 0; i < LOG_VISIBLE; i++) {
        const line = document.createElement('div');
        line.className = 'aiw-log-line';
        line.style.display = 'none';
        const tSpan = document.createElement('span');
        tSpan.className = 'aiw-log-time';
        const mSpan = document.createElement('span');
        line.append(tSpan, ' ', mSpan);
        elLog.appendChild(line);
        logPool.push({ line, tSpan, mSpan, time: '', msg: '', cls: '' });
      }
    }

    function flushLogs() {
      if (!elLog || !logDirty) return;
      logDirty = false;
      const startIdx = Math.max(0, logHistory.length - LOG_VISIBLE);
      const count = logHistory.length - startIdx;
      for (let i = 0; i < LOG_VISIBLE; i++) {
        const slot = logPool[i];
        if (i < count) {
          const item = logHistory[startIdx + i];
          if (slot.line.style.display === 'none') slot.line.style.display = '';
          if (slot.time !== item.time) {
            slot.tSpan.textContent = item.time;
            slot.time = item.time;
          }
          const cls = item.type !== 'normal' ? `aiw-log-${item.type}` : '';
          if (slot.cls !== cls) {
            slot.mSpan.className = cls;
            slot.cls = cls;
          }
          if (slot.msg !== item.msg) {
            slot.mSpan.textContent = item.msg;
            slot.msg = item.msg;
          }
        } else if (slot.line.style.display !== 'none') {
          slot.line.style.display = 'none';
        }
      }
    }

    function log(msg, type = 'normal', stripOverride = currentStrip) {
      if (!elLog) return;
      const time = `[F${frameNumber}·S${String(stripOverride).padStart(2, '0')}]`;
      logHistory.push({ time, msg, type });
      if (logHistory.length > LOG_MAX_LINES) logHistory.shift();
      logDirty = true;
      requestRender();
    }

    function nextForceValue(baseVal) {
      for (let i = 1; i <= FORCE_SEQ.length; i++) {
        const cand = FORCE_SEQ[(forceSeqIdx + i) % FORCE_SEQ.length];
        if (Math.abs(cand - baseVal) > 10) {
          forceSeqIdx = (forceSeqIdx + i) % FORCE_SEQ.length;
          return cand;
        }
      }
      return baseVal === 45.20 ? 89.60 : 45.20;
    }

    function updateJumpBtnLabel() {
      if (!elBtnJump) return;
      const nextTarget = realTimeVal === 45.20 ? 89.60 : 45.20;
      setText(elBtnJump, `模拟传感器力值跳变 (${realTimeVal.toFixed(2)}N ➔ ${nextTarget.toFixed(2)}N)`);
    }

    const pipelineStages = [stClip, stWin, stDma, stWait];

    function setActiveStage(idx) {
      if (idx === activeStage) return;
      activeStage = idx;
      pipelineStages.forEach((s, i) => s?.classList.toggle('is-active', i === idx));
    }

    function scheduleTick() {
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function requestRender() {
      renderDirty = true;
      scheduleTick();
    }

    // Manual step / jump: play the 4 pipeline stages once (rAF-driven)
    function pulsePipelineStages() {
      pulseStart = performance.now();
      setActiveStage(0);
      scheduleTick();
    }

    function tick(ts) {
      rafId = 0;
      if (isRunning) {
        if (!lastTs) lastTs = ts;
        stepAccum += Math.min(ts - lastTs, 250); // clamp after tab switches / long stalls
        lastTs = ts;
        let steps = 0;
        while (stepAccum >= stepInterval && steps < 8) {
          advanceStrip();
          stepAccum -= stepInterval;
          steps++;
        }
        if (stepAccum >= stepInterval) stepAccum = 0;
        if (steps > 0) renderDirty = true;
        setActiveStage(Math.min(3, Math.floor((stepAccum / stepInterval) * 4)));
      } else if (pulseStart >= 0) {
        const pulseMs = Math.max(12, Math.min(35, stepInterval / 4));
        const idx = Math.floor((ts - pulseStart) / pulseMs);
        if (idx >= 4) pulseStart = -1;
        setActiveStage(Math.max(0, Math.min(3, idx)));
      }

      if (renderDirty) {
        renderDirty = false;
        renderScreenFromState(); updateStats(); flushLogs();
      }

      if (isRunning || pulseStart >= 0) scheduleTick();
    }

    function startRun() {
      if (isRunning) return;
      isRunning = true;
      lastTs = 0;
      stepAccum = stepInterval; // advance the first strip immediately
      pulseStart = -1;
      if (elBtnRun) elBtnRun.textContent = '暂停刷屏';
      requestRender();
    }

    function stopRun() {
      if (!isRunning) return;
      isRunning = false;
      if (elBtnRun) elBtnRun.textContent = '连续刷屏';
      requestRender();
    }

    // Pre-build structured spans inside #strip-clip-info so updates only touch textContent
    let clipFnEl = null;
    let clipYEl = null;
    let clipHitEl = null;
    if (elClipInfo) {
      elClipInfo.innerHTML = '<code></code> 裁剪：全局 <code></code> ➔ 命中<span></span>，写入 <code>localY[0..7]</code>';
      const codes = elClipInfo.querySelectorAll('code');
      clipFnEl = codes[0];
      clipYEl = codes[1];
      clipHitEl = elClipInfo.querySelector('span');
    }

    function updateClipRegion(s) {
      if (!clipFnEl || !clipYEl || !clipHitEl) return;
      const y0 = s * 8;
      const y1 = y0 + 7;
      setText(clipYEl, `y=${y0}..${y1}`);
      if (s <= 2) {
        setText(clipFnEl, 'Canvas_FillRect');
        setText(clipHitEl, '【顶部状态栏 (0..24)】');
      } else if (s <= 6) {
        setText(clipFnEl, 'Canvas_FillRect');
        setText(clipHitEl, '【峰值/采样率栏 (28..52)】');
      } else if (s <= 10) {
        setText(clipFnEl, 'Canvas_FillRect');
        setText(clipHitEl, '【主读数卡片标题区 (56..87)】');
      } else if (s <= 14) {
        setText(clipFnEl, 'DrawGlyphBits');
        setText(clipHitEl, `【44px 大号力值数字 (${s <= 12 ? '上半截字模' : '下半截字模'} y=88..119)】`);
      } else if (s <= 18) {
        setText(clipFnEl, 'Canvas_FillRect');
        setText(clipHitEl, '【载荷进度条与通道信息 (120..152)】');
      } else if (s <= 35) {
        setText(clipFnEl, 'DrawWaveform');
        setText(clipHitEl, '【示波器实时力值曲线 (156..283)】');
      } else {
        setText(clipFnEl, 'Canvas_FillRect');
        setText(clipHitEl, '【底部功能键栏 F1/F2/F3 (286..314)】');
      }
    }

    // High-fidelity ST7789 UI rasterizer (240x320)
    // Note: wavePhase is passed explicitly so all strips of a locked snapshot share the exact same phase!
    function drawUiFrame(ctx, val, peak, batPct, wavePhase = 0) {
      ctx.save();
      // 1. IPS deep black background
      ctx.fillStyle = '#060b10';
      ctx.fillRect(0, 0, 240, 320);

      // 2. Top status bar (y = 0..23)
      ctx.fillStyle = '#0a141e';
      ctx.fillRect(0, 0, 240, 24);
      ctx.strokeStyle = '#182534';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 23.5);
      ctx.lineTo(240, 23.5);
      ctx.stroke();

      // Battery icon
      ctx.strokeStyle = '#64748b';
      ctx.strokeRect(8, 7, 18, 10);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(26, 10, 2, 4);
      ctx.fillStyle = batPct > 20 ? '#4cd137' : '#e84118';
      ctx.fillRect(10, 9, Math.round(14 * (batPct / 100)), 6);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(`${batPct}%`, 32, 15);

      // Instrument model
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 9.5px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N32G455 · ST7789', 120, 15);

      // Run status pill
      ctx.fillStyle = 'rgba(76, 209, 55, 0.2)';
      ctx.strokeStyle = '#4cd137';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(196, 6, 36, 12, 3);
      else ctx.rect(196, 6, 36, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4cd137';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillText('RUN', 214, 15);
      ctx.textAlign = 'left';

      // 3. Sub-header peak / rate card (y = 28..52)
      ctx.fillStyle = '#08121a';
      ctx.strokeStyle = '#152433';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 28, 224, 24, 4);
      else ctx.rect(8, 28, 224, 24);
      ctx.fill();
      ctx.stroke();

      ctx.font = '10px "JetBrains Mono", Consolas, monospace';
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(`PEAK: ${peak.toFixed(2)} N`, 14, 44);
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'right';
      ctx.fillText('RATE: 1.0 kHz', 226, 44);
      ctx.textAlign = 'left';

      // 4. Main tensile force readout card (y = 56..152)
      ctx.fillStyle = '#091522';
      ctx.strokeStyle = '#1d3246';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 56, 224, 96, 6);
      else ctx.rect(8, 56, 224, 96);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '8px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('REALTIME TENSILE FORCE', 14, 70);

      // Snapshot badge on LCD card
      ctx.textAlign = 'right';
      ctx.fillStyle = snapshotEnabled ? '#38bdf8' : '#fb923c';
      ctx.fillText(snapshotEnabled ? 'SNAP: LOCKED' : 'SNAP: OFF (DIRECT)', 224, 70);
      ctx.textAlign = 'left';

      // Large 44px digits: Alphabetic baseline at y = 118
      // Digits span y = 87..118; Strip 11..12 (y=88..103) is top half, Strip 13..14 (y=104..119) is bottom half
      // Exactly bisected at row 104!
      ctx.save();
      ctx.font = 'bold 44px ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#00f5d4';
      ctx.fillText(val.toFixed(2), 14, 118);

      // Unit 'N'
      ctx.fillStyle = '#00bbf9';
      ctx.font = 'bold 20px ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace';
      ctx.fillText('N', 178, 118);
      ctx.restore();

      // Horizontal Force Load Bar (y = 126..132, Strip 15..16)
      ctx.fillStyle = '#050c14';
      ctx.fillRect(14, 125, 210, 6);
      const loadPct = Math.max(0.05, Math.min(1, val / 100));
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(14, 125, Math.round(210 * loadPct), 6);

      // Sensor metadata (y = 143, Strip 17..18)
      ctx.fillStyle = '#475569';
      ctx.font = '8px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('CH1: S-TYPE LOADCELL · FILTER: FIR-32', 14, 144);

      // 5. Oscilloscope waveform box (y = 158..280, Strips 19..35)
      ctx.fillStyle = '#04080c';
      ctx.strokeStyle = '#182838';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 158, 224, 122, 6);
      else ctx.rect(8, 158, 224, 122);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '8px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('OSCILLOSCOPE (200 ms/div)', 14, 172);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`${val.toFixed(1)} N`, 224, 172);
      ctx.textAlign = 'left';

      // Oscilloscope grid ticks
      ctx.strokeStyle = '#0e1d2a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gy = 190; gy <= 265; gy += 25) {
        ctx.moveTo(12, gy);
        ctx.lineTo(228, gy);
      }
      for (let gx = 36; gx <= 210; gx += 32) {
        ctx.moveTo(gx, 178);
        ctx.lineTo(gx, 274);
      }
      ctx.stroke();

      // Tensile dynamic curve (using consistent wavePhase across all strips of a locked frame!)
      const waveBaseY = 262;
      const normForce = Math.max(0.1, Math.min(1, val / 100));
      const steadyOffset = normForce * 52;
      const rippleAmp = 8 + normForce * 10;

      ctx.beginPath();
      for (let x = 12; x <= 228; x += 2) {
        const t = (x - 12) / 216;
        const y = waveBaseY - steadyOffset - Math.sin(t * Math.PI * 4 + wavePhase) * rippleAmp;
        if (x === 12) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Subtle area fill under oscilloscope curve
      ctx.lineTo(228, 273);
      ctx.lineTo(12, 273);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.10)';
      ctx.fill();

      // 6. Bottom softkeys (y = 286..314, Strips 35..39)
      ctx.fillStyle = '#09131c';
      ctx.strokeStyle = '#182634';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 286, 224, 26, 4);
      else ctx.rect(8, 286, 224, 26);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '9.5px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('[F1 清零]', 45, 303);
      ctx.fillText('[F2 峰值]', 120, 303);
      ctx.fillText('[F3 存盘]', 195, 303);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // Compute the effective value & phase for strip s (0..39) under current snapshot mode
    function getEffectiveStripData(s) {
      if (s <= currentStrip) {
        if (snapshotEnabled) {
          return { val: snapshotVal, phase: frameWavePhase, isScanned: true };
        }
        return { val: stripRawValues[s], phase: stripRawPhases[s], isScanned: true };
      }
      // Strips below currentStrip still hold previous frame in ST7789 GRAM
      return { val: prevFrameVal, phase: prevFramePhase, isScanned: false };
    }

    // Detect any mid-frame tear seam among strips 0..currentStrip
    function detectCurrentFrameTear() {
      if (snapshotEnabled) return null;
      for (let s = 1; s <= currentStrip; s++) {
        if (Math.abs(stripRawValues[s] - stripRawValues[s - 1]) > 0.01) {
          return {
            seamStrip: s,
            seamRow: s * 8,
            upperVal: stripRawValues[s - 1],
            lowerVal: stripRawValues[s]
          };
        }
      }
      return null;
    }

    // Reconstruct the entire 240x320 ST7789 GRAM and 240x8 SRAM strip buffer from state
    // Rasterizing the full UI is expensive (text + paths), so each distinct frame
    // state is drawn once and cached; strips only blit 8-row slices from it.
    function getFrameCanvas(val, phase) {
      const key = `${val.toFixed(2)}|${phase.toFixed(4)}|${peakVal.toFixed(2)}|${snapshotEnabled ? 1 : 0}`;
      let canvas = frameCache.get(key);
      if (canvas) {
        frameCache.delete(key);
        frameCache.set(key, canvas); // refresh LRU order
        return canvas;
      }
      if (frameCache.size >= FRAME_CACHE_MAX) {
        canvas = frameCache.values().next().value;
        frameCache.delete(frameCache.keys().next().value);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 320;
      }
      drawUiFrame(canvas.getContext('2d'), val, peakVal, 88, phase);
      frameCache.set(key, canvas);
      return canvas;
    }

    function renderScreenFromState() {
      if (!screenCtx) return;

      let runStart = 0;
      let runCanvas = null;
      for (let s = 0; s <= 40; s++) {
        const canvas = s < 40 ? (() => {
          const { val, phase } = getEffectiveStripData(s);
          return getFrameCanvas(val, phase);
        })() : null;
        if (canvas !== runCanvas) {
          if (runCanvas) {
            const y = runStart * 8;
            const h = (s - runStart) * 8;
            screenCtx.drawImage(runCanvas, 0, y, 240, h, 0, y, 240, h);
          }
          runCanvas = canvas;
          runStart = s;
        }
        // Copy currentStrip's 8-line slice into the 3.84 KB SRAM buffer canvas
        if (s === currentStrip && sramCtx && canvas) {
          sramCtx.drawImage(canvas, 0, s * 8, 240, 8, 0, 0, 240, 8);
        }
      }
    }

    // Cache last written text & className in JS to avoid even DOM getter overhead
    const textMemo = new WeakMap();
    const classMemo = new WeakMap();
    function setText(el, text) {
      if (el && textMemo.get(el) !== text) {
        textMemo.set(el, text);
        el.textContent = text;
      }
    }
    function setClass(el, cls) {
      if (el && classMemo.get(el) !== cls) {
        classMemo.set(el, cls);
        el.className = cls;
      }
    }

    // Update UI controls, badges, 40-strip grid & diagnostics
    function updateStats() {
      const topY = currentStrip * 8;
      const tearInfo = detectCurrentFrameTear();
      const hasPending = snapshotEnabled && Math.abs(realTimeVal - snapshotVal) > 0.01;

      if (elScanLine) {
        const tf = `translateY(${topY}px)`;
        if (elScanLine.style.transform !== tf) elScanLine.style.transform = tf;
      }
      if (elScanTag) {
        setText(elScanTag, `STRIP ${currentStrip} · ROW ${topY}..${topY + 7}`);
        elScanTag.classList.toggle('flip-below', currentStrip <= 2);
      }

      if (elStatStrip) {
        const statusSuffix = frameComplete && currentStrip === 39
          ? '整帧 40 条带已完成'
          : `进度 ${(((currentStrip + 1) / 40) * 100).toFixed(1)}%`;
        setText(elStatStrip, `条带 ${currentStrip} / 39 (${statusSuffix})`);
      }
      setText(elStatY, `y = ${topY} .. ${topY + 7} px`);
      updateClipRegion(currentStrip);
      setText(elFrameCounter, `Frame #${frameNumber} · 已刷 ${currentStrip + 1}/40 条带 (点击色块或屏幕可定位)`);

      setText(elStatLive, `${realTimeVal.toFixed(2)} N`);
      if (elStatSnap) {
        if (snapshotEnabled) {
          setText(elStatSnap, `${snapshotVal.toFixed(2)} N (已锁定)`);
          setClass(elStatSnap, 'strip-reg-value accent');
        } else {
          setText(elStatSnap, `未锁定 (直读 ${realTimeVal.toFixed(2)} N)`);
          setClass(elStatSnap, 'strip-reg-value warn');
        }
      }

      if (elStatPending) {
        if (hasPending) {
          setText(elStatPending, `1 · PENDING (${realTimeVal.toFixed(2)}N)`);
          setClass(elStatPending, 'strip-reg-value pending');
        } else {
          setText(elStatPending, '0 · CLEAN (就绪)');
          setClass(elStatPending, 'strip-reg-value');
        }
      }

      if (tearInfo) {
        if (elStatTear) {
          setText(elStatTear, `⚠️ 画面割裂 (Row ${tearInfo.seamRow} 上下错位)`);
          setClass(elStatTear, 'aiw-stat-value warn');
        }
        if (elStatSeam) {
          setText(elStatSeam, `Row ${tearInfo.seamRow} (${tearInfo.upperVal.toFixed(1)}≠${tearInfo.lowerVal.toFixed(1)}N)`);
          setClass(elStatSeam, 'strip-reg-value warn');
        }
        if (elTearSeam) {
          if (elTearSeam.style.display !== 'block') elTearSeam.style.display = 'block';
          const seamTop = `${tearInfo.seamRow}px`;
          if (elTearSeam.style.top !== seamTop) elTearSeam.style.top = seamTop;
        }
        if (elTearBadge) {
          setText(elTearBadge, `⚡ 接缝 Row ${tearInfo.seamRow}: 上半 ${tearInfo.upperVal.toFixed(2)}N / 下半 ${tearInfo.lowerVal.toFixed(2)}N`);
          elTearBadge.classList.toggle('flip-below', tearInfo.seamRow < 24);
        }
      } else {
        if (elStatTear) {
          setText(elStatTear, snapshotEnabled && hasPending ? '原子一致 (快照保护中)' : '画面原子一致 (无割裂)');
          setClass(elStatTear, 'aiw-stat-value accent');
        }
        if (elStatSeam) {
          setText(elStatSeam, '无接缝断层');
          setClass(elStatSeam, 'strip-reg-value accent');
        }
        if (elTearSeam) {
          if (elTearSeam.style.display !== 'none') elTearSeam.style.display = 'none';
        }
      }

      // Update 40-strip progress cells
      progCells.forEach((cell, idx) => {
        let cls = 'strip-prog-cell';
        if (idx === currentStrip) {
          cls += ' is-current';
        } else if (tearInfo && idx === tearInfo.seamStrip) {
          cls += ' is-tear-seam';
        } else if (tearInfo && idx > tearInfo.seamStrip && idx <= currentStrip) {
          cls += ' is-torn-after';
        } else if (idx <= currentStrip) {
          cls += ' is-scanned';
        }
        setClass(cell, cls);
      });

      if (elDmaBadge) {
        if (isRunning) {
          setText(elDmaBadge, `DMA1_CH2 传输中 (Strip ${currentStrip})`);
          setClass(elDmaBadge, 'strip-dma-badge active');
        } else if (frameComplete && currentStrip === 39) {
          setText(elDmaBadge, 'DMA1_CH2 完成整帧');
          setClass(elDmaBadge, 'strip-dma-badge');
        } else {
          setText(elDmaBadge, `DMA1_CH2 就绪 (Strip ${currentStrip})`);
          setClass(elDmaBadge, 'strip-dma-badge');
        }
      }

      if (elVal) {
        setText(elVal, (snapshotEnabled ? snapshotVal : realTimeVal).toFixed(2));
      }
      updateJumpBtnLabel();
    }

    // Begin a new frame at Strip 0
    function startNewFrame() {
      // Save what was at the bottom of GRAM as prevFrameVal
      const lastRendered = getEffectiveStripData(currentStrip);
      prevFrameVal = lastRendered.val;
      prevFramePhase = lastRendered.phase;

      currentStrip = 0;
      frameComplete = false;
      midFrameJumpHappened = false;

      const hadPending = Math.abs(realTimeVal - snapshotVal) > 0.01;
      snapshotVal = realTimeVal;
      liveWavePhase = (liveWavePhase + 0.45) % (Math.PI * 2);
      frameWavePhase = liveWavePhase;

      stripRawValues.fill(realTimeVal);
      stripRawPhases.fill(liveWavePhase);

      log(
        `[FRAME #${frameNumber} START] Strip 0 启动：${
          snapshotEnabled
            ? `锁定不可变帧快照 AppUiRenderer = ${snapshotVal.toFixed(2)} N${hadPending ? ' (消费 pending 脏标记完成原子换帧)' : ''}`
            : `未开启快照，直读实时变量 (${realTimeVal.toFixed(2)} N)`
        }`,
        'success',
        0
      );
    }

    // Advance a single 8-line strip (state only; rendering is batched per display frame)
    function advanceStrip() {
      if (frameComplete) {
        frameNumber++;
        startNewFrame();
      } else if (currentStrip < 39) {
        currentStrip++;
      } else {
        frameNumber++;
        startNewFrame();
      }

      // When Snapshot is OFF and user is stepping/running through Strip 13 (Row 104, exact waist of 44px digits),
      // automatically simulate a mid-frame sensor update if one hasn't occurred yet in this frame
      if (!snapshotEnabled && !midFrameJumpHappened && currentStrip === 13) {
        const oldVal = realTimeVal;
        realTimeVal = nextForceValue(oldVal);
        liveWavePhase = (liveWavePhase + 1.1) % (Math.PI * 2);
        if (realTimeVal > peakVal) peakVal = realTimeVal;
        midFrameJumpHappened = true;
        log(
          `[TEARING @ ROW 104] 扫描至 Strip 13 (大号数字腰部 y=104) 时传感器采样跳变：${oldVal.toFixed(2)} N ➔ ${realTimeVal.toFixed(2)} N！因无帧快照保护，数字上下半截发生割裂错位！`,
          'error',
          13
        );
      }

      stripRawValues[currentStrip] = realTimeVal;
      stripRawPhases[currentStrip] = liveWavePhase;

      if (currentStrip === 39) {
        frameComplete = true;
      }
    }

    // Manual single step
    function stepStrip() {
      advanceStrip();
      pulsePipelineStages();
      requestRender();
    }

    // Jump to inspect any specific strip (0..39) on click
    function jumpToStrip(targetStrip) {
      const clamped = Math.max(0, Math.min(39, targetStrip));
      if (frameComplete) {
        frameComplete = false;
      }
      for (let s = 0; s <= clamped; s++) {
        if (s > currentStrip) {
          stripRawValues[s] = realTimeVal;
          stripRawPhases[s] = liveWavePhase;
        }
      }
      currentStrip = clamped;
      if (currentStrip === 39) frameComplete = true;
      pulsePipelineStages();
      requestRender();
    }

    // Execute a controlled mid-frame jump at Row 104 (Strip 13, bisecting the 44px digits)
    function runRow104MidFrameScenario(enableSnapshot) {
      stopRun();

      snapshotEnabled = enableSnapshot;
      if (chkSnapshot) chkSnapshot.checked = enableSnapshot;

      const baseVal = 45.20;
      const jumpedVal = 89.60;
      forceSeqIdx = 1;

      prevFrameVal = baseVal;
      prevFramePhase = 0;
      snapshotVal = baseVal;
      realTimeVal = jumpedVal;
      if (jumpedVal > peakVal) peakVal = jumpedVal;

      frameWavePhase = 0.35;
      liveWavePhase = 1.65;
      midFrameJumpHappened = true;
      frameComplete = false;

      // Strips 0..12 (y = 0..103, upper half of 44px digits) were scanned before the sensor jump
      for (let s = 0; s <= 12; s++) {
        stripRawValues[s] = baseVal;
        stripRawPhases[s] = frameWavePhase;
      }
      // At Strip 13 (y = 104, waist of 44px digits), sensor jumped to 89.60 N; scan advanced to Strip 20
      for (let s = 13; s < 40; s++) {
        stripRawValues[s] = jumpedVal;
        stripRawPhases[s] = liveWavePhase;
      }
      currentStrip = 20; // y = 160, past the digits card so the entire digit area is drawn!

      pulsePipelineStages();
      requestRender();

      if (enableSnapshot) {
        log(
          `[SCENARIO: SNAPSHOT ON] Strip 0 锁定快照 45.20 N ➔ 刷至 Strip 13 (Row 104) 传感器突变为 89.60 N ➔ 快照机制生效：当前帧继续保持 45.20 N (数字完好无损不割裂)，仅标记 pending = 1 待下一帧原子生效！`,
          'success',
          13
        );
      } else {
        log(
          `[SCENARIO: SNAPSHOT OFF] 未开启帧快照 ➔ Strip 0..12 绘制上半截 45.20 N ➔ Strip 13 (Row 104) 传感器突变为 89.60 N ➔ Strip 13..20 直接绘制下半截 89.60 N，大号数字在 Row 104 处呈现清晰的上下割裂断层！`,
          'error',
          13
        );
      }
    }

    // Trigger manual sensor force jump
    function triggerJump() {
      const oldVal = realTimeVal;
      const newVal = nextForceValue(oldVal);

      // If currently idle or paused:
      // Position the jump right at Strip 13 (Row 104, waist of 44px digits) and advance to Strip 20 (y=160)
      // so the user immediately and clearly observes the effect!
      if (!isRunning && (frameComplete || currentStrip < 11 || currentStrip > 30)) {
        prevFrameVal = oldVal;
        prevFramePhase = frameWavePhase;
        snapshotVal = oldVal;
        realTimeVal = newVal;
        if (newVal > peakVal) peakVal = newVal;

        liveWavePhase = (frameWavePhase + 1.2) % (Math.PI * 2);
        midFrameJumpHappened = true;
        frameComplete = false;

        for (let s = 0; s <= 12; s++) {
          stripRawValues[s] = oldVal;
          stripRawPhases[s] = frameWavePhase;
        }
        for (let s = 13; s < 40; s++) {
          stripRawValues[s] = newVal;
          stripRawPhases[s] = liveWavePhase;
        }
        currentStrip = 20; // y = 160, past the big digits card

        pulsePipelineStages();
        requestRender();

        if (snapshotEnabled) {
          log(`[SNAPSHOT HOLD] 刷屏中途 (Strip 13 · Row 104) 传感器跳变：${oldVal.toFixed(2)} N ➔ ${newVal.toFixed(2)} N。帧快照锁定中 (${snapshotVal.toFixed(2)} N)：大号数字原子一致毫无割裂，新数据标记 pending = 1。待下一帧原子换帧。`, 'success', 13);
        } else {
          log(`[TEARING OBSERVED] 刷屏中途 (Strip 13 · Row 104) 传感器跳变：${oldVal.toFixed(2)} N ➔ ${newVal.toFixed(2)} N。无帧快照保护：上半截为 ${oldVal.toFixed(2)} N，下半截突变为 ${newVal.toFixed(2)} N，大号数字发生明显的上下割裂断层！`, 'error', 13);
        }
        return;
      }

      // Otherwise (when running or already mid-frame in Strip 11..30):
      realTimeVal = newVal;
      liveWavePhase = (liveWavePhase + 1.2) % (Math.PI * 2);
      if (realTimeVal > peakVal) peakVal = realTimeVal;
      midFrameJumpHappened = true;

      log(`[SENSOR EVENT] 传感器新采样到达：${oldVal.toFixed(2)} N ➔ ${realTimeVal.toFixed(2)} N (当前处在 Strip ${currentStrip})`, 'event');

      if (!isRunning) {
        const stepsToAdvance = Math.min(3, 39 - currentStrip);
        for (let i = 0; i < stepsToAdvance; i++) {
          currentStrip++;
          stripRawValues[currentStrip] = realTimeVal;
          stripRawPhases[currentStrip] = liveWavePhase;
        }
        if (currentStrip === 39) frameComplete = true;
        pulsePipelineStages();
      }

      if (snapshotEnabled) {
        log(`[SNAPSHOT HOLD] 帧快照已锁定 (${snapshotVal.toFixed(2)} N)：当前帧不受影响，pending 置 1。待 Strip 39 完成后换帧。`, 'normal');
      } else {
        log(`[UNLOCKED DIRECT READ] 无帧快照：Strip ${currentStrip} 起直接以新值 ${realTimeVal.toFixed(2)} N 光栅化，出现割裂！`, 'warn');
      }

      requestRender();
    }

    // Toggle snapshot checkbox: immediately re-render current frame to compare!
    chkSnapshot?.addEventListener('change', (e) => {
      snapshotEnabled = e.target.checked;
      requestRender();
      log(
        `[SNAPSHOT CONFIG] 帧快照机制已${
          snapshotEnabled
            ? `开启：当前帧恢复使用锁定量 ${snapshotVal.toFixed(2)} N，画面割裂立即消除`
            : '关闭：当前帧直接暴露中途跳变数据，力值呈现上下割裂断层'
        }`,
        snapshotEnabled ? 'success' : 'warn'
      );
    });

    // Preset buttons
    elPresetSafe?.addEventListener('click', () => runRow104MidFrameScenario(true));
    elPresetTear?.addEventListener('click', () => runRow104MidFrameScenario(false));
    elPresetInspect?.addEventListener('click', () => {
      stopRun();
      frameComplete = false;
      jumpToStrip(12); // Strip 12: y = 96..103 (waist of 44px digits)
      log('[INSPECT] 已定位至 Strip 12 (y = 96..103)：可在左侧下方 3.84 KB SRAM 缓冲视图中检视被裁剪出的 8 行数字字模切片。', 'normal', 12);
    });

    // Click on ST7789 screen viewport to inspect any strip directly
    screenViewport?.addEventListener('click', (e) => {
      const rect = screenViewport.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratioY = Math.max(0, Math.min(319, (clickY / rect.height) * 320));
      const targetStrip = Math.floor(ratioY / 8);
      stopRun();
      jumpToStrip(targetStrip);
      log(`[INSPECT] 屏幕点击定位至 Strip ${targetStrip} (y = ${targetStrip * 8}..${targetStrip * 8 + 7})`, 'normal', targetStrip);
    });

    // Auto data stream
    chkAutoJump?.addEventListener('change', (e) => {
      autoJumpEnabled = e.target.checked;
      if (autoJumpEnabled) {
        log('[AUTO STREAM] 已启动高频采样流：每 320ms 注入一次动态力值变化', 'event');
        if (!isRunning) {
          startRun();
          log('[RUN] 启动 40 条带循环 SPI1 DMA 异步刷屏', 'normal');
        }
        autoJumpTimer = setInterval(() => {
          realTimeVal = Math.round((35 + Math.random() * 60) * 100) / 100;
          liveWavePhase = (liveWavePhase + 0.9) % (Math.PI * 2);
          if (realTimeVal > peakVal) peakVal = realTimeVal;
          midFrameJumpHappened = true;
          requestRender();
        }, 320);
      } else {
        if (autoJumpTimer) {
          clearInterval(autoJumpTimer);
          autoJumpTimer = null;
        }
        log('[AUTO STREAM] 高频采样流已停止', 'normal');
      }
    });

    // Speed selector
    speedSelect?.addEventListener('change', (e) => {
      stepInterval = parseInt(e.target.value, 10) || 45;
      log(`[SPEED] 条带推进间隔已设为 ${stepInterval} ms / 条带`, 'normal');
    });

    // Run / Pause
    if (elBtnRun) {
      elBtnRun.addEventListener('click', () => {
        if (!isRunning) {
          startRun();
          log('[RUN] 启动 40 条带循环 SPI1 DMA 异步刷屏', 'normal');
        } else {
          stopRun();
          log('[PAUSE] 连续刷屏已暂停', 'normal');
        }
      });
    }

    // Step button
    elBtnStep?.addEventListener('click', () => {
      stopRun();
      stepStrip();
    });

    // Force jump
    elBtnJump?.addEventListener('click', triggerJump);

    // Reset button
    elBtnReset?.addEventListener('click', () => {
      stopRun();
      if (autoJumpTimer) {
        clearInterval(autoJumpTimer);
        autoJumpTimer = null;
      }
      pulseStart = -1;
      frameCache.clear();
      autoJumpEnabled = false;
      snapshotEnabled = true;
      if (chkSnapshot) chkSnapshot.checked = true;
      if (chkAutoJump) chkAutoJump.checked = false;

      forceSeqIdx = 0;
      currentStrip = 0;
      frameComplete = false;
      frameNumber = 1;
      realTimeVal = FORCE_SEQ[0];
      snapshotVal = FORCE_SEQ[0];
      prevFrameVal = FORCE_SEQ[0];
      peakVal = 92.40;
      frameWavePhase = 0;
      liveWavePhase = 0;
      prevFramePhase = 0;
      midFrameJumpHappened = false;

      stripRawValues.fill(realTimeVal);
      stripRawPhases.fill(0);

      requestRender();

      if (elLog) elLog.innerHTML = '';
      log('[RESET] 条带渲染引擎已复位：Frame #1 就绪，片内 3.84 KB 条带缓冲指向 Strip 0 (y=0..7)', 'normal', 0);
    });

    // Pause when scrolled offscreen or tab is hidden to save CPU/battery
    if ('IntersectionObserver' in window) {
      const visObserver = new IntersectionObserver((entries) => {
        const visible = Boolean(entries[0]?.isIntersecting);
        if (!visible && isRunning) {
          stopRun();
        }
      }, { threshold: 0.02 });
      visObserver.observe(root);
    }

    // Initial draw (Strip 0 ready, frame beginning)
    currentStrip = 0;
    frameComplete = false;
    stripRawValues.fill(realTimeVal);
    stripRawPhases.fill(0);
    log('[INIT] 240×8 条带渲染引擎初始化完成：40 条带覆盖 320 行，可点击【一键实验场景】或【模拟传感器力值跳变】观察防撕裂机制', 'normal', 0);
    renderDirty = false;
    renderScreenFromState();
    updateStats();
    flushLogs();
  }

  try {
    initLcdStripSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initLcdStripSimulator', err);
  }
})();
