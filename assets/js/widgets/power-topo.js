(() => {
  function initPowerTopoLab() {
    const root = document.getElementById('power-topo-demo-app');
    if (!root) return;

    const reducedMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    const isReducedMotion = () => Boolean(reducedMotionQuery && reducedMotionQuery.matches);

    const state = {
      topo: 'buck',        // 'ldo' | 'buck' | 'boost' | 'buckboost' | 'combo'
      phase: 1,            // 1 (Ton / 舀水) | 2 (Toff / 倒水)
      autoPlay: false,
      sweepActive: false,
      vin: 12.0,
      vout: 3.3,
      iload: 1.0,
      indUh: 10.0,
      fswKhz: 500,
      grade: 'sync90',
      faultSat: false,     // Small inductor I_sat = 1.5 A
      faultCap: false,     // Missing 100nF / long trace
      faultEnOff: false,   // EN pulled low (shutdown test)
      cursorNormX: null,   // 0..1 when hovering/touching canvas
    };

    const grades = {
      sync90: { eta: 0.90, vDrop: 0.25, label: '同步开关 ~90%', ldoLabel: 'CMOS LDO (0.25V 压差)', trueShutdown: false },
      async82: { eta: 0.82, vDrop: 1.10, label: '异步肖特基 ~82%', ldoLabel: '常规 1117 LDO (1.1V 压差)', trueShutdown: false },
      high94: { eta: 0.94, vDrop: 0.12, label: '高效同步 ~94%', ldoLabel: '超低压差 LDO (0.12V 压差)', trueShutdown: true },
    };

    const FAULT_ISAT_LIMIT = 1.5;

    // Cache DOM references once (zero per-frame querying)
    const dom = {
      vin: root.querySelector('#pwr-input-vin'),
      vout: root.querySelector('#pwr-input-vout'),
      iload: root.querySelector('#pwr-input-iload'),
      ind: root.querySelector('#pwr-input-ind'),
      fsw: root.querySelector('#pwr-input-fsw'),
      grade: root.querySelector('#pwr-input-grade'),
      fieldInd: root.querySelector('#pwr-field-ind'),
      fieldFsw: root.querySelector('#pwr-field-fsw'),
      valVin: root.querySelector('#pwr-val-vin'),
      valVout: root.querySelector('#pwr-val-vout'),
      valIload: root.querySelector('#pwr-val-iload'),
      valInd: root.querySelector('#pwr-val-ind'),
      valFsw: root.querySelector('#pwr-val-fsw'),
      statMode: root.querySelector('#pwr-stat-mode'),
      statIin: root.querySelector('#pwr-stat-iin'),
      statLoss: root.querySelector('#pwr-stat-loss'),
      statPeak: root.querySelector('#pwr-stat-peak'),
      energyTitle: root.querySelector('#pwr-energy-title'),
      thermalPill: root.querySelector('#pwr-thermal-pill'),
      barOut: root.querySelector('#pwr-bar-out'),
      barLoss: root.querySelector('#pwr-bar-loss'),
      compareHint: root.querySelector('#pwr-compare-hint'),
      isatHint: root.querySelector('#pwr-isat-hint'),
      topoHeading: root.querySelector('#pwr-topo-heading'),
      topoHint: root.querySelector('#pwr-topo-hint'),
      topoSvg: root.querySelector('#pwr-topo-svg'),
      scopeHeading: root.querySelector('#pwr-scope-heading'),
      scopeHint: root.querySelector('#pwr-scope-hint'),
      roCh1: root.querySelector('#pwr-ro-ch1'),
      roCh2: root.querySelector('#pwr-ro-ch2'),
      roCh3: root.querySelector('#pwr-ro-ch3'),
      roTime: root.querySelector('#pwr-ro-time'),
      canvas: root.querySelector('#pwr-scope-canvas'),
      diagBox: root.querySelector('#pwr-diag-box'),
      autoBtn: root.querySelector('#pwr-btn-auto'),
      sweepBtn: root.querySelector('#pwr-btn-sweep'),
      faultSatBtn: root.querySelector('#pwr-fault-sat'),
      faultCapBtn: root.querySelector('#pwr-fault-cap'),
      faultEnBtn: root.querySelector('#pwr-fault-en'),
      p1Btn: root.querySelector('.pwr-phase-btn[data-phase="1"]'),
      p2Btn: root.querySelector('.pwr-phase-btn[data-phase="2"]'),
      topoBtns: Array.from(root.querySelectorAll('.pwr-topo-btn')),
      phaseBtns: Array.from(root.querySelectorAll('.pwr-phase-btn[data-phase]')),
      presetBtns: Array.from(root.querySelectorAll('.pwr-preset-btn')),
    };

    const ctx = dom.canvas ? dom.canvas.getContext('2d', { alpha: true }) : null;

    // Theme palette cache (updated only on init & data-theme attribute mutation)
    const palette = {
      paper: '#e3e6f0',
      panel: '#ffffff',
      altBg: 'rgba(60, 60, 67, 0.06)',
      ink: '#1d1d1f',
      muted: '#636368',
      line: 'rgba(60, 60, 67, 0.16)',
      accent: '#007aff',
      accentDark: '#0055b3',
      warm: '#ff9500',
      ok: '#10b981',
      danger: '#ef4444',
    };

    function refreshPalette() {
      const cs = getComputedStyle(document.documentElement);
      const read = (name, fallback) => {
        const v = cs.getPropertyValue(name).trim();
        return v || fallback;
      };
      palette.paper = read('--paper', '#e3e6f0');
      palette.panel = read('--panel', '#ffffff');
      palette.altBg = read('--alt-bg', 'rgba(60,60,67,0.06)');
      palette.ink = read('--ink', '#1d1d1f');
      palette.muted = read('--muted', '#636368');
      palette.line = read('--line', 'rgba(60,60,67,0.16)');
      palette.accent = read('--accent', '#007aff');
      palette.accentDark = read('--accent-dark', '#0055b3');
      palette.warm = read('--warm', '#ff9500');
    }

    // Performance & lifecycle state
    let isVisible = true;
    let rafId = null;
    let dirtyFull = true;
    let dirtyScope = true;
    let lastFrameTs = 0;
    let phaseClock = 0;      // 0..1 continuous cycle phase for autoPlay
    let sweepDir = -1;       // 4.2 -> 2.8 descending
    let lastTopoKey = '';
    let cachedModel = null;
    let canvasDpr = 1;
    let canvasCssW = 680;
    const CANVAS_CSS_H = 252;

    function clamp(val, min, max) {
      return Math.min(max, Math.max(min, val));
    }

    function syncCanvasResolution() {
      if (!dom.canvas || !ctx) return;
      const rect = dom.canvas.getBoundingClientRect();
      const targetW = Math.max(300, Math.round(rect.width || 680));
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x to keep GPU memory tiny
      if (targetW === canvasCssW && dpr === canvasDpr && dom.canvas.width === Math.round(targetW * dpr)) {
        return;
      }
      canvasCssW = targetW;
      canvasDpr = dpr;
      dom.canvas.width = Math.round(canvasCssW * dpr);
      dom.canvas.height = Math.round(CANVAS_CSS_H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function computeModel(s) {
      const g = grades[s.grade] || grades.sync90;
      const L = s.indUh * 1e-6;
      const f = s.fswKhz * 1e3;
      const T = 1 / f;
      const cOutF = s.faultCap ? 4.7e-6 : 22e-6;
      const cEsr = s.faultCap ? 0.08 : 0.012;

      let valid = true;
      let faultType = '';
      let subMode = s.topo;
      let duty = 0.5;
      let eta = g.eta;
      let iInAvg = s.iload;
      let pOut = s.vout * s.iload;
      let pLoss = 0;
      let pLossBuck = 0;
      let pLossLdo = 0;
      let vMid = 0;
      let iLAvg = s.iload;
      let deltaIL = 0;
      let iLPeak = s.iload;
      let iLValley = s.iload;
      let vSwHigh = s.vin;
      let dcmRisk = false;
      let vOutActual = s.vout;
      let rippleMv = 2.0;
      let isSaturated = false;
      let boostLeakThrough = false;

      // EN shutdown fault injection
      if (s.faultEnOff) {
        if (s.topo === 'boost' && !g.trueShutdown) {
          valid = false;
          faultType = 'boost-en-leak';
          boostLeakThrough = true;
          vOutActual = Math.max(0, s.vin - 0.35);
          const iLeak = Math.min(s.iload, Math.max(0.08, s.iload * 0.65));
          iInAvg = iLeak;
          iLAvg = iLeak;
          iLPeak = iLeak;
          iLValley = iLeak;
          pOut = vOutActual * iLeak;
          pLoss = 0.35 * iLeak;
          eta = s.vin > 0 ? clamp(vOutActual / s.vin, 0, 0.96) : 0;
          duty = 0;
          rippleMv = 1.5;
          vSwHigh = s.vin;
        } else {
          valid = true;
          faultType = 'en-shutdown-ok';
          vOutActual = 0;
          iInAvg = 0;
          iLAvg = 0;
          iLPeak = 0;
          iLValley = 0;
          pOut = 0;
          pLoss = 0;
          eta = 0;
          duty = 0;
          rippleMv = 0;
          vSwHigh = 0;
        }
      } else if (s.topo === 'ldo') {
        subMode = 'ldo';
        const iq = 0.002;
        if (s.vin < s.vout + g.vDrop - 1e-6) {
          valid = false;
          faultType = 'ldo-dropout';
          vOutActual = Math.max(0, s.vin - g.vDrop);
          pOut = vOutActual * s.iload;
          iInAvg = s.iload + iq;
          pLoss = Math.max(0, s.vin - vOutActual) * s.iload + s.vin * iq;
          eta = s.vin > 0 ? clamp(pOut / (s.vin * iInAvg), 0, 0.99) : 0;
        } else {
          iInAvg = s.iload + iq;
          pLoss = (s.vin - s.vout) * s.iload + s.vin * iq;
          eta = clamp(pOut / (s.vin * iInAvg), 0, 0.99);
        }
        duty = 1;
        iLAvg = 0;
        deltaIL = 0;
        iLPeak = s.iload;
        iLValley = s.iload;
        rippleMv = s.faultCap ? clamp(65 + s.iload * 85, 70, 320) : clamp(1.2 + s.iload * 2.5, 1.5, 12);
      } else if (s.topo === 'combo') {
        // Buck + LDO golden combo: Buck drops Vin to Vmid = Vout + max(0.5, vDrop + 0.35), LDO cleans to Vout
        subMode = 'combo';
        const headroom = Math.max(0.5, g.vDrop + 0.3);
        vMid = s.vout + headroom;
        if (s.vin <= vMid + 0.15) {
          valid = false;
          faultType = 'combo-under';
          vMid = Math.max(s.vout, s.vin * 0.96);
          vOutActual = Math.max(0, vMid - g.vDrop);
          pOut = vOutActual * s.iload;
          iInAvg = s.iload;
          pLoss = Math.max(0.05, s.vin * iInAvg - pOut);
          eta = s.vin > 0 ? clamp(pOut / (s.vin * iInAvg), 0, 0.95) : 0;
          duty = 0.95;
          iLAvg = s.iload;
          deltaIL = 0.1 * s.iload;
          iLPeak = iLAvg + deltaIL / 2;
          iLValley = Math.max(0, iLAvg - deltaIL / 2);
          rippleMv = s.faultCap ? 45 : 2.0;
        } else {
          duty = clamp(vMid / s.vin, 0.05, 0.94);
          const pMid = vMid * s.iload;
          const pIn = pMid / g.eta;
          pLossBuck = pIn - pMid;
          pLossLdo = (vMid - s.vout) * s.iload;
          pLoss = pLossBuck + pLossLdo;
          iInAvg = pIn / s.vin;
          eta = clamp(pOut / pIn, 0, 0.95);
          iLAvg = s.iload;
          deltaIL = ((s.vin - vMid) * duty * T) / L;
          if (deltaIL / 2 > iLAvg) {
            dcmRisk = true;
            iLValley = 0;
            iLPeak = Math.sqrt(2 * s.iload * deltaIL);
          } else {
            iLValley = iLAvg - deltaIL / 2;
            iLPeak = iLAvg + deltaIL / 2;
          }
          const buckRippleMv = deltaIL * (cEsr + 1 / (8 * f * cOutF)) * 1000;
          // High-PSRR LDO attenuates Buck switching ripple (~35 dB -> ~1/50)
          rippleMv = s.faultCap ? clamp(buckRippleMv * 0.35 + 32, 20, 140) : clamp(buckRippleMv * 0.04, 0.4, 3.5);
          vSwHigh = s.vin;
        }
      } else if (s.topo === 'buck') {
        subMode = 'buck';
        if (s.vin <= s.vout + 0.05) {
          valid = false;
          faultType = 'buck-under';
          duty = 0.98;
          vOutActual = Math.max(0, s.vin * 0.95);
          pOut = vOutActual * s.iload;
          iInAvg = s.iload;
          pLoss = Math.max(0.05, s.vin * iInAvg - pOut);
          eta = s.vin > 0 ? clamp(pOut / (s.vin * iInAvg), 0, 0.98) : 0;
          iLAvg = s.iload;
          deltaIL = 0.08 * s.iload;
          iLPeak = iLAvg + deltaIL / 2;
          iLValley = Math.max(0, iLAvg - deltaIL / 2);
          vSwHigh = s.vin;
          rippleMv = 35;
        } else {
          duty = clamp(s.vout / s.vin, 0.04, 0.96);
          eta = g.eta;
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = s.iload;
          deltaIL = ((s.vin - s.vout) * duty * T) / L;
          if (deltaIL / 2 > iLAvg) {
            dcmRisk = true;
            iLValley = 0;
            iLPeak = Math.sqrt(2 * s.iload * deltaIL);
          } else {
            iLValley = iLAvg - deltaIL / 2;
            iLPeak = iLAvg + deltaIL / 2;
          }
          vSwHigh = s.vin;
          rippleMv = deltaIL * (cEsr + 1 / (8 * f * cOutF)) * 1000;
        }
      } else if (s.topo === 'boost') {
        subMode = 'boost';
        if (s.vin >= s.vout - 0.05) {
          valid = false;
          faultType = 'boost-over';
          duty = 0.02;
          vOutActual = Math.max(0, s.vin - 0.35);
          pOut = vOutActual * s.iload;
          iInAvg = s.iload;
          iLAvg = s.iload;
          pLoss = 0.35 * s.iload;
          eta = clamp(vOutActual / s.vin, 0, 0.98);
          deltaIL = 0.05 * s.iload;
          iLPeak = iLAvg + deltaIL / 2;
          iLValley = Math.max(0, iLAvg - deltaIL / 2);
          vSwHigh = s.vin;
          rippleMv = 20;
        } else {
          duty = clamp(1 - s.vin / s.vout, 0.05, 0.88);
          eta = clamp(g.eta - (duty > 0.72 ? 0.04 : 0), 0.72, 0.95);
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = iInAvg;
          deltaIL = (s.vin * duty * T) / L;
          if (deltaIL / 2 > iLAvg) {
            dcmRisk = true;
            iLValley = 0;
            iLPeak = Math.max(iLAvg * 1.4, deltaIL);
          } else {
            iLValley = iLAvg - deltaIL / 2;
            iLPeak = iLAvg + deltaIL / 2;
          }
          vSwHigh = s.vout;
          rippleMv = ((s.iload * duty * T) / cOutF + iLPeak * cEsr) * 1000;
        }
      } else {
        // Four-switch Buck-Boost (±7% crossing band)
        const ratio = s.vin / s.vout;
        if (ratio > 1.07) {
          subMode = 'buck';
          duty = clamp(s.vout / s.vin, 0.05, 0.92);
          eta = clamp(g.eta - 0.01, 0.78, 0.94);
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = s.iload;
          deltaIL = ((s.vin - s.vout) * duty * T) / L;
          vSwHigh = s.vin;
          rippleMv = deltaIL * (cEsr + 1 / (8 * f * cOutF)) * 1000;
        } else if (ratio < 0.93) {
          subMode = 'boost';
          duty = clamp(1 - s.vin / s.vout, 0.08, 0.85);
          eta = clamp(g.eta - 0.02, 0.76, 0.93);
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = iInAvg;
          deltaIL = (s.vin * duty * T) / L;
          vSwHigh = s.vout;
          rippleMv = ((s.iload * duty * T) / cOutF + (iLAvg + deltaIL / 2) * cEsr) * 1000;
        } else {
          subMode = 'bb-bucket';
          duty = clamp(s.vout / (s.vin + s.vout), 0.35, 0.65);
          eta = clamp(g.eta - 0.03, 0.75, 0.91);
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = s.iload / Math.max(0.2, 1 - duty);
          deltaIL = (s.vin * duty * T) / L;
          vSwHigh = Math.max(s.vin, s.vout);
          rippleMv = ((s.iload * duty * T) / cOutF + (iLAvg + deltaIL / 2) * cEsr) * 1000;
        }

        if (deltaIL / 2 > iLAvg) {
          dcmRisk = true;
          iLValley = 0;
          iLPeak = Math.max(iLAvg * 1.35, deltaIL);
        } else {
          iLValley = iLAvg - deltaIL / 2;
          iLPeak = iLAvg + deltaIL / 2;
        }
      }

      // Inductor core saturation fault simulation (when enabled on switching topologies)
      if (!s.faultEnOff && s.topo !== 'ldo' && s.faultSat && iLPeak > FAULT_ISAT_LIMIT) {
        isSaturated = true;
        const overshoot = iLPeak - FAULT_ISAT_LIMIT;
        iLPeak = FAULT_ISAT_LIMIT + overshoot * 2.4 + 0.55;
        pLoss += overshoot * 1.6 + 0.45;
        rippleMv *= 2.3;
      }

      const pInTotal = pOut + pLoss;
      const iSatRec = iLPeak * 1.3;
      const rThetaJa = s.topo === 'ldo' ? 60 : 45; // °C/W order-of-magnitude illustration (SOT-223 / QFN)
      const tjEst = Math.min(185, 25 + pLoss * rThetaJa);
      const thermalRisk = isSaturated || tjEst >= 125 || pLoss >= 1.5 ? 'danger' : tjEst >= 85 || pLoss >= 0.75 ? 'warn' : 'ok';
      const ldoRefLoss = s.vin > s.vout ? (s.vin - s.vout) * s.iload : 0;

      return {
        valid,
        faultType,
        subMode,
        duty,
        eta,
        pOut,
        pLoss,
        pLossBuck,
        pLossLdo,
        pInTotal,
        vMid,
        iInAvg,
        iLAvg,
        deltaIL,
        iLPeak,
        iLValley,
        iSatRec,
        vSwHigh,
        dcmRisk,
        vOutActual,
        rippleMv,
        isSaturated,
        boostLeakThrough,
        tjEst,
        thermalRisk,
        ldoRefLoss,
        periodUs: T * 1e6,
        gradeObj: g,
      };
    }

    function drawSwitchBox(x, y, name, isOn, subtitle) {
      const stroke = isOn ? '#10b981' : 'var(--line)';
      const overlayFill = isOn ? 'rgba(16, 185, 129, 0.14)' : 'var(--subtle-bg)';
      const textCol = isOn ? '#10b981' : 'var(--muted)';
      const stateTxt = isOn ? '导通 ON' : '关断 OFF';
      return `
        <g>
          <rect x="${x - 36}" y="${y - 21}" width="72" height="42" rx="8" fill="var(--paper)"/>
          <rect x="${x - 36}" y="${y - 21}" width="72" height="42" rx="8" fill="${overlayFill}" stroke="${stroke}" stroke-width="${isOn ? 2.2 : 1.3}" ${isOn ? '' : 'stroke-dasharray="4 3"'}/>
          <text x="${x}" y="${y - 4}" text-anchor="middle" font-size="11" font-weight="750" fill="var(--ink)">${name}</text>
          <text x="${x}" y="${y + 11}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${textCol}">${subtitle || stateTxt}</text>
        </g>
      `;
    }

    function drawInductor(cx, cy, polarity, labelText, saturated) {
      const x0 = cx - 42;
      const d = `M ${x0} ${cy} Q ${x0 + 10.5} ${cy - 17} ${x0 + 21} ${cy} Q ${x0 + 31.5} ${cy - 17} ${x0 + 42} ${cy} Q ${x0 + 52.5} ${cy - 17} ${x0 + 63} ${cy} Q ${x0 + 73.5} ${cy - 17} ${x0 + 84} ${cy}`;
      const polLeft = polarity === 'charge' ? '+' : '−';
      const polRight = polarity === 'charge' ? '−' : '+';
      const polColor = saturated ? '#ef4444' : polarity === 'charge' ? 'var(--accent)' : 'var(--warm)';
      const badgeTxt = saturated ? '磁芯饱和过流!' : polarity === 'charge' ? '磁场充能 (+ L −)' : '反转释能 (− L +)';
      return `
        <g>
          <rect x="${cx - 48}" y="${cy - 25}" width="96" height="50" rx="8" fill="var(--paper)"/>
          <rect x="${cx - 48}" y="${cy - 25}" width="96" height="50" rx="8" fill="${saturated ? 'rgba(239,68,68,0.14)' : 'var(--panel)'}" stroke="${polColor}" stroke-width="${saturated ? 2.2 : 1.5}"/>
          <path d="${d}" fill="none" stroke="${polColor}" stroke-width="2.5" stroke-linecap="round"/>
          <text x="${cx - 38}" y="${cy + 16}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${polColor}">${polLeft}</text>
          <text x="${cx + 38}" y="${cy + 16}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${polColor}">${polRight}</text>
          <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--ink)">${labelText}</text>
          <text x="${cx}" y="${cy - 31}" text-anchor="middle" font-size="10.2" font-weight="750" fill="${polColor}">${badgeTxt}</text>
        </g>
      `;
    }

    function drawDiode(cx, cy, isOn, label) {
      const col = isOn ? 'var(--warm)' : 'var(--muted)';
      return `
        <g>
          <rect x="${cx - 32}" y="${cy - 19}" width="64" height="38" rx="8" fill="var(--paper)"/>
          <rect x="${cx - 32}" y="${cy - 19}" width="64" height="38" rx="8" fill="${isOn ? 'rgba(245, 158, 11, 0.14)' : 'var(--subtle-bg)'}" stroke="${col}" stroke-width="${isOn ? 2.1 : 1.3}" ${isOn ? '' : 'stroke-dasharray="4 3"'}/>
          <polygon points="${cx - 9},${cy - 8} ${cx - 9},${cy + 8} ${cx + 5},${cy}" fill="${col}"/>
          <line x1="${cx + 7}" y1="${cy - 8}" x2="${cx + 7}" y2="${cy + 8}" stroke="${col}" stroke-width="2.2"/>
          <text x="${cx}" y="${cy + 29}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${col}">${label}</text>
        </g>
      `;
    }

    function flowPath(d, color, active, reverse) {
      if (!active) {
        return `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.7"/>`;
      }
      return `
        <path d="${d}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.28"/>
        <path class="pwr-flow${reverse ? ' is-rev' : ''}" d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      `;
    }

    function renderTopoSvg(s, m) {
      if (!dom.topoSvg) return;

      // Speed up CSS flow subtly with load current (no JS animation loop!)
      const durSec = clamp(1.35 - s.iload * 0.28, 0.48, 1.35).toFixed(2);
      dom.topoSvg.style.setProperty('--pwr-flow-dur', `${durSec}s`);

      const isP1 = s.phase === 1;
      const enOff = s.faultEnOff;
      const hotStroke = m.thermalRisk === 'danger' ? '#ef4444' : m.thermalRisk === 'warn' ? 'var(--warm)' : '#10b981';

      const inBox = `
        <rect x="12" y="64" width="98" height="84" rx="10" fill="var(--subtle-bg)" stroke="var(--accent)" stroke-width="1.6"/>
        <text x="61" y="90" text-anchor="middle" font-size="12" font-weight="750" fill="var(--ink)">Vin 输入</text>
        <text x="61" y="111" text-anchor="middle" font-size="12" font-weight="750" fill="var(--accent-dark)">${s.vin.toFixed(1)} V</text>
        <text x="61" y="131" text-anchor="middle" font-size="10" fill="var(--muted)">I_in ≈ ${m.iInAvg.toFixed(2)} A</text>
      `;

      const outBox = `
        <rect x="562" y="64" width="106" height="84" rx="10" fill="var(--subtle-bg)" stroke="${enOff && !m.boostLeakThrough ? 'var(--line)' : m.valid ? '#10b981' : '#ef4444'}" stroke-width="1.6"/>
        <text x="615" y="90" text-anchor="middle" font-size="12" font-weight="750" fill="var(--ink)">Vout 负载</text>
        <text x="615" y="111" text-anchor="middle" font-size="12" font-weight="750" fill="${enOff && !m.boostLeakThrough ? 'var(--muted)' : m.valid ? '#10b981' : '#ef4444'}">${m.vOutActual.toFixed(1)} V</text>
        <text x="615" y="131" text-anchor="middle" font-size="10" fill="var(--muted)">${enOff ? (m.boostLeakThrough ? '直通漏电!' : '已断电 0 A') : `I_load = ${s.iload.toFixed(2)} A`}</text>
      `;

      const gndRail = `
        <line x1="61" y1="210" x2="615" y2="210" stroke="var(--line)" stroke-width="2"/>
        <line x1="61" y1="148" x2="61" y2="210" stroke="var(--line)" stroke-width="1.5"/>
        <line x1="615" y1="148" x2="615" y2="210" stroke="var(--line)" stroke-width="1.5"/>
        <text x="340" y="226" text-anchor="middle" font-size="10" font-weight="700" fill="var(--muted)">GND 公共参考地平面</text>
      `;

      let body = '';

      if (s.topo === 'ldo') {
        const active = !enOff;
        const dropV = Math.max(0, s.vin - m.vOutActual).toFixed(2);
        const capMissing = s.faultCap;
        const banner = enOff
          ? 'EN=0 关机：内部调整管彻底关断，Vout = 0.0 V（零直通漏电）'
          : capMissing
          ? '⚠️ 故障注入：100 nF 退耦缺失/过远，高速瞬态拉载触发严重跌落！'
          : isP1
          ? `稳态串联降压：ΔV = ${dropV} V 全在调整管上转化为 ${m.pLoss.toFixed(2)} W 热量`
          : '瞬态拉载：10 μF 补慢跌落 + 100 nF 紧贴引脚就近纳秒救急';
        body = `
          ${gndRail}
          ${flowPath('M 110 106 L 194 106', 'var(--accent)', active)}
          ${flowPath('M 362 106 L 562 106', m.valid ? '#10b981' : '#ef4444', active)}
          <rect x="194" y="58" width="168" height="96" rx="12" fill="var(--paper)"/>
          <rect x="194" y="58" width="168" height="96" rx="12" fill="${m.thermalRisk === 'danger' ? 'rgba(239,68,68,0.12)' : 'var(--panel)'}" stroke="${enOff ? 'var(--line)' : hotStroke}" stroke-width="2.2"/>
          <text x="278" y="82" text-anchor="middle" font-size="12" font-weight="750" fill="var(--ink)">LDO 串联调整管</text>
          <text x="278" y="102" text-anchor="middle" font-size="10.8" font-weight="700" fill="${enOff ? 'var(--muted)' : hotStroke}">${enOff ? '关断 OFF' : `压差 ΔV = ${dropV} V`}</text>
          <text x="278" y="121" text-anchor="middle" font-size="11" font-weight="750" fill="${enOff ? 'var(--muted)' : hotStroke}">${enOff ? 'I_q ≈ 1 μA' : `热耗 ${m.pLoss.toFixed(2)} W · ~${Math.round(m.tjEst)}°C`}</text>
          <text x="278" y="140" text-anchor="middle" font-size="9.5" fill="var(--muted)">I_in = I_load (无储能电感)</text>

          <line x1="422" y1="106" x2="422" y2="210" stroke="var(--accent)" stroke-width="1.8"/>
          <rect x="390" y="138" width="64" height="36" rx="6" fill="var(--paper)"/>
          <rect x="390" y="138" width="64" height="36" rx="6" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.5"/>
          <text x="422" y="154" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">10 μF</text>
          <text x="422" y="167" text-anchor="middle" font-size="9" fill="var(--muted)">中低频蓄水</text>

          <line x1="504" y1="106" x2="504" y2="210" stroke="${capMissing ? '#ef4444' : 'var(--warm)'}" stroke-width="${capMissing ? 1.5 : 2.6}" ${capMissing ? 'stroke-dasharray="3 4"' : ''}/>
          <rect x="468" y="138" width="72" height="36" rx="6" fill="var(--paper)"/>
          <rect x="468" y="138" width="72" height="36" rx="6" fill="${capMissing ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.12)'}" stroke="${capMissing ? '#ef4444' : 'var(--warm)'}" stroke-width="1.6" ${capMissing ? 'stroke-dasharray="3 3"' : ''}/>
          <text x="504" y="154" text-anchor="middle" font-size="10.2" font-weight="750" fill="${capMissing ? '#ef4444' : 'var(--ink)'}">${capMissing ? '100nF 缺失' : '100 nF'}</text>
          <text x="504" y="167" text-anchor="middle" font-size="9" fill="${capMissing ? '#ef4444' : 'var(--warm)'}">${capMissing ? '走线电感阻隔' : '紧贴引脚!'}</text>

          <text x="340" y="24" text-anchor="middle" font-size="11.5" font-weight="750" fill="${capMissing ? '#ef4444' : hotStroke}">${banner}</text>
          ${inBox}${outBox}
        `;
      } else if (s.topo === 'combo') {
        const active = !enOff;
        const banner = enOff
          ? 'EN=0 关机：前级 Buck 与后级 LDO 双级关断，输出 0.0 V'
          : `黄金搭档：Buck 扛大压差 (${s.vin.toFixed(1)}→${m.vMid.toFixed(1)}V 耗 ${m.pLossBuck.toFixed(2)}W) + LDO 滤净 (${m.vMid.toFixed(1)}→${m.vOutActual.toFixed(1)}V 纹波 ${m.rippleMv.toFixed(1)}mV)`;
        body = `
          ${gndRail}
          ${flowPath('M 110 106 L 146 106', 'var(--accent)', active)}
          ${flowPath('M 332 106 L 392 106', 'var(--warm)', active)}
          ${flowPath('M 526 106 L 562 106', '#10b981', active)}

          <!-- Stage 1: Buck -->
          <rect x="146" y="54" width="186" height="104" rx="12" fill="var(--paper)"/>
          <rect x="146" y="54" width="186" height="104" rx="12" fill="var(--panel)" stroke="${m.isSaturated ? '#ef4444' : 'var(--accent)'}" stroke-width="2"/>
          <text x="239" y="76" text-anchor="middle" font-size="11.5" font-weight="750" fill="var(--ink)">① 前级 Buck 高效降压</text>
          <text x="239" y="96" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--accent-dark)">D = ${(m.duty * 100).toFixed(1)}% · ${s.indUh.toFixed(1)} μH</text>
          <text x="239" y="116" text-anchor="middle" font-size="10" fill="var(--muted)">损耗 ${m.pLossBuck.toFixed(2)} W · 中间轨 ${m.vMid.toFixed(2)} V</text>
          <text x="239" y="136" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--warm)">带开关纹波 (交由后级滤除)</text>

          <!-- Mid rail node -->
          <circle cx="362" cy="106" r="4" fill="var(--warm)"/>
          <text x="362" y="92" text-anchor="middle" font-size="10" font-weight="750" fill="var(--warm)">${m.vMid.toFixed(1)}V</text>

          <!-- Stage 2: High-PSRR LDO -->
          <rect x="392" y="54" width="134" height="104" rx="12" fill="var(--paper)"/>
          <rect x="392" y="54" width="134" height="104" rx="12" fill="var(--panel)" stroke="#10b981" stroke-width="2"/>
          <text x="459" y="76" text-anchor="middle" font-size="11.5" font-weight="750" fill="var(--ink)">② 高 PSRR LDO</text>
          <text x="459" y="96" text-anchor="middle" font-size="10.5" font-weight="700" fill="#10b981">小压差 ${(m.vMid - m.vOutActual).toFixed(2)} V</text>
          <text x="459" y="116" text-anchor="middle" font-size="10" fill="var(--muted)">微热 ${m.pLossLdo.toFixed(2)} W</text>
          <text x="459" y="136" text-anchor="middle" font-size="9.5" font-weight="700" fill="#10b981">纹波压至 ${m.rippleMv.toFixed(1)} mVpp</text>

          <text x="340" y="24" text-anchor="middle" font-size="11" font-weight="750" fill="${m.isSaturated ? '#ef4444' : 'var(--accent-dark)'}">${banner}</text>
          ${inBox}${outBox}
        `;
      } else if (s.topo === 'buck') {
        const q1On = !enOff && isP1;
        const q2On = !enOff && !isP1;
        const activeCol = enOff ? 'var(--line)' : isP1 ? 'var(--accent)' : 'var(--warm)';
        const banner = enOff
          ? 'EN=0 关机：上管 Q1 彻底断开，输入与负载安全隔离 (Vout = 0 V)'
          : isP1
          ? `拍① Ton (Q1 闭合)：Vin 经电感充能并供电 · I_L 爬升至 ${m.iLPeak.toFixed(2)} A`
          : '拍② Toff (Q1 断开)：电感反转借 Q2/D 续流释能 · Vin 零抽电';
        body = `
          ${gndRail}
          ${flowPath('M 110 92 L 280 92 L 562 92', 'var(--accent)', q1On)}
          ${flowPath('M 280 210 L 280 92 L 562 92', 'var(--warm)', q2On)}
          ${flowPath('M 110 92 L 280 92', 'var(--line)', false)}
          <circle cx="280" cy="92" r="4.5" fill="${activeCol}"/>
          <text x="280" y="79" text-anchor="middle" font-size="10" font-weight="750" fill="var(--ink)">SW</text>

          <line x1="496" y1="92" x2="496" y2="210" stroke="var(--accent)" stroke-width="1.6"/>
          <rect x="466" y="138" width="60" height="34" rx="6" fill="var(--paper)"/>
          <rect x="466" y="138" width="60" height="34" rx="6" fill="var(--panel)" stroke="${s.faultCap ? '#ef4444' : 'var(--accent)'}" stroke-width="1.5"/>
          <text x="496" y="154" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)">Cout</text>
          <text x="496" y="166" text-anchor="middle" font-size="9" fill="${s.faultCap ? '#ef4444' : 'var(--muted)'}">${s.faultCap ? '容值偏小' : '削峰填谷'}</text>

          ${drawSwitchBox(204, 92, 'Q1 上管', q1On)}
          ${drawSwitchBox(280, 155, 'Q2 / 续流D', q2On, q2On ? '续流导通' : '反偏截止')}
          ${drawInductor(366, 92, isP1 ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`, m.isSaturated)}
          <text x="340" y="24" text-anchor="middle" font-size="11.5" font-weight="750" fill="${m.isSaturated ? '#ef4444' : activeCol}">${banner}</text>
          ${inBox}${outBox}
        `;
      } else if (s.topo === 'boost') {
        const leak = m.boostLeakThrough;
        const q1On = !enOff && isP1;
        const dOn = (!enOff && !isP1) || leak;
        const activeCol = leak ? '#ef4444' : enOff ? 'var(--line)' : isP1 ? 'var(--accent)' : 'var(--warm)';
        const banner = leak
          ? `⚠️ 关断直通隐患：EN=0 关死 Q1，电池仍经 L+二极管直通到输出 (${m.vOutActual.toFixed(1)} V)！`
          : enOff
          ? '✅ True Shutdown 真关断：阻断二极管直通路径，Vout = 0.0 V 零漏电'
          : isP1
          ? '拍① Ton (Q1 拉地)：电感专心攒磁场 · 二极管反偏防 5V 倒灌'
          : `拍② Toff (Q1 断开)：电感反转与 Vin 串联顶过 ${s.vout.toFixed(1)} V 泵电`;
        body = `
          ${gndRail}
          ${flowPath('M 110 92 L 340 92 L 340 210', 'var(--accent)', q1On)}
          ${flowPath('M 110 92 L 562 92', leak ? '#ef4444' : 'var(--warm)', dOn)}
          ${flowPath('M 504 210 L 504 92 L 562 92', '#10b981', q1On)}
          <circle cx="340" cy="92" r="4.5" fill="${activeCol}"/>
          <text x="340" y="79" text-anchor="middle" font-size="10" font-weight="750" fill="var(--ink)">SW</text>

          <line x1="504" y1="92" x2="504" y2="210" stroke="#10b981" stroke-width="1.6"/>
          <rect x="472" y="138" width="64" height="34" rx="6" fill="var(--paper)"/>
          <rect x="472" y="138" width="64" height="34" rx="6" fill="var(--panel)" stroke="${s.faultCap ? '#ef4444' : '#10b981'}" stroke-width="1.5"/>
          <text x="504" y="154" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)">Cout</text>
          <text x="504" y="166" text-anchor="middle" font-size="9" fill="var(--muted)">${q1On ? '独立供载' : '接收泵电'}</text>

          ${drawInductor(226, 92, isP1 && !leak ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`, m.isSaturated)}
          ${drawSwitchBox(340, 155, 'Q1 接地管', q1On, q1On ? '拉地攒能' : '断开')}
          ${drawDiode(422, 92, dOn, leak ? '直通漏电!' : dOn ? '正向泵电' : '防倒灌截止')}
          <text x="340" y="24" text-anchor="middle" font-size="11.3" font-weight="750" fill="${m.isSaturated || leak ? '#ef4444' : activeCol}">${banner}</text>
          ${inBox}${outBox}
        `;
      } else {
        // Four-switch Buck-Boost H-bridge
        let q1 = false, q2 = false, q3 = false, q4 = false;
        let banner = '';
        let pathD = '';
        let activeCol = isP1 ? 'var(--accent)' : 'var(--warm)';

        if (enOff) {
          banner = 'EN=0 关机：四管全断（天然支持真关断，彻底隔离输入与输出）';
          activeCol = 'var(--line)';
        } else if (m.subMode === 'buck') {
          q1 = isP1; q2 = !isP1; q3 = true; q4 = false;
          pathD = isP1 ? 'M 110 88 L 562 88' : 'M 258 210 L 258 88 L 562 88';
          banner = isP1
            ? '自动 Buck 区拍①：Q3 常通 / Q4 常断，Q1 闭合充能'
            : '自动 Buck 区拍②：Q3 常通 / Q4 常断，Q2 续流释能';
        } else if (m.subMode === 'boost') {
          q1 = true; q2 = false; q3 = !isP1; q4 = isP1;
          pathD = isP1 ? 'M 110 88 L 422 88 L 422 210' : 'M 110 88 L 562 88';
          banner = isP1
            ? '自动 Boost 区拍①：Q1 常通 / Q2 常断，Q4 拉地攒能'
            : '自动 Boost 区拍②：Q1 常通 / Q2 常断，Q3 导通串联顶高';
        } else {
          q1 = isP1; q4 = isP1; q2 = !isP1; q3 = !isP1;
          pathD = isP1 ? 'M 110 88 L 422 88 L 422 210' : 'M 258 210 L 258 88 L 562 88';
          banner = isP1
            ? '拐点水桶拍① 舀水：Q1+Q4 闭合充饱电感，Q3 隔离输出'
            : '拐点水桶拍② 倒水：Q2+Q3 闭合反转推电，Q1 切断电池';
        }

        body = `
          ${gndRail}
          ${flowPath('M 110 88 L 562 88', 'var(--line)', false)}
          ${flowPath('M 258 88 L 258 210', 'var(--line)', false)}
          ${flowPath('M 422 88 L 422 210', 'var(--line)', false)}
          ${pathD ? flowPath(pathD, activeCol, true) : ''}

          <circle cx="258" cy="88" r="4" fill="${activeCol}"/>
          <circle cx="422" cy="88" r="4" fill="${activeCol}"/>

          ${drawSwitchBox(186, 88, 'Q1', q1, !enOff && m.subMode === 'boost' ? '常通导线' : q1 ? '闭合' : '断开')}
          ${drawSwitchBox(258, 156, 'Q2', q2, !enOff && m.subMode === 'boost' ? '常断' : q2 ? '导通' : '断开')}
          ${drawInductor(340, 88, isP1 ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`, m.isSaturated)}
          ${drawSwitchBox(494, 88, 'Q3', q3, !enOff && m.subMode === 'buck' ? '常通导线' : q3 ? '闭合' : '断开')}
          ${drawSwitchBox(422, 156, 'Q4', q4, !enOff && m.subMode === 'buck' ? '常断' : q4 ? '拉地' : '断开')}
          <text x="340" y="24" text-anchor="middle" font-size="11.5" font-weight="750" fill="${m.isSaturated ? '#ef4444' : activeCol}">${banner}</text>
          ${inBox}${outBox}
        `;
      }

      dom.topoSvg.innerHTML = body;
    }

    // Evaluate instantaneous waveform values at normalized phase u in [0, cycles)
    function sampleWaveforms(s, m, uCycles) {
      const u = ((uCycles % 1) + 1) % 1;
      const d = clamp(m.duty, 0.04, 0.96);

      if (s.topo === 'ldo') {
        const dipCenter = 0.56;
        const dist = Math.abs(uCycles / 3 - dipCenter);
        const dipShape = dist < 0.09 ? Math.cos((dist / 0.09) * Math.PI * 0.5) : 0;
        const dipMv = (s.faultCap ? m.rippleMv : m.rippleMv * 1.4) * dipShape * dipShape;
        return {
          inTon: true,
          vSw: s.vin,
          iL: s.faultEnOff ? 0 : s.iload,
          vOutAcMv: s.faultEnOff ? 0 : -dipMv,
        };
      }

      if (s.faultEnOff) {
        return { inTon: false, vSw: m.boostLeakThrough ? s.vin : 0, iL: m.iLAvg, vOutAcMv: 0 };
      }

      const inTon = u < d;
      const isBoostSw = s.topo === 'boost' || (s.topo === 'buckboost' && m.subMode === 'boost');
      const vSw = inTon ? (isBoostSw ? 0 : m.vSwHigh) : (isBoostSw ? m.vSwHigh : 0);

      // Triangular inductor current with optional saturation exponential hook
      let iL = 0;
      if (inTon) {
        const frac = u / d;
        const linear = m.iLValley + (m.iLPeak - m.iLValley) * frac;
        if (m.isSaturated && linear > FAULT_ISAT_LIMIT) {
          const baseLin = m.iLValley + (FAULT_ISAT_LIMIT - m.iLValley) * frac;
          const overFrac = clamp((frac - 0.55) / 0.45, 0, 1);
          iL = baseLin + (m.iLPeak - FAULT_ISAT_LIMIT) * overFrac * overFrac;
        } else {
          iL = linear;
        }
      } else {
        const frac = (u - d) / (1 - d);
        iL = m.iLPeak - (m.iLPeak - m.iLValley) * frac;
      }

      // Output AC ripple (mV): parabolic for Buck, sawtooth for Boost/Buck-Boost
      let vOutAcMv = 0;
      const halfRip = m.rippleMv * 0.5;
      if (s.topo === 'buck' || s.topo === 'combo' || (s.topo === 'buckboost' && m.subMode === 'buck')) {
        const centered = inTon ? (u / d) - 0.5 : 0.5 - ((u - d) / (1 - d));
        vOutAcMv = halfRip * Math.sin(centered * Math.PI);
      } else {
        vOutAcMv = inTon
          ? halfRip - (u / d) * m.rippleMv
          : -halfRip + ((u - d) / (1 - d)) * m.rippleMv;
      }

      return { inTon, vSw, iL, vOutAcMv };
    }

    function drawScopeCanvas(s, m) {
      if (!ctx || !dom.canvas) return;
      syncCanvasResolution();

      const W = canvasCssW;
      const H = CANVAS_CSS_H;
      const padL = 54;
      const padR = 14;
      const plotW = Math.max(160, W - padL - padR);
      const cycles = 3;

      ctx.clearRect(0, 0, W, H);
      ctx.font = '600 10px ui-monospace, Consolas, monospace';

      // Helper to draw channel track frame
      const drawTrackBox = (y, h) => {
        ctx.fillStyle = palette.altBg;
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(padL, y, plotW, h, 5);
        else ctx.rect(padL, y, plotW, h);
        ctx.fill();
        ctx.stroke();
      };

      const ch1Y = 20, ch1H = 56;
      const ch2Y = 90, ch2H = 74;
      const ch3Y = 178, ch3H = 52;

      drawTrackBox(ch1Y, ch1H);
      drawTrackBox(ch2Y, ch2H);
      drawTrackBox(ch3Y, ch3H);

      // Phase band highlight in cycle 0
      const d = clamp(m.duty, 0.04, 0.96);
      const cycleW = plotW / cycles;
      if (s.topo !== 'ldo' && !s.faultEnOff) {
        const hlX = s.phase === 1 ? padL : padL + d * cycleW;
        const hlW = s.phase === 1 ? d * cycleW : (1 - d) * cycleW;
        ctx.fillStyle = s.phase === 1 ? 'rgba(0, 122, 255, 0.10)' : 'rgba(245, 158, 11, 0.12)';
        ctx.fillRect(hlX, ch1Y, hlW, ch3Y + ch3H - ch1Y);

        ctx.fillStyle = s.phase === 1 ? palette.accentDark : palette.warm;
        ctx.textAlign = 'center';
        ctx.fillText(s.phase === 1 ? 'Ton 拍①' : 'Toff 拍②', hlX + hlW * 0.5, 13);
      }

      // Top right summary label (outside waveform box so zero overlap)
      ctx.fillStyle = palette.accentDark;
      ctx.textAlign = 'right';
      const topMeta = s.topo === 'ldo'
        ? `Vin=${s.vin.toFixed(1)}V · ΔV=${Math.max(0, s.vin - m.vOutActual).toFixed(2)}V · P=${m.pLoss.toFixed(2)}W`
        : `D=${(m.duty * 100).toFixed(1)}% · f=${s.fswKhz}kHz · T=${m.periodUs.toFixed(2)}μs`;
      ctx.fillText(topMeta, padL + plotW, 13);

      const samples = Math.min(240, Math.max(120, Math.round(plotW / 2.5)));
      const phaseOffset = s.autoPlay && !isReducedMotion() ? phaseClock : 0;

      // CH1: V_SW (or LDO Vin/Vout gap)
      const vScaleMax = Math.max(s.topo === 'ldo' ? s.vin * 1.15 : m.vSwHigh * 1.15, 5.5);
      const yCh1 = (v) => ch1Y + ch1H - 5 - (clamp(v, 0, vScaleMax) / vScaleMax) * (ch1H - 10);

      if (s.topo === 'ldo') {
        const yIn = yCh1(s.vin);
        const yOut = yCh1(m.vOutActual);
        ctx.fillStyle = m.thermalRisk === 'danger' ? 'rgba(239,68,68,0.20)' : 'rgba(245,158,11,0.16)';
        ctx.fillRect(padL + 1, Math.min(yIn, yOut), plotW - 2, Math.max(2, Math.abs(yOut - yIn)));

        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(padL, yIn);
        ctx.lineTo(padL + plotW, yIn);
        ctx.stroke();

        ctx.strokeStyle = palette.ok;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(padL, yOut);
        ctx.lineTo(padL + plotW, yOut);
        ctx.stroke();
      } else {
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const nx = i / samples;
          const pt = sampleWaveforms(s, m, nx * cycles + phaseOffset);
          const px = padL + nx * plotW;
          const py = yCh1(pt.vSw);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // CH1 left labels
      ctx.textAlign = 'right';
      ctx.fillStyle = palette.accentDark;
      ctx.fillText(`${(s.topo === 'ldo' ? s.vin : m.vSwHigh).toFixed(1)}V`, padL - 6, ch1Y + 11);
      ctx.fillStyle = palette.muted;
      ctx.fillText('0V', padL - 6, ch1Y + ch1H - 3);

      // CH2: I_L + I_sat line
      const iSatLineVal = s.faultSat && s.topo !== 'ldo' ? FAULT_ISAT_LIMIT : m.iSatRec;
      const iScaleMax = Math.max(m.iLPeak * 1.18, iSatLineVal * 1.18, 1.0);
      const yCh2 = (amp) => ch2Y + ch2H - 5 - (clamp(amp, 0, iScaleMax) / iScaleMax) * (ch2H - 12);

      // I_sat dashed red line
      if (s.topo !== 'ldo') {
        const ySat = yCh2(iSatLineVal);
        ctx.save();
        ctx.strokeStyle = palette.danger;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, ySat);
        ctx.lineTo(padL + plotW, ySat);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = palette.danger;
        ctx.textAlign = 'right';
        ctx.fillText(
          s.faultSat ? `测试小电感 I_sat = ${FAULT_ISAT_LIMIT.toFixed(1)} A` : `推荐 I_sat ≥ ${m.iSatRec.toFixed(2)} A`,
          padL + plotW - 4,
          Math.max(ch2Y + 11, ySat - 4)
        );
      }

      // I_L waveform
      ctx.strokeStyle = m.isSaturated ? palette.danger : palette.ok;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const nx = i / samples;
        const pt = sampleWaveforms(s, m, nx * cycles + phaseOffset);
        const px = padL + nx * plotW;
        const py = yCh2(pt.iL);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillStyle = m.isSaturated ? palette.danger : palette.ok;
      ctx.fillText(`${m.iLPeak.toFixed(2)}A`, padL - 6, ch2Y + 12);
      ctx.fillStyle = palette.muted;
      ctx.fillText('0A', padL - 6, ch2Y + ch2H - 3);

      // CH3: V_out AC ripple (mVpp)
      const ripMax = Math.max(m.rippleMv * 0.72, 15);
      const yCh3Mid = ch3Y + ch3H * 0.5;
      const yCh3 = (mv) => yCh3Mid - (clamp(mv, -ripMax, ripMax) / ripMax) * (ch3H * 0.42);

      // Center zero line
      ctx.save();
      ctx.strokeStyle = palette.line;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, yCh3Mid);
      ctx.lineTo(padL + plotW, yCh3Mid);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = s.faultCap ? palette.danger : palette.warm;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const nx = i / samples;
        const pt = sampleWaveforms(s, m, nx * cycles + phaseOffset);
        const px = padL + nx * plotW;
        const py = yCh3(pt.vOutAcMv);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillStyle = s.faultCap ? palette.danger : palette.warm;
      ctx.fillText(`±${Math.round(ripMax)}mV`, padL - 6, ch3Y + 12);
      ctx.fillStyle = palette.muted;
      ctx.fillText('AC', padL - 6, ch3Y + ch3H - 4);

      // Interactive cursor crosshair
      let ro = null;
      if (s.cursorNormX !== null) {
        const cx = padL + clamp(s.cursorNormX, 0, 1) * plotW;
        ro = sampleWaveforms(s, m, s.cursorNormX * cycles + phaseOffset);

        ctx.save();
        ctx.strokeStyle = palette.ink;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, ch1Y);
        ctx.lineTo(cx, ch3Y + ch3H);
        ctx.stroke();
        ctx.restore();

        const dot = (y, col) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(cx, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        };
        dot(yCh1(ro.vSw), palette.accent);
        dot(yCh2(ro.iL), m.isSaturated ? palette.danger : palette.ok);
        dot(yCh3(ro.vOutAcMv), s.faultCap ? palette.danger : palette.warm);
      }

      // Update numeric readout bar
      if (ro) {
        const tUs = (s.cursorNormX * cycles * m.periodUs).toFixed(2);
        if (dom.roCh1) dom.roCh1.textContent = `游标 CH1: ${ro.vSw.toFixed(1)} V (${ro.inTon ? 'Ton' : 'Toff'})`;
        if (dom.roCh2) dom.roCh2.textContent = `游标 CH2 I_L: ${ro.iL.toFixed(2)} A`;
        if (dom.roCh3) dom.roCh3.textContent = `游标 CH3 ΔV_out: ${ro.vOutAcMv >= 0 ? '+' : ''}${ro.vOutAcMv.toFixed(1)} mV`;
        if (dom.roTime) dom.roTime.textContent = `t = ${tUs} μs`;
      } else {
        if (dom.roCh1) dom.roCh1.textContent = s.topo === 'ldo' ? `CH1 压差: ${Math.max(0, s.vin - m.vOutActual).toFixed(2)} V` : `CH1 V_SW: 0~${m.vSwHigh.toFixed(1)} V`;
        if (dom.roCh2) dom.roCh2.textContent = s.topo === 'ldo' ? `CH2 直流电流: ${m.iInAvg.toFixed(2)} A` : `CH2 I_L: 峰 ${m.iLPeak.toFixed(2)} A (Δ ${m.deltaIL.toFixed(2)} A)`;
        if (dom.roCh3) dom.roCh3.textContent = `CH3 V_out 纹波: ${m.rippleMv.toFixed(1)} mVpp`;
        if (dom.roTime) dom.roTime.textContent = s.topo === 'ldo' ? '直流稳压 (无开关周期)' : `周期 T = ${m.periodUs.toFixed(2)} μs`;
      }

      // Bottom legend line
      ctx.textAlign = 'left';
      ctx.fillStyle = palette.accentDark;
      ctx.fillText(s.topo === 'ldo' ? '━ CH1 Vin/Vout 压差带' : '━ CH1 V_SW 开关节点', padL, H - 6);
      ctx.fillStyle = m.isSaturated ? palette.danger : palette.ok;
      ctx.fillText(s.topo === 'ldo' ? '━ CH2 串联电流' : '━ CH2 I_L 电感电流', padL + 165, H - 6);
      ctx.fillStyle = s.faultCap ? palette.danger : palette.warm;
      ctx.fillText('━ CH3 V_out AC 纹波', padL + 315, H - 6);
    }

    function renderFullUI() {
      const m = computeModel(state);
      cachedModel = m;

      const isLdo = state.topo === 'ldo';
      if (dom.valVin) dom.valVin.textContent = `${state.vin.toFixed(1)} V`;
      if (dom.valVout) dom.valVout.textContent = `${state.vout.toFixed(1)} V`;
      if (dom.valIload) dom.valIload.textContent = `${state.iload.toFixed(2)} A`;
      if (dom.valInd) dom.valInd.textContent = isLdo ? '无需电感' : `${state.indUh.toFixed(1)} μH`;
      if (dom.valFsw) dom.valFsw.textContent = isLdo ? '纯直流 (无开关)' : `${state.fswKhz} kHz`;

      if (dom.ind) dom.ind.disabled = isLdo;
      if (dom.fsw) dom.fsw.disabled = isLdo;
      if (dom.fieldInd) dom.fieldInd.classList.toggle('is-disabled', isLdo);
      if (dom.fieldFsw) dom.fieldFsw.classList.toggle('is-disabled', isLdo);

      // Update phase button wording
      if (dom.p1Btn && dom.p2Btn) {
        if (isLdo) {
          dom.p1Btn.textContent = '稳态压差';
          dom.p2Btn.textContent = '瞬态退耦';
        } else if (state.topo === 'buckboost') {
          dom.p1Btn.textContent = '拍① 舀水/充能';
          dom.p2Btn.textContent = '拍② 倒水/释能';
        } else {
          dom.p1Btn.textContent = '拍① 充能';
          dom.p2Btn.textContent = '拍② 释能';
        }
      }

      // Stats cards
      let modeLabel = '';
      if (state.faultEnOff) {
        modeLabel = m.boostLeakThrough ? '⚠️ EN=0 仍直通漏电' : '✅ EN=0 已安全关断';
      } else if (state.topo === 'ldo') {
        modeLabel = m.valid ? `LDO 稳压 · ΔV = ${(state.vin - state.vout).toFixed(2)} V` : '⚠️ 压差不足 (Dropout)';
      } else if (state.topo === 'combo') {
        modeLabel = m.valid ? `Buck(${m.vMid.toFixed(1)}V)→LDO · D ${(m.duty * 100).toFixed(0)}%` : '⚠️ 输入余量不足两级压差';
      } else if (state.topo === 'buck') {
        modeLabel = m.valid ? `Buck ${m.dcmRisk ? 'DCM' : 'CCM'} · D = ${(m.duty * 100).toFixed(1)}%` : '⚠️ Vin 需高于 Vout';
      } else if (state.topo === 'boost') {
        modeLabel = m.valid ? `Boost ${m.dcmRisk ? 'DCM' : 'CCM'} · D = ${(m.duty * 100).toFixed(1)}%` : '⚠️ Vin 过高直通失稳';
      } else {
        const sub = m.subMode === 'buck' ? '自动 Buck 区' : m.subMode === 'boost' ? '自动 Boost 区' : '水桶拐点区';
        modeLabel = `${sub} · D = ${(m.duty * 100).toFixed(1)}%`;
      }

      if (dom.statMode) {
        dom.statMode.textContent = modeLabel;
        dom.statMode.className = `aiw-stat-value ${!m.valid || m.isSaturated ? 'pwr-val-danger' : 'accent'}`;
      }
      if (dom.statIin) dom.statIin.textContent = `${m.iInAvg.toFixed(2)} A · η ${(m.eta * 100).toFixed(1)}%`;
      if (dom.statLoss) {
        dom.statLoss.textContent = `${m.pLoss.toFixed(2)} W · ~${Math.round(m.tjEst)} °C`;
        dom.statLoss.className = `aiw-stat-value ${m.thermalRisk === 'danger' ? 'pwr-val-danger' : m.thermalRisk === 'warn' ? 'warn' : 'pwr-val-ok'}`;
      }
      if (dom.statPeak) {
        dom.statPeak.textContent = isLdo
          ? `直流 ${m.iInAvg.toFixed(2)} A / ${m.rippleMv.toFixed(1)} mVpp`
          : `${m.iLPeak.toFixed(2)} A / ${m.rippleMv.toFixed(1)} mVpp`;
        dom.statPeak.className = `aiw-stat-value ${m.isSaturated || state.faultCap ? 'pwr-val-danger' : ''}`;
      }

      // Energy breakdown bar
      const outPct = m.pInTotal > 1e-4 ? clamp((m.pOut / m.pInTotal) * 100, 0, 100) : 0;
      const lossPct = m.pInTotal > 1e-4 ? Math.max(0, 100 - outPct) : 0;
      if (dom.energyTitle) {
        dom.energyTitle.textContent = m.pInTotal > 1e-4
          ? `能量账本：P_in ${m.pInTotal.toFixed(2)} W → 有效输出 ${m.pOut.toFixed(2)} W (${outPct.toFixed(1)}%) + 发热损耗 ${m.pLoss.toFixed(2)} W (${lossPct.toFixed(1)}%)`
          : '能量账本：系统已关闭（P_in ≈ 0.00 W）';
      }
      if (dom.barOut) dom.barOut.style.width = `${outPct.toFixed(1)}%`;
      if (dom.barLoss) dom.barLoss.style.width = `${lossPct.toFixed(1)}%`;
      if (dom.thermalPill) {
        const pillCls = m.thermalRisk === 'danger' ? 'is-danger' : m.thermalRisk === 'warn' ? 'is-warn' : 'is-ok';
        const pillTxt = m.isSaturated
          ? '磁芯饱和过流告警!'
          : m.tjEst >= 125
          ? `过热关断风险 · Tj ≈ ${Math.round(m.tjEst)} °C`
          : m.tjEst >= 85
          ? `明显发热 · Tj ≈ ${Math.round(m.tjEst)} °C`
          : `温升安全 · Tj ≈ ${Math.round(m.tjEst)} °C`;
        dom.thermalPill.className = `pwr-thermal-pill ${pillCls}`;
        dom.thermalPill.textContent = pillTxt;
      }
      if (dom.compareHint) {
        if (state.topo === 'ldo') {
          const buckEst = m.pOut > 0 ? m.pOut * (1 / 0.9 - 1) : 0;
          dom.compareHint.textContent = `同工况若换同步 Buck：热耗仅约 ${buckEst.toFixed(2)} W`;
        } else if (m.ldoRefLoss > 0.05 && !state.faultEnOff) {
          const ratio = m.pLoss > 0.01 ? (m.ldoRefLoss / m.pLoss).toFixed(1) : '∞';
          dom.compareHint.textContent = `同工况若改用 LDO：热耗达 ${m.ldoRefLoss.toFixed(2)} W（约 ${ratio}× 发热）`;
        } else {
          dom.compareHint.textContent = '输入不高于目标输出：LDO 无法升压，需采用开关拓扑';
        }
      }
      if (dom.isatHint) {
        dom.isatHint.textContent = isLdo
          ? (state.faultCap ? '⚠️ 退耦异常：请紧贴引脚补 100 nF' : '退耦建议：10 μF + 100 nF 贴脚')
          : `推荐电感 I_sat ≥ ${m.iSatRec.toFixed(2)} A`;
      }

      // Diagnostic narrative
      if (dom.diagBox) {
        let cls = 'is-ok';
        let msg = '';
        if (m.boostLeakThrough) {
          cls = 'is-danger';
          msg = `【Boost 关断直通隐患已复现】你已将 EN 拉低试图关机，但普通 Boost 从 Vin 经电感 L 和二极管直连 Vout，输出仍残留 ${m.vOutActual.toFixed(2)} V！不仅电池持续漏电，后端短路时也切不断电流。将下方「器件特性」切到「高效同步（含真关断）」即可对比 True Shutdown 彻底断电效果。`;
        } else if (state.faultEnOff) {
          cls = 'is-ok';
          msg = '【EN 关断隔离正常】当前拓扑已安全切断输入至输出路径，输出跌至 0.0 V，静态漏电流降至微安级。关闭「拉低 EN 关机」恢复正常工作观察。';
        } else if (m.isSaturated) {
          cls = 'is-danger';
          msg = `【电感磁芯饱和失控！】测试电感仅支持 I_sat = ${FAULT_ISAT_LIMIT.toFixed(1)} A，但当前峰值已突破极限并出现陡峭上翘尖峰（飙至 ${m.iLPeak.toFixed(2)} A，见 CH2 红色波形顶端）！磁芯饱和瞬间感值塌缩退化成铜线，极易触发过流保护或烧毁开关管。请换用 I_sat ≥ ${m.iSatRec.toFixed(2)} A 的功率电感。`;
        } else if (m.faultType === 'ldo-dropout') {
          cls = 'is-danger';
          msg = `【LDO 压差不足（Dropout）】按「${m.gradeObj.ldoLabel}」最小压差 ${m.gradeObj.vDrop.toFixed(2)} V，稳住 ${state.vout.toFixed(1)} V 至少需要 Vin ≥ ${(state.vout + m.gradeObj.vDrop).toFixed(2)} V。当前输出已跌至 ${m.vOutActual.toFixed(2)} V；可切换「四开关升降压」开启锂电巡航对比！`;
        } else if (m.faultType === 'buck-under' || m.faultType === 'combo-under') {
          cls = 'is-danger';
          msg = `【输入电压余量不足】当前 Vin (${state.vin.toFixed(1)} V) 不足以支撑降压目标（${state.topo === 'combo' ? `前级需留出 LDO 压差余量，建议 Vin ≥ ${(m.vMid + 0.3).toFixed(1)} V` : `Buck 要求 Vin > ${state.vout.toFixed(1)} V`}）。跨压场景请切换到「四开关升降压」。`;
        } else if (m.faultType === 'boost-over') {
          cls = 'is-danger';
          msg = `【Boost 无法降压】当前 Vin (${state.vin.toFixed(1)} V) ≥ 目标 Vout (${state.vout.toFixed(1)} V)，基础 Boost 会经电感与二极管直通输出约 ${m.vOutActual.toFixed(2)} V 且失去稳压能力。`;
        } else if (state.faultCap) {
          cls = 'is-warn';
          msg = `【退耦 / 输出电容异常】模拟拔掉 100 nF 贴脚电容或高 ESR 走线后，CH3 输出纹波/瞬态跌落剧增至 ${m.rippleMv.toFixed(1)} mVpp！高速数字芯片或精密 ADC 极易出现误复位与底噪抖动。`;
        } else if (state.topo === 'combo') {
          cls = 'is-ok';
          msg = `【Buck + LDO 黄金搭档】前级 Buck 把 ${state.vin.toFixed(1)} V 高效降到 ${m.vMid.toFixed(2)} V 中间轨（仅耗 ${m.pLossBuck.toFixed(2)} W），后级高 PSRR LDO 只需吃掉 ${(m.vMid - state.vout).toFixed(2)} V 微小压差（耗 ${m.pLossLdo.toFixed(2)} W），就把输出纹波压低至 ${m.rippleMv.toFixed(1)} mVpp，兼得低温升与高洁净度。`;
        } else if (state.topo === 'ldo' && m.thermalRisk === 'danger') {
          cls = 'is-danger';
          msg = `【LDO 严重过热 (${m.pLoss.toFixed(2)} W · 估算结温 ~${Math.round(m.tjEst)} °C)】${(state.vin - state.vout).toFixed(1)} V 压差全在硅片上烧成热，常规封装几秒就会触发热关断。可点上方切到「Buck 降压」或「Buck+LDO 搭档」直接对比温升与纹波！`;
        } else if (state.topo === 'buckboost' && m.subMode === 'bb-bucket') {
          cls = 'is-ok';
          msg = `【四开关拐点水桶模式】Vin (${state.vin.toFixed(1)} V) 紧贴 Vout (${state.vout.toFixed(1)} V) ±7% 区间，芯片启用四管水桶两拍（Q1+Q4 舀水隔离输出 → Q2+Q3 倒水反转推电，D = ${(m.duty * 100).toFixed(1)}%）丝滑过拐点。试试点「锂电巡航 4.2→2.8V」看三种模态自动无缝切换！`;
        } else if (state.topo === 'boost') {
          cls = m.iLPeak >= 2.0 ? 'is-warn' : 'is-ok';
          msg = `【Boost 升压账本】输出 ${m.pOut.toFixed(2)} W 需从 ${state.vin.toFixed(1)} V 输入平均抽 ${m.iInAvg.toFixed(2)} A，电感峰值达 ${m.iLPeak.toFixed(2)} A（推荐 I_sat ≥ ${m.iSatRec.toFixed(2)} A）。可点击上方「小电感磁饱和」或「拉低 EN 关机」亲自复现两大经典画板坑！`;
        } else if (m.dcmRisk) {
          cls = 'is-warn';
          msg = `【进入断续导通 DCM】电感电流纹波 ΔI_L ≈ ${m.deltaIL.toFixed(2)} A 偏大导致每周期电流回零，可增大电感 L 或提高 f_sw 压低峰值与纹波。`;
        } else {
          cls = 'is-ok';
          msg = `【工作在安全高效区】输入平均电流 ${m.iInAvg.toFixed(2)} A，总热耗 ${m.pLoss.toFixed(2)} W（估算结温 ~${Math.round(m.tjEst)} °C），输出纹波约 ${m.rippleMv.toFixed(1)} mVpp。将鼠标移到下方示波器波形上，可用游标读取任意时刻瞬时值。`;
        }
        dom.diagBox.className = `pwr-diag-box ${cls}`;
        dom.diagBox.textContent = msg;
      }

      // Only rebuild topology SVG when topology/phase/values meaningfully change
      const topoKey = `${state.topo}|${state.phase}|${state.vin.toFixed(1)}|${state.vout.toFixed(1)}|${state.iload.toFixed(2)}|${state.indUh.toFixed(1)}|${state.grade}|${state.faultSat}|${state.faultCap}|${state.faultEnOff}`;
      if (topoKey !== lastTopoKey) {
        lastTopoKey = topoKey;
        renderTopoSvg(state, m);
      }

      drawScopeCanvas(state, m);
    }

    function syncControls() {
      if (dom.vin) dom.vin.value = state.vin.toFixed(1);
      if (dom.vout) dom.vout.value = state.vout.toFixed(1);
      if (dom.iload) dom.iload.value = state.iload.toFixed(2);
      if (dom.ind) dom.ind.value = state.indUh.toFixed(1);
      if (dom.fsw) dom.fsw.value = String(state.fswKhz);
      if (dom.grade) dom.grade.value = state.grade;

      dom.topoBtns.forEach((btn) => {
        const active = btn.getAttribute('data-topo') === state.topo;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      dom.phaseBtns.forEach((btn) => {
        const active = Number(btn.getAttribute('data-phase')) === state.phase;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if (dom.autoBtn) {
        dom.autoBtn.classList.toggle('is-active', state.autoPlay);
        dom.autoBtn.setAttribute('aria-pressed', state.autoPlay ? 'true' : 'false');
        dom.autoBtn.textContent = state.autoPlay ? '暂停慢放' : '慢放';
      }
      if (dom.sweepBtn) {
        dom.sweepBtn.classList.toggle('is-active', state.sweepActive);
        dom.sweepBtn.setAttribute('aria-pressed', state.sweepActive ? 'true' : 'false');
        dom.sweepBtn.textContent = state.sweepActive ? '停止巡航' : '锂电巡航 4.2→2.8V';
      }
      if (dom.faultSatBtn) {
        dom.faultSatBtn.classList.toggle('is-active', state.faultSat);
        dom.faultSatBtn.setAttribute('aria-pressed', state.faultSat ? 'true' : 'false');
      }
      if (dom.faultCapBtn) {
        dom.faultCapBtn.classList.toggle('is-active', state.faultCap);
        dom.faultCapBtn.setAttribute('aria-pressed', state.faultCap ? 'true' : 'false');
      }
      if (dom.faultEnBtn) {
        dom.faultEnBtn.classList.toggle('is-active', state.faultEnOff);
        dom.faultEnBtn.setAttribute('aria-pressed', state.faultEnOff ? 'true' : 'false');
      }
    }

    function needsContinuousLoop() {
      return isVisible && !document.hidden && (state.autoPlay || state.sweepActive);
    }

    function scheduleFrame(full = false) {
      if (full) dirtyFull = true;
      dirtyScope = true;
      if (rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function tick(ts) {
      rafId = null;
      const dt = lastFrameTs ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 0.016;
      lastFrameTs = ts;

      if (state.autoPlay && isVisible && !document.hidden) {
        phaseClock = (phaseClock + dt * 0.45) % 1;
        const nextPhase = phaseClock < 0.5 ? 1 : 2;
        if (nextPhase !== state.phase) {
          state.phase = nextPhase;
          dom.phaseBtns.forEach((btn) => {
            const active = Number(btn.getAttribute('data-phase')) === state.phase;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
          });
          dirtyFull = true;
        }
        dirtyScope = true;
      }

      if (state.sweepActive && isVisible && !document.hidden) {
        const nextVin = state.vin + sweepDir * dt * 0.35;
        if (nextVin <= 2.8) {
          state.vin = 2.8;
          sweepDir = 1;
        } else if (nextVin >= 4.2) {
          state.vin = 4.2;
          sweepDir = -1;
        } else {
          state.vin = nextVin;
        }
        if (dom.vin) dom.vin.value = state.vin.toFixed(1);
        dirtyFull = true;
      }

      if (dirtyFull) {
        dirtyFull = false;
        dirtyScope = false;
        renderFullUI();
      } else if (dirtyScope && cachedModel) {
        dirtyScope = false;
        drawScopeCanvas(state, cachedModel);
      }

      if (needsContinuousLoop()) {
        rafId = requestAnimationFrame(tick);
      } else {
        lastFrameTs = 0;
      }
    }

    // Bind sliders (coalesced via rAF so zero layout thrashing)
    function bindRange(el, key) {
      el?.addEventListener('input', () => {
        if (key === 'vin' && state.sweepActive) {
          state.sweepActive = false;
          syncControls();
        }
        state[key] = parseFloat(el.value);
        scheduleFrame(true);
      });
    }

    bindRange(dom.vin, 'vin');
    bindRange(dom.vout, 'vout');
    bindRange(dom.iload, 'iload');
    bindRange(dom.ind, 'indUh');
    bindRange(dom.fsw, 'fswKhz');

    dom.grade?.addEventListener('change', () => {
      state.grade = dom.grade.value;
      scheduleFrame(true);
    });

    dom.topoBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-topo');
        if (!val) return;
        state.topo = val;
        syncControls();
        scheduleFrame(true);
      });
    });

    dom.phaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.autoPlay = false;
        state.phase = Number(btn.getAttribute('data-phase')) === 2 ? 2 : 1;
        syncControls();
        scheduleFrame(true);
      });
    });

    dom.autoBtn?.addEventListener('click', () => {
      state.autoPlay = !state.autoPlay;
      syncControls();
      scheduleFrame(true);
    });

    dom.sweepBtn?.addEventListener('click', () => {
      state.sweepActive = !state.sweepActive;
      if (state.sweepActive) {
        state.faultEnOff = false;
        state.vout = 3.3;
        state.vin = 4.2;
        sweepDir = -1;
      }
      syncControls();
      scheduleFrame(true);
    });

    dom.faultSatBtn?.addEventListener('click', () => {
      state.faultSat = !state.faultSat;
      syncControls();
      scheduleFrame(true);
    });

    dom.faultCapBtn?.addEventListener('click', () => {
      state.faultCap = !state.faultCap;
      syncControls();
      scheduleFrame(true);
    });

    dom.faultEnBtn?.addEventListener('click', () => {
      state.faultEnOff = !state.faultEnOff;
      if (state.faultEnOff) state.sweepActive = false;
      syncControls();
      scheduleFrame(true);
    });

    const presets = {
      'ldo-hot': { topo: 'ldo', phase: 1, vin: 12.0, vout: 3.3, iload: 1.0, indUh: 10.0, fswKhz: 500, grade: 'async82', faultSat: false, faultCap: false, faultEnOff: false },
      'buck-cool': { topo: 'buck', phase: 1, vin: 12.0, vout: 3.3, iload: 1.0, indUh: 10.0, fswKhz: 500, grade: 'sync90', faultSat: false, faultCap: false, faultEnOff: false },
      'combo-clean': { topo: 'combo', phase: 1, vin: 12.0, vout: 3.3, iload: 1.0, indUh: 10.0, fswKhz: 500, grade: 'sync90', faultSat: false, faultCap: false, faultEnOff: false },
      'boost-5v': { topo: 'boost', phase: 2, vin: 3.7, vout: 5.0, iload: 1.0, indUh: 4.7, fswKhz: 600, grade: 'sync90', faultSat: false, faultCap: false, faultEnOff: false },
      'bb-cross': { topo: 'buckboost', phase: 1, vin: 3.3, vout: 3.3, iload: 0.8, indUh: 4.7, fswKhz: 1000, grade: 'sync90', faultSat: false, faultCap: false, faultEnOff: false },
      'bb-low': { topo: 'buckboost', phase: 2, vin: 3.0, vout: 3.3, iload: 0.8, indUh: 4.7, fswKhz: 1000, grade: 'sync90', faultSat: false, faultCap: false, faultEnOff: false },
    };

    dom.presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = presets[btn.getAttribute('data-preset')];
        if (!p) return;
        state.autoPlay = false;
        state.sweepActive = false;
        Object.assign(state, p);
        syncControls();
        scheduleFrame(true);
      });
    });

    // Canvas pointer cursor measurement (lightweight, only redraws canvas)
    if (dom.canvas) {
      const updateCursor = (clientX) => {
        const rect = dom.canvas.getBoundingClientRect();
        const padL = 54;
        const padR = 14;
        const plotW = Math.max(1, rect.width - padL - padR);
        const rel = (clientX - rect.left - padL) / plotW;
        if (rel >= 0 && rel <= 1) {
          state.cursorNormX = rel;
        } else {
          state.cursorNormX = null;
        }
        scheduleFrame(false);
      };

      dom.canvas.addEventListener('pointermove', (e) => updateCursor(e.clientX), { passive: true });
      dom.canvas.addEventListener('pointerdown', (e) => updateCursor(e.clientX), { passive: true });
      dom.canvas.addEventListener('pointerleave', () => {
        state.cursorNormX = null;
        scheduleFrame(false);
      });
    }

    // Pause automatically when scrolled off-screen or tab hidden
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isVisible = Boolean(entry && entry.isIntersecting);
          root.classList.toggle('is-offscreen', !isVisible);
          if (isVisible && needsContinuousLoop()) {
            scheduleFrame(false);
          }
        },
        { rootMargin: '80px' }
      );
      io.observe(root);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && needsContinuousLoop()) {
        scheduleFrame(false);
      }
    });

    // Sync Canvas palette immediately on theme toggle (Light / Dark / Y2K / Win11 / etc.)
    if ('MutationObserver' in window) {
      const mo = new MutationObserver(() => {
        refreshPalette();
        scheduleFrame(false);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // ResizeObserver for crisp Canvas scaling with zero polling
    if ('ResizeObserver' in window && dom.canvas) {
      const ro = new ResizeObserver(() => {
        scheduleFrame(false);
      });
      ro.observe(dom.canvas);
    }

    refreshPalette();
    syncControls();
    renderFullUI();
  }

  try {
    initPowerTopoLab();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initPowerTopoLab', err);
  }
})();
