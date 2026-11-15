(() => {
  function initChargerIcLab() {
    const root = document.getElementById('charger-demo-app');
    if (!root) return;

    const state = {
      arch: 'parallel', // 'parallel' | 'powerpath'
      topo: 'linear',   // 'linear' | 'buck'
      vin: 5.0,
      vbat: 4.19,
      icc: 0.5,
      iterm: 0.05,
      iload: 0.2,
      iinlim: 1.0,
    };

    const elVin = root.querySelector('#chg-input-vin');
    const elVbat = root.querySelector('#chg-input-vbat');
    const elIcc = root.querySelector('#chg-input-icc');
    const elIterm = root.querySelector('#chg-input-iterm');
    const elIload = root.querySelector('#chg-input-iload');
    const elIinlim = root.querySelector('#chg-input-iinlim');

    const archBtns = root.querySelectorAll('.chg-arch-btn');
    const topoBtns = root.querySelectorAll('.chg-topo-btn');
    const presetBtns = root.querySelectorAll('.chg-preset-btn');

    function setText(selector, text) {
      const el = root.querySelector(selector);
      if (el) el.textContent = text;
    }

    function computeModel(s) {
      const iPre = +(0.1 * s.icc).toFixed(3);
      let stage = 'CC';
      let iBatDemand = s.icc;

      if (s.vbat < 3.0) {
        stage = 'PRE';
        iBatDemand = iPre;
      } else if (s.vbat < 4.1) {
        stage = 'CC';
        iBatDemand = s.icc;
      } else {
        stage = 'CV';
        const frac = Math.max(0, (4.2 - s.vbat) / 0.1);
        iBatDemand = s.icc * Math.pow(frac, 1.4);
      }

      let iOutTotal = 0;
      let iSysFromVbus = 0;
      let iChg = 0;
      let iSense = 0;
      let terminated = false;
      let falseContinue = false;
      let supplement = false;
      let reverseDischarge = false;
      let coldStartBlocked = false;

      if (s.arch === 'parallel') {
        // AN1149 direct parallel: charger limits total output current and senses I_out = I_chg + I_load
        const stageCap = stage === 'PRE' ? iPre : s.icc;
        const chargerCap = Math.min(s.iinlim, stageCap);

        if (stage === 'CV') {
          if (iBatDemand + s.iload <= chargerCap) {
            iOutTotal = iBatDemand + s.iload;
            iChg = iBatDemand;
          } else {
            iOutTotal = chargerCap;
            iChg = chargerCap - s.iload;
          }
        } else {
          iOutTotal = chargerCap;
          iChg = chargerCap - s.iload;
        }

        iSense = Math.max(0, iOutTotal);
        iSysFromVbus = Math.min(s.iload, iOutTotal);

        if (iChg < -0.0005) {
          reverseDischarge = true;
        }
        if (s.vbat < 3.0 && s.iload > 0.05) {
          coldStartBlocked = true;
        }

        if (stage === 'CV') {
          if (iSense <= s.iterm + 1e-6) {
            terminated = true;
            iChg = s.iload > 0 ? -s.iload : 0;
            iOutTotal = 0;
          } else if (iBatDemand <= s.iterm + 1e-6 && s.iload > 0) {
            falseContinue = true;
          }
        }
      } else {
        // Power Path (e.g. BQ24074): VBUS prioritizes OUT/SYS; BAT branch sensed independently
        iSysFromVbus = Math.min(s.iload, s.iinlim);
        const budgetForBat = Math.max(0, s.iinlim - s.iload);

        if (s.iload > s.iinlim + 1e-6) {
          supplement = true;
          iChg = -(s.iload - s.iinlim);
          iSense = 0;
          iOutTotal = s.iinlim;
        } else {
          const allowedBat = Math.min(iBatDemand, budgetForBat);
          iSense = allowedBat;
          if (stage === 'CV' && iSense <= s.iterm + 1e-6) {
            terminated = true;
            iChg = 0;
            iOutTotal = s.iload;
          } else {
            iChg = allowedBat;
            iOutTotal = s.iload + iChg;
          }
        }
      }

      // Thermal dissipation estimate (order-of-magnitude illustration)
      const vsysEst = s.arch === 'powerpath' ? Math.min(4.4, Math.max(3.5, s.vbat + 0.15)) : s.vbat;
      let pLoss = 0;
      if (s.topo === 'linear') {
        if (s.arch === 'parallel') {
          pLoss = Math.max(0, s.vin - s.vbat) * Math.max(0, iOutTotal);
        } else {
          pLoss =
            Math.max(0, s.vin - vsysEst) * Math.max(0, iSysFromVbus) +
            Math.max(0, s.vin - s.vbat) * Math.max(0, iChg);
        }
      } else {
        // Typical Buck converter efficiency ~90% (order-of-magnitude estimate)
        const pOut =
          vsysEst * Math.max(0, iSysFromVbus) +
          s.vbat * Math.max(0, iChg);
        const eta = 0.9;
        pLoss = pOut > 0 ? pOut * (1 / eta - 1) : 0;
      }

      return {
        stage,
        iPre,
        iBatDemand,
        iOutTotal,
        iSysFromVbus,
        iChg,
        iSense,
        terminated,
        falseContinue,
        supplement,
        reverseDischarge,
        coldStartBlocked,
        pLoss,
        vsysEst,
      };
    }

    function fmtA(val) {
      const sign = val < -0.001 ? '-' : '';
      return `${sign}${Math.abs(val).toFixed(2)} A`;
    }

    function vbatToCurveX(v) {
      if (v < 3.0) {
        const t = Math.max(0, (v - 2.6) / 0.4);
        return 54 + t * (118 - 54);
      }
      if (v < 4.1) {
        const t = (v - 3.0) / 1.1;
        return 118 + t * (388 - 118);
      }
      const t = Math.min(1, (v - 4.1) / 0.1);
      return 388 + t * (558 - 388);
    }

    function updateCurveSvg(s, m) {
      const svg = root.querySelector('#chg-curve-svg');
      if (!svg) return;

      const xMin = 54;
      const xMax = 592;
      const yBot = 170;
      const yTop = 24;
      const vMin = 2.5;
      const vMax = 4.35;
      const iMax = Math.max(s.icc * 1.25, s.icc + s.iload * 0.9, 0.75);

      const yFromV = (v) => yBot - ((v - vMin) / (vMax - vMin)) * (yBot - yTop);
      const yFromI = (cur) => yBot - (Math.min(iMax, Math.max(0, cur)) / iMax) * (yBot - yTop);

      const vPts = [];
      const icPts = [];
      const isPts = [];
      const samples = 84;

      for (let i = 0; i <= samples; i++) {
        const x = xMin + (i / samples) * (xMax - xMin);
        let v = 4.2;
        let iBat = 0;

        if (x < 118) {
          const t = (x - 54) / (118 - 54);
          v = 2.6 + t * 0.4;
          iBat = s.icc * 0.1;
        } else if (x < 388) {
          const t = (x - 118) / (388 - 118);
          v = 3.0 + t * 1.1;
          iBat = s.icc;
        } else if (x < 558) {
          const t = (x - 388) / (558 - 388);
          v = 4.1 + t * 0.1;
          iBat = s.icc * Math.pow(Math.max(0, 1 - t), 1.4);
        } else {
          v = 4.2;
          iBat = 0;
        }

        // Adjust curves for current load & architecture
        let iNetBat = iBat;
        let iSensed = iBat;
        if (s.arch === 'parallel') {
          if (x < 388) {
            const cap = Math.min(s.iinlim, x < 118 ? s.icc * 0.1 : s.icc);
            iSensed = cap;
            iNetBat = Math.max(0, cap - s.iload);
          } else if (x < 558) {
            const cap = Math.min(s.iinlim, s.icc);
            if (iBat + s.iload <= cap) {
              iSensed = iBat + s.iload;
              iNetBat = iBat;
            } else {
              iSensed = cap;
              iNetBat = Math.max(0, cap - s.iload);
            }
            if (iSensed <= s.iterm) {
              iSensed = 0;
              iNetBat = 0;
            }
          } else {
            iSensed = s.iload > s.iterm ? Math.min(s.iinlim, s.iload) : 0;
            iNetBat = 0;
          }
        } else {
          const budget = Math.max(0, s.iinlim - s.iload);
          iNetBat = Math.min(iBat, budget);
          iSensed = iNetBat;
          if (x >= 388 && iSensed <= s.iterm) {
            iNetBat = 0;
            iSensed = 0;
          }
        }

        vPts.push(`${x.toFixed(1)},${yFromV(v).toFixed(1)}`);
        icPts.push(`${x.toFixed(1)},${yFromI(iNetBat).toFixed(1)}`);
        isPts.push(`${x.toFixed(1)},${yFromI(iSensed).toFixed(1)}`);
      }

      const pathV = svg.querySelector('#chg-path-vbat');
      const pathIchg = svg.querySelector('#chg-path-ichg');
      const pathIsense = svg.querySelector('#chg-path-isense');
      const lineIterm = svg.querySelector('#chg-line-iterm');
      const labelIterm = svg.querySelector('#chg-lbl-iterm');
      const cursorLine = svg.querySelector('#chg-cursor-line');
      const cursorV = svg.querySelector('#chg-cursor-v');
      const cursorI = svg.querySelector('#chg-cursor-i');

      if (pathV) pathV.setAttribute('d', `M ${vPts.join(' L ')}`);
      if (pathIchg) pathIchg.setAttribute('d', `M ${icPts.join(' L ')}`);
      if (pathIsense) {
        pathIsense.setAttribute('d', `M ${isPts.join(' L ')}`);
        pathIsense.style.opacity = s.arch === 'parallel' && s.iload > 0 ? '1' : '0.28';
      }

      const yTerm = yFromI(s.iterm);
      if (lineIterm) {
        lineIterm.setAttribute('y1', yTerm.toFixed(1));
        lineIterm.setAttribute('y2', yTerm.toFixed(1));
      }
      if (labelIterm) {
        labelIterm.setAttribute('y', Math.max(16, yTerm - 5).toFixed(1));
        labelIterm.textContent = `I_TERM (${s.iterm.toFixed(2)} A)`;
      }

      const cx = vbatToCurveX(s.vbat);
      if (cursorLine) {
        cursorLine.setAttribute('x1', cx.toFixed(1));
        cursorLine.setAttribute('x2', cx.toFixed(1));
      }
      if (cursorV) {
        cursorV.setAttribute('cx', cx.toFixed(1));
        cursorV.setAttribute('cy', yFromV(s.vbat).toFixed(1));
      }
      if (cursorI) {
        cursorI.setAttribute('cx', cx.toFixed(1));
        cursorI.setAttribute('cy', yFromI(Math.max(0, m.iSense)).toFixed(1));
      }
    }

    function updateFlowSvg(s, m) {
      const svg = root.querySelector('#chg-flow-svg');
      if (!svg) return;

      const isPP = s.arch === 'powerpath';
      const parallelGroup = svg.querySelector('#chg-svg-parallel-paths');
      const ppGroup = svg.querySelector('#chg-svg-pp-paths');
      if (parallelGroup) parallelGroup.style.display = isPP ? 'none' : 'inline';
      if (ppGroup) ppGroup.style.display = isPP ? 'inline' : 'none';

      setText('#chg-svg-vin', `${s.vin.toFixed(2)}V · 限流 ${s.iinlim.toFixed(2)}A`);
      setText('#chg-svg-ic-title', isPP ? 'Power Path 充电 IC' : '普通并联充电 IC');
      setText('#chg-svg-ic-sub', s.topo === 'linear' ? '线性调整管 (TP4056/BQ24074)' : 'Buck 降压开关 (BQ25601)');
      setText('#chg-svg-isys', `I_load = ${s.iload.toFixed(2)} A`);

      if (isPP) {
        setText('#chg-svg-pp-vbus-out', `I_in = ${m.iOutTotal.toFixed(2)} A`);
        setText('#chg-svg-pp-sense', `BAT 独立采样: ${m.iSense.toFixed(2)} A`);
        setText('#chg-svg-pp-bat', m.terminated ? '已截止 (0.00 A)' : `I_chg = ${fmtA(m.iChg)}`);

        const suppGroup = svg.querySelector('#chg-svg-pp-supp');
        if (suppGroup) {
          suppGroup.style.display = m.supplement ? 'inline' : 'none';
        }
        setText('#chg-svg-pp-supp-txt', `补电 ${Math.abs(m.iChg).toFixed(2)} A ↑`);
      } else {
        setText('#chg-svg-par-sense', `总采样 I_out = ${m.iOutTotal.toFixed(2)} A`);
        setText(
          '#chg-svg-par-bat',
          m.terminated
            ? `关断 · -${s.iload.toFixed(2)} A`
            : m.reverseDischarge
            ? `倒灌 ${fmtA(m.iChg)} !`
            : `I_chg = ${fmtA(m.iChg)}`
        );
      }

      const batNote =
        m.terminated && !isPP
          ? '已关断 → 负载拉低 Vbat'
          : m.terminated && isPP
          ? '已截止 · VBUS 独供 SYS'
          : m.supplement
          ? 'Supplement 协同补电中'
          : m.reverseDischarge
          ? '警告：电池倒灌放电！'
          : `Vbat = ${s.vbat.toFixed(2)} V`;
      setText('#chg-svg-bat-sub', batNote);
    }

    function render() {
      // Sync labels
      setText('#chg-val-vin', `${state.vin.toFixed(2)} V`);
      setText('#chg-val-vbat', `${state.vbat.toFixed(2)} V`);
      setText('#chg-val-icc', `${state.icc.toFixed(2)} A`);
      setText('#chg-val-iterm', `${state.iterm.toFixed(2)} A`);
      setText('#chg-val-iload', `${state.iload.toFixed(2)} A`);

      const m = computeModel(state);

      // Stats strip
      const stageNames = {
        PRE: `预充 Precharge (${m.iPre.toFixed(2)} A 上限)`,
        CC: '恒流充电 (CC)',
        CV: '恒压充电 (CV 4.20 V)',
      };
      let stageText = stageNames[m.stage];
      if (m.terminated) {
        stageText = state.arch === 'powerpath' ? '✅ 满充截止 (DONE)' : '⚠️ 停充后立即放电';
      } else if (m.falseContinue) {
        stageText = '❌ CV 尾期：被 I_load 拖住不转灯';
      } else if (m.supplement) {
        stageText = '⚡ Battery Supplement 补电模式';
      }

      setText('#chg-stat-stage', stageText);
      setText(
        '#chg-stat-sense',
        `${m.iSense.toFixed(2)} A (${m.iSense <= state.iterm ? '≤' : '>'} ${state.iterm.toFixed(2)} A)`
      );
      setText('#chg-stat-ichg', fmtA(m.iChg));
      setText(
        '#chg-stat-loss',
        `${m.pLoss.toFixed(2)} W (${state.topo === 'linear' ? '线性压差' : 'Buck ~90%'})`
      );

      const senseEl = root.querySelector('#chg-stat-sense');
      if (senseEl) {
        senseEl.className = `aiw-stat-value ${
          m.falseContinue ? 'warn' : m.terminated && state.arch === 'powerpath' ? 'chg-val-ok' : 'accent'
        }`;
      }
      const ichgEl = root.querySelector('#chg-stat-ichg');
      if (ichgEl) {
        ichgEl.className = `aiw-stat-value ${
          m.reverseDischarge || m.supplement ? 'chg-val-danger' : m.iChg > 0 ? 'chg-val-ok' : ''
        }`;
      }
      const lossEl = root.querySelector('#chg-stat-loss');
      if (lossEl) {
        lossEl.className = `aiw-stat-value ${m.pLoss >= 0.8 ? 'warn' : ''}`;
      }

      // Diagnostic message
      const diagEl = root.querySelector('#chg-diag-box');
      if (diagEl) {
        let cls = 'is-ok';
        let msg = '';

        if (m.falseContinue) {
          cls = 'is-danger';
          msg = `【AN1149 无法满充截止】电芯在 CV 尾期真实充电电流已降到 ${m.iBatDemand.toFixed(2)} A（低于 I_TERM=${state.iterm.toFixed(2)} A），但因系统负载并联耗电 ${state.iload.toFixed(2)} A，充电 IC 采样端总电流仍为 ${m.iSense.toFixed(2)} A > ${state.iterm.toFixed(2)} A！芯片误以为没充满，会一直把电芯钳位在 4.20 V 直到安全定时器超时故障。切换到「Power Path 路径管理」即可独立采样 BAT 支路并正常转灯。`;
        } else if (m.coldStartBlocked && state.arch === 'parallel') {
          cls = 'is-danger';
          msg = `【深亏电开机困难】电芯处于 ${state.vbat.toFixed(2)} V 预充区，充电 IC 限流在 I_pre=${m.iPre.toFixed(2)} A；并联负载却试图抽取 ${state.iload.toFixed(2)} A，导致电流全被系统抢走甚至倒拉电池，系统轨也被电芯电压拖死在欠压区间。改用 Power Path 后，VBUS 会先抬起 OUT/SYS 让 MCU 立即启动，同时独立以 ${m.iPre.toFixed(2)} A 慢速预充电池。`;
        } else if (m.reverseDischarge) {
          cls = 'is-danger';
          msg = `【输出超限导致电池反放】并联模式下系统负载 (${state.iload.toFixed(2)} A) 超过了当前充电级限流，差额 ${Math.abs(m.iChg).toFixed(2)} A 被迫由电池反向放电补齐，即便插着外部电源电池依然掉电。`;
        } else if (m.supplement) {
          cls = 'is-warn';
          msg = `【Battery Supplement 协同补电】系统峰值负载 ${state.iload.toFixed(2)} A 超出外部输入限流 ${state.iinlim.toFixed(2)} A，Power Path 内部路径自动导通，由 VBUS 提供 ${state.iinlim.toFixed(2)} A、电池补充 ${Math.abs(m.iChg).toFixed(2)} A，避免系统电压跌落重启。`;
        } else if (m.terminated && state.arch === 'parallel') {
          cls = 'is-warn';
          msg = `【并联停充后反复微充】充电 IC 检测到总电流 ≤ ${state.iterm.toFixed(2)} A 后切断输出，若有微弱待机负载 (${state.iload.toFixed(2)} A) 存在，会立即消耗电池使其电压回落至再充门限，反复触发补电循环。`;
        } else if (m.terminated && state.arch === 'powerpath') {
          cls = 'is-ok';
          msg = `【Power Path 正常满充截止】BAT 支路独立测得充电电流已降至 I_TERM (${state.iterm.toFixed(2)} A) 以下，芯片安全关断电池充电开关防止长期 4.2 V 浮充损伤寿命；同时 VBUS 继续直接向 OUT/SYS 供给 ${state.iload.toFixed(2)} A。`;
        } else if (state.topo === 'linear' && m.pLoss >= 0.8) {
          cls = 'is-warn';
          msg = `【线性充电热耗偏高 (${m.pLoss.toFixed(2)} W)】压差损耗 P_loss = (${state.vin.toFixed(2)} - ${state.vbat.toFixed(2)}) × I ≈ ${m.pLoss.toFixed(2)} W（数量级估算，具体结温取决于封装热阻与 PCB 敷铜）。当结温逼近热调节门限时，线性 IC 会主动压低充电电流；大压差/大电流场景建议切换 Buck 开关拓扑对比损耗。`;
        } else {
          cls = 'is-ok';
          msg = `当前处于 ${stageNames[m.stage]}：净入电池电流 ${fmtA(m.iChg)}，系统负载 ${state.iload.toFixed(2)} A，IC 功耗估算约 ${m.pLoss.toFixed(2)} W（${state.topo === 'linear' ? '无开关纹波，外围极简' : 'Buck 开关高效降压，需注意功率电感与开关回路 EMI'}）。`;
        }

        diagEl.className = `chg-diag-box ${cls}`;
        diagEl.textContent = msg;
      }

      updateFlowSvg(state, m);
      updateCurveSvg(state, m);
    }

    function bindRange(el, key) {
      el?.addEventListener('input', () => {
        state[key] = parseFloat(el.value);
        render();
      });
    }

    bindRange(elVin, 'vin');
    bindRange(elVbat, 'vbat');
    bindRange(elIcc, 'icc');
    bindRange(elIterm, 'iterm');
    bindRange(elIload, 'iload');

    elIinlim?.addEventListener('change', () => {
      state.iinlim = parseFloat(elIinlim.value);
      render();
    });

    archBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-arch');
        if (!val) return;
        state.arch = val;
        archBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        render();
      });
    });

    topoBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-topo');
        if (!val) return;
        state.topo = val;
        topoBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        render();
      });
    });

    const presets = {
      thermal: { arch: 'parallel', topo: 'linear', vin: 5.0, vbat: 3.5, icc: 0.5, iterm: 0.05, iload: 0.0, iinlim: 1.0 },
      an1149: { arch: 'parallel', topo: 'linear', vin: 5.0, vbat: 4.19, icc: 0.5, iterm: 0.05, iload: 0.2, iinlim: 1.0 },
      coldstart: { arch: 'parallel', topo: 'linear', vin: 5.0, vbat: 2.6, icc: 0.5, iterm: 0.05, iload: 0.2, iinlim: 1.0 },
      supplement: { arch: 'powerpath', topo: 'linear', vin: 5.0, vbat: 3.8, icc: 0.5, iterm: 0.05, iload: 0.7, iinlim: 0.5 },
    };

    function syncInputsFromState() {
      if (elVin) elVin.value = state.vin.toFixed(2);
      if (elVbat) elVbat.value = state.vbat.toFixed(2);
      if (elIcc) elIcc.value = state.icc.toFixed(2);
      if (elIterm) elIterm.value = state.iterm.toFixed(2);
      if (elIload) elIload.value = state.iload.toFixed(2);
      if (elIinlim) elIinlim.value = state.iinlim.toFixed(2);

      archBtns.forEach((b) => {
        const active = b.getAttribute('data-arch') === state.arch;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      topoBtns.forEach((b) => {
        const active = b.getAttribute('data-topo') === state.topo;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    }

    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        const p = presets[key];
        if (!p) return;
        Object.assign(state, p);
        syncInputsFromState();
        render();
      });
    });

    syncInputsFromState();
    render();
  }

  try {
    initChargerIcLab();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initChargerIcLab', err);
  }
})();
