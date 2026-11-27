(() => {
  function initPowerTopoLab() {
    const root = document.getElementById('power-topo-demo-app');
    if (!root) return;

    const state = {
      topo: 'buck',      // 'ldo' | 'buck' | 'boost' | 'buckboost'
      phase: 1,          // 1 (Ton / 舀水) | 2 (Toff / 倒水)
      autoPlay: false,
      vin: 12.0,
      vout: 3.3,
      iload: 1.0,
      indUh: 10.0,       // uH
      fswKhz: 500,       // kHz
      grade: 'sync90',   // 'sync90' | 'async82' | 'high94'
    };

    const grades = {
      sync90: { eta: 0.90, vDrop: 0.25, label: '同步开关 ~90%', ldoLabel: 'CMOS LDO (0.25V 压差)' },
      async82: { eta: 0.82, vDrop: 1.10, label: '异步肖特基 ~82%', ldoLabel: '常规 1117 LDO (1.1V 压差)' },
      high94: { eta: 0.94, vDrop: 0.12, label: '高效同步 ~94%', ldoLabel: '超低压差 LDO (0.12V 压差)' },
    };

    const elVin = root.querySelector('#pwr-input-vin');
    const elVout = root.querySelector('#pwr-input-vout');
    const elIload = root.querySelector('#pwr-input-iload');
    const elInd = root.querySelector('#pwr-input-ind');
    const elFsw = root.querySelector('#pwr-input-fsw');
    const elGrade = root.querySelector('#pwr-input-grade');
    const fieldInd = root.querySelector('#pwr-field-ind');
    const fieldFsw = root.querySelector('#pwr-field-fsw');

    const topoBtns = root.querySelectorAll('.pwr-topo-btn');
    const phaseBtns = root.querySelectorAll('.pwr-phase-btn[data-phase]');
    const autoBtn = root.querySelector('#pwr-btn-auto');
    const presetBtns = root.querySelectorAll('.pwr-preset-btn');

    let autoTimer = null;

    function setText(selector, text) {
      const el = root.querySelector(selector);
      if (el) el.textContent = text;
    }

    function clamp(val, min, max) {
      return Math.min(max, Math.max(min, val));
    }

    function computeModel(s) {
      const g = grades[s.grade] || grades.sync90;
      const pOut = s.vout * s.iload;
      const L = s.indUh * 1e-6;
      const f = s.fswKhz * 1e3;
      const T = 1 / f;

      let valid = true;
      let faultType = '';
      let subMode = s.topo; // 'ldo' | 'buck' | 'boost' | 'bb-bucket'
      let duty = 0.5;
      let eta = g.eta;
      let iInAvg = s.iload;
      let pLoss = 0;
      let iLAvg = s.iload;
      let deltaIL = 0;
      let iLPeak = s.iload;
      let iLValley = s.iload;
      let vSwHigh = s.vin;
      let vSwLow = 0;
      let dcmRisk = false;
      let vOutActual = s.vout;

      if (s.topo === 'ldo') {
        subMode = 'ldo';
        const iq = 0.002;
        if (s.vin < s.vout + g.vDrop - 1e-6) {
          valid = false;
          faultType = 'ldo-dropout';
          vOutActual = Math.max(0, s.vin - g.vDrop);
          iInAvg = s.iload + iq;
          pLoss = Math.max(0, s.vin - vOutActual) * s.iload + s.vin * iq;
          eta = s.vin > 0 ? clamp((vOutActual * s.iload) / (s.vin * iInAvg), 0, 0.99) : 0;
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
      } else if (s.topo === 'buck') {
        subMode = 'buck';
        if (s.vin <= s.vout + 0.05) {
          valid = false;
          faultType = 'buck-under';
          duty = 0.98;
          vOutActual = Math.max(0, s.vin * 0.95);
          iInAvg = s.iload;
          pLoss = Math.max(0.05, s.vin * iInAvg - vOutActual * s.iload);
          eta = s.vin > 0 ? clamp((vOutActual * s.iload) / (s.vin * iInAvg), 0, 0.98) : 0;
          iLAvg = s.iload;
          deltaIL = 0.08 * s.iload;
          iLPeak = iLAvg + deltaIL / 2;
          iLValley = Math.max(0, iLAvg - deltaIL / 2);
          vSwHigh = s.vin;
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
            iLPeak = Math.sqrt((2 * s.iload * deltaIL) / Math.max(0.1, 1));
          } else {
            iLValley = iLAvg - deltaIL / 2;
            iLPeak = iLAvg + deltaIL / 2;
          }
          vSwHigh = s.vin;
        }
      } else if (s.topo === 'boost') {
        subMode = 'boost';
        if (s.vin >= s.vout - 0.05) {
          valid = false;
          faultType = 'boost-over';
          duty = 0.02;
          vOutActual = Math.max(0, s.vin - 0.35);
          iInAvg = s.iload;
          iLAvg = s.iload;
          pLoss = 0.35 * s.iload;
          eta = clamp(vOutActual / s.vin, 0, 0.98);
          deltaIL = 0.05 * s.iload;
          iLPeak = iLAvg + deltaIL / 2;
          iLValley = Math.max(0, iLAvg - deltaIL / 2);
          vSwHigh = s.vin;
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
        }
      } else {
        // Four-switch Buck-Boost: automatic region selection (±7% crossing band)
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
        } else {
          // Crossing point: 4-switch Bucket mode (Q1+Q4 charge -> Q2+Q3 release)
          subMode = 'bb-bucket';
          duty = clamp(s.vout / (s.vin + s.vout), 0.35, 0.65);
          eta = clamp(g.eta - 0.03, 0.75, 0.91);
          const pIn = pOut / eta;
          iInAvg = pIn / s.vin;
          pLoss = pIn - pOut;
          iLAvg = s.iload / Math.max(0.2, 1 - duty);
          deltaIL = (s.vin * duty * T) / L;
          vSwHigh = Math.max(s.vin, s.vout);
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

      const iSatRec = iLPeak * 1.3;
      const thermalRisk = pLoss >= 1.5 ? 'danger' : pLoss >= 0.75 ? 'warn' : 'ok';

      return {
        valid,
        faultType,
        subMode,
        duty,
        eta,
        pOut,
        pLoss,
        iInAvg,
        iLAvg,
        deltaIL,
        iLPeak,
        iLValley,
        iSatRec,
        vSwHigh,
        vSwLow,
        dcmRisk,
        vOutActual,
        thermalRisk,
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
          <rect x="${x - 38}" y="${y - 22}" width="76" height="44" rx="8" fill="var(--paper)"/>
          <rect x="${x - 38}" y="${y - 22}" width="76" height="44" rx="8" fill="${overlayFill}" stroke="${stroke}" stroke-width="${isOn ? 2.2 : 1.4}" ${isOn ? '' : 'stroke-dasharray="4 3"'}/>
          <text x="${x}" y="${y - 4}" text-anchor="middle" font-size="11.5" font-weight="750" fill="var(--ink)">${name}</text>
          <text x="${x}" y="${y + 12}" text-anchor="middle" font-size="10" font-weight="700" fill="${textCol}">${subtitle || stateTxt}</text>
        </g>
      `;
    }

    function drawInductor(cx, cy, polarity, labelText) {
      // 4 coils centered around cx
      const x0 = cx - 44;
      const d = `M ${x0} ${cy} Q ${x0 + 11} ${cy - 18} ${x0 + 22} ${cy} Q ${x0 + 33} ${cy - 18} ${x0 + 44} ${cy} Q ${x0 + 55} ${cy - 18} ${x0 + 66} ${cy} Q ${x0 + 77} ${cy - 18} ${x0 + 88} ${cy}`;
      const polLeft = polarity === 'charge' ? '+' : '−';
      const polRight = polarity === 'charge' ? '−' : '+';
      const polColor = polarity === 'charge' ? 'var(--accent)' : 'var(--warm)';
      const badgeTxt = polarity === 'charge' ? '磁场充能 (+ L −)' : '反转释能 (− L +)';
      return `
        <g>
          <rect x="${cx - 50}" y="${cy - 26}" width="100" height="52" rx="8" fill="var(--panel)" stroke="${polColor}" stroke-width="1.4" opacity="0.92"/>
          <path d="${d}" fill="none" stroke="${polColor}" stroke-width="2.6" stroke-linecap="round"/>
          <text x="${cx - 40}" y="${cy + 17}" text-anchor="middle" font-size="12" font-weight="800" fill="${polColor}">${polLeft}</text>
          <text x="${cx + 40}" y="${cy + 17}" text-anchor="middle" font-size="12" font-weight="800" fill="${polColor}">${polRight}</text>
          <text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)">${labelText}</text>
          <text x="${cx}" y="${cy - 33}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${polColor}">${badgeTxt}</text>
        </g>
      `;
    }

    function drawDiode(cx, cy, isOn, label) {
      const col = isOn ? 'var(--warm)' : 'var(--muted)';
      return `
        <g>
          <rect x="${cx - 34}" y="${cy - 20}" width="68" height="40" rx="8" fill="${isOn ? 'rgba(245, 158, 11, 0.14)' : 'var(--subtle-bg)'}" stroke="${col}" stroke-width="${isOn ? 2.1 : 1.3}" ${isOn ? '' : 'stroke-dasharray="4 3"'}/>
          <polygon points="${cx - 10},${cy - 9} ${cx - 10},${cy + 9} ${cx + 6},${cy}" fill="${col}"/>
          <line x1="${cx + 8}" y1="${cy - 9}" x2="${cx + 8}" y2="${cy + 9}" stroke="${col}" stroke-width="2.2"/>
          <text x="${cx}" y="${cy + 31}" text-anchor="middle" font-size="10" font-weight="700" fill="${col}">${label}</text>
        </g>
      `;
    }

    function renderTopoSvg(s, m) {
      const svg = root.querySelector('#pwr-topo-svg');
      if (!svg) return;

      const isP1 = s.phase === 1;
      const hotStroke = m.thermalRisk === 'danger' ? '#ef4444' : m.thermalRisk === 'warn' ? 'var(--warm)' : '#10b981';
      let body = '';

      // Common input & output blocks
      const inBox = `
        <rect x="14" y="64" width="102" height="84" rx="10" fill="var(--subtle-bg)" stroke="var(--accent)" stroke-width="1.6"/>
        <text x="65" y="92" text-anchor="middle" font-size="12.5" font-weight="750" fill="var(--ink)">Vin 输入</text>
        <text x="65" y="113" text-anchor="middle" font-size="12" font-weight="700" fill="var(--accent-dark)">${s.vin.toFixed(1)} V</text>
        <text x="65" y="132" text-anchor="middle" font-size="10.5" fill="var(--muted)">I_in ≈ ${m.iInAvg.toFixed(2)} A</text>
      `;

      const outBox = `
        <rect x="556" y="64" width="110" height="84" rx="10" fill="var(--subtle-bg)" stroke="${m.valid ? '#10b981' : '#ef4444'}" stroke-width="1.6"/>
        <text x="611" y="92" text-anchor="middle" font-size="12.5" font-weight="750" fill="var(--ink)">Vout 负载</text>
        <text x="611" y="113" text-anchor="middle" font-size="12" font-weight="700" fill="${m.valid ? '#10b981' : '#ef4444'}">${m.vOutActual.toFixed(1)} V</text>
        <text x="611" y="132" text-anchor="middle" font-size="10.5" fill="var(--muted)">I_load = ${s.iload.toFixed(2)} A</text>
      `;

      const gndRail = `
        <line x1="65" y1="210" x2="611" y2="210" stroke="var(--line)" stroke-width="2"/>
        <text x="340" y="226" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--muted)">GND 公共参考地平面</text>
      `;

      if (s.topo === 'ldo') {
        const dropV = Math.max(0, s.vin - m.vOutActual).toFixed(2);
        const capHint = isP1 ? '稳态供电：调整管串联硬吃压差' : '瞬态拉载：100 nF 紧贴引脚纳秒救急';
        body = `
          ${gndRail}
          <line x1="116" y1="106" x2="196" y2="106" stroke="var(--accent)" stroke-width="2.8"/>
          <line x1="364" y1="106" x2="556" y2="106" stroke="${m.valid ? '#10b981' : '#ef4444'}" stroke-width="2.8"/>
          <line x1="65" y1="148" x2="65" y2="210" stroke="var(--line)" stroke-width="1.6"/>
          <line x1="611" y1="148" x2="611" y2="210" stroke="var(--line)" stroke-width="1.6"/>
          <!-- LDO Pass Transistor -->
          <rect x="196" y="58" width="168" height="96" rx="12" fill="${m.thermalRisk === 'danger' ? 'rgba(239,68,68,0.12)' : 'var(--panel)'}" stroke="${hotStroke}" stroke-width="2.2"/>
          <text x="280" y="82" text-anchor="middle" font-size="12.5" font-weight="750" fill="var(--ink)">LDO 内部调整管</text>
          <text x="280" y="102" text-anchor="middle" font-size="11" font-weight="700" fill="${hotStroke}">压差 ΔV = ${dropV} V</text>
          <text x="280" y="121" text-anchor="middle" font-size="11.5" font-weight="750" fill="${hotStroke}">热耗 P = ${m.pLoss.toFixed(2)} W</text>
          <text x="280" y="140" text-anchor="middle" font-size="10" fill="var(--muted)">全程串联 I_in = I_load</text>
          <!-- 10uF + 100nF Decoupling -->
          <line x1="426" y1="106" x2="426" y2="210" stroke="var(--accent)" stroke-width="${isP1 ? 1.8 : 2.6}"/>
          <rect x="394" y="138" width="64" height="36" rx="6" fill="var(--paper)"/>
          <rect x="394" y="138" width="64" height="36" rx="6" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.5"/>
          <text x="426" y="155" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">10 μF</text>
          <text x="426" y="168" text-anchor="middle" font-size="9.5" fill="var(--muted)">慢跌落蓄水</text>

          <line x1="504" y1="106" x2="504" y2="210" stroke="var(--warm)" stroke-width="${isP1 ? 1.8 : 3.0}"/>
          <rect x="470" y="138" width="68" height="36" rx="6" fill="var(--paper)"/>
          <rect x="470" y="138" width="68" height="36" rx="6" fill="${isP1 ? 'var(--panel)' : 'rgba(245,158,11,0.14)'}" stroke="var(--warm)" stroke-width="${isP1 ? 1.5 : 2.2}"/>
          <text x="504" y="155" text-anchor="middle" font-size="10.5" font-weight="750" fill="var(--ink)">100 nF</text>
          <text x="504" y="168" text-anchor="middle" font-size="9.5" fill="var(--warm)">紧贴引脚!</text>

          <text x="340" y="26" text-anchor="middle" font-size="12" font-weight="750" fill="${hotStroke}">${capHint}</text>
          ${inBox}${outBox}
        `;
      } else if (s.topo === 'buck') {
        const activeCol = isP1 ? 'var(--accent)' : 'var(--warm)';
        const phaseTxt = isP1
          ? `拍① Ton (Q1 闭合)：Vin 经电感充能并供电 · I_L 爬升`
          : `拍② Toff (Q1 断开)：电感反转借 Q2/D 续流释能 · Vin 零抽电`;
        body = `
          ${gndRail}
          <!-- Wires -->
          <line x1="116" y1="92" x2="170" y2="92" stroke="${isP1 ? 'var(--accent)' : 'var(--line)'}" stroke-width="${isP1 ? 3 : 1.5}" ${isP1 ? '' : 'stroke-dasharray="4 3"'}/>
          <line x1="246" y1="92" x2="314" y2="92" stroke="${activeCol}" stroke-width="2.8"/>
          <line x1="414" y1="92" x2="556" y2="92" stroke="${activeCol}" stroke-width="2.8"/>
          <!-- SW to low-side -->
          <circle cx="280" cy="92" r="4.5" fill="${activeCol}"/>
          <text x="280" y="79" text-anchor="middle" font-size="10.5" font-weight="750" fill="var(--ink)">SW</text>
          <line x1="280" y1="92" x2="280" y2="210" stroke="${isP1 ? 'var(--line)' : 'var(--warm)'}" stroke-width="${isP1 ? 1.5 : 3}" ${isP1 ? 'stroke-dasharray="4 3"' : ''}/>
          <!-- Cout -->
          <line x1="496" y1="92" x2="496" y2="210" stroke="var(--accent)" stroke-width="1.8"/>
          <rect x="466" y="138" width="60" height="34" rx="6" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.4"/>
          <text x="496" y="154" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">Cout</text>
          <text x="496" y="166" text-anchor="middle" font-size="9.5" fill="var(--muted)">削峰填谷</text>
          <line x1="65" y1="148" x2="65" y2="210" stroke="var(--line)" stroke-width="1.6"/>
          <line x1="611" y1="148" x2="611" y2="210" stroke="var(--line)" stroke-width="1.6"/>

          ${drawSwitchBox(208, 92, 'Q1 上管', isP1)}
          ${drawSwitchBox(280, 155, 'Q2 / 续流D', !isP1, !isP1 ? '续流导通' : '反偏截止')}
          ${drawInductor(364, 92, isP1 ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`)}
          <text x="340" y="24" text-anchor="middle" font-size="11.8" font-weight="750" fill="${activeCol}">${phaseTxt}</text>
          ${inBox}${outBox}
        `;
      } else if (s.topo === 'boost') {
        const activeCol = isP1 ? 'var(--accent)' : 'var(--warm)';
        const phaseTxt = isP1
          ? `拍① Ton (Q1 闭合接地)：电感专心攒磁场 · 二极管反偏防倒灌`
          : `拍② Toff (Q1 断开)：电感反转与 Vin 串联顶过 ${s.vout.toFixed(1)}V 泵电`;
        body = `
          ${gndRail}
          <!-- Vin to Inductor to SW -->
          <line x1="116" y1="92" x2="178" y2="92" stroke="${activeCol}" stroke-width="3"/>
          <line x1="278" y1="92" x2="340" y2="92" stroke="${activeCol}" stroke-width="3"/>
          <!-- SW to Diode to Vout -->
          <line x1="340" y1="92" x2="386" y2="92" stroke="${isP1 ? 'var(--line)' : 'var(--warm)'}" stroke-width="${isP1 ? 1.5 : 3}" ${isP1 ? 'stroke-dasharray="4 3"' : ''}/>
          <line x1="454" y1="92" x2="556" y2="92" stroke="${isP1 ? '#10b981' : 'var(--warm)'}" stroke-width="2.6"/>
          <!-- SW node down to Q1 -->
          <circle cx="340" cy="92" r="4.5" fill="${activeCol}"/>
          <text x="340" y="79" text-anchor="middle" font-size="10.5" font-weight="750" fill="var(--ink)">SW</text>
          <line x1="340" y1="92" x2="340" y2="210" stroke="${isP1 ? 'var(--accent)' : 'var(--line)'}" stroke-width="${isP1 ? 3 : 1.5}" ${isP1 ? '' : 'stroke-dasharray="4 3"'}/>
          <!-- Cout -->
          <line x1="504" y1="92" x2="504" y2="210" stroke="#10b981" stroke-width="${isP1 ? 2.6 : 1.8}"/>
          <rect x="472" y="138" width="64" height="34" rx="6" fill="var(--panel)" stroke="#10b981" stroke-width="1.5"/>
          <text x="504" y="154" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">Cout</text>
          <text x="504" y="166" text-anchor="middle" font-size="9.5" fill="var(--muted)">${isP1 ? '独立供载' : '接收泵电'}</text>
          <line x1="65" y1="148" x2="65" y2="210" stroke="var(--line)" stroke-width="1.6"/>
          <line x1="611" y1="148" x2="611" y2="210" stroke="var(--line)" stroke-width="1.6"/>

          ${drawInductor(228, 92, isP1 ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`)}
          ${drawSwitchBox(340, 155, 'Q1 接地管', isP1, isP1 ? '拉地攒能' : '断开顶高')}
          ${drawDiode(420, 92, !isP1, !isP1 ? '正向泵电' : '防倒灌截止')}
          <text x="340" y="24" text-anchor="middle" font-size="11.8" font-weight="750" fill="${activeCol}">${phaseTxt}</text>
          ${inBox}${outBox}
        `;
      } else {
        // Four-switch Buck-Boost H-bridge
        let q1 = false, q2 = false, q3 = false, q4 = false;
        let modeBanner = '';
        if (m.subMode === 'buck') {
          q1 = isP1; q2 = !isP1; q3 = true; q4 = false;
          modeBanner = isP1
            ? 'Buck 区拍①：Q3 常通 / Q4 关死，Q1 闭合向电感充能'
            : 'Buck 区拍②：Q3 常通 / Q4 关死，Q2 续流释能';
        } else if (m.subMode === 'boost') {
          q1 = true; q2 = false; q3 = !isP1; q4 = isP1;
          modeBanner = isP1
            ? 'Boost 区拍①：Q1 常通 / Q2 关死，Q4 拉地给电感攒能'
            : 'Boost 区拍②：Q1 常通 / Q2 关死，Q3 导通串联顶高';
        } else {
          q1 = isP1; q4 = isP1; q2 = !isP1; q3 = !isP1;
          modeBanner = isP1
            ? '拐点水桶拍① 舀水：Q1+Q4 闭合充饱电感，Q3 隔离输出'
            : '拐点水桶拍② 倒水：Q2+Q3 闭合反转推电，Q1 切断电池';
        }
        const activeCol = isP1 ? 'var(--accent)' : 'var(--warm)';
        body = `
          ${gndRail}
          <!-- Main horizontal rail -->
          <line x1="116" y1="88" x2="152" y2="88" stroke="${q1 ? 'var(--accent)' : 'var(--line)'}" stroke-width="${q1 ? 2.8 : 1.4}" ${q1 ? '' : 'stroke-dasharray="4 3"'}/>
          <line x1="228" y1="88" x2="290" y2="88" stroke="${activeCol}" stroke-width="2.8"/>
          <line x1="390" y1="88" x2="452" y2="88" stroke="${activeCol}" stroke-width="2.8"/>
          <line x1="528" y1="88" x2="556" y2="88" stroke="${q3 ? '#10b981' : 'var(--line)'}" stroke-width="${q3 ? 2.8 : 1.4}" ${q3 ? '' : 'stroke-dasharray="4 3"'}/>
          <!-- SW1 & SW2 vertical legs -->
          <circle cx="258" cy="88" r="4" fill="${activeCol}"/>
          <line x1="258" y1="88" x2="258" y2="210" stroke="${q2 ? 'var(--warm)' : 'var(--line)'}" stroke-width="${q2 ? 2.8 : 1.4}" ${q2 ? '' : 'stroke-dasharray="4 3"'}/>
          <circle cx="422" cy="88" r="4" fill="${activeCol}"/>
          <line x1="422" y1="88" x2="422" y2="210" stroke="${q4 ? 'var(--accent)' : 'var(--line)'}" stroke-width="${q4 ? 2.8 : 1.4}" ${q4 ? '' : 'stroke-dasharray="4 3"'}/>

          <line x1="65" y1="148" x2="65" y2="210" stroke="var(--line)" stroke-width="1.6"/>
          <line x1="611" y1="148" x2="611" y2="210" stroke="var(--line)" stroke-width="1.6"/>

          ${drawSwitchBox(190, 88, 'Q1', q1, m.subMode === 'boost' ? '常通导线' : q1 ? '闭合' : '断开')}
          ${drawSwitchBox(258, 156, 'Q2', q2, m.subMode === 'boost' ? '常断' : q2 ? '导通' : '断开')}
          ${drawInductor(340, 88, isP1 ? 'charge' : 'release', `${s.indUh.toFixed(1)} μH`)}
          ${drawSwitchBox(490, 88, 'Q3', q3, m.subMode === 'buck' ? '常通导线' : q3 ? '闭合' : '断开')}
          ${drawSwitchBox(422, 156, 'Q4', q4, m.subMode === 'buck' ? '常断' : q4 ? '拉地' : '断开')}
          <text x="340" y="24" text-anchor="middle" font-size="11.8" font-weight="750" fill="${activeCol}">${modeBanner}</text>
          ${inBox}${outBox}
        `;
      }

      svg.innerHTML = body;
    }

    function renderScopeSvg(s, m) {
      const svg = root.querySelector('#pwr-scope-svg');
      if (!svg) return;

      const x0 = 64;
      const x1 = 648;
      const w = x1 - x0;

      if (s.topo === 'ldo') {
        // LDO view: Vin rail vs Vout rail + heat gap + transient spike suppression
        const yTop = 26;
        const yBot = 198;
        const vMax = Math.max(s.vin * 1.15, 6);
        const yFromV = (v) => yBot - (clamp(v, 0, vMax) / vMax) * (yBot - yTop);
        const yIn = yFromV(s.vin);
        const yOut = yFromV(m.vOutActual);
        const heatFill = m.thermalRisk === 'danger' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.15)';
        const heatStroke = m.thermalRisk === 'danger' ? '#ef4444' : 'var(--warm)';

        // Simulated transient droop without 100nF vs with 100nF
        const dipX = x0 + w * 0.56;
        const noCapPath = `M ${x0} ${yOut.toFixed(1)} L ${(dipX - 18).toFixed(1)} ${yOut.toFixed(1)} Q ${dipX.toFixed(1)} ${(yOut + 36).toFixed(1)} ${(dipX + 32).toFixed(1)} ${yOut.toFixed(1)} L ${x1} ${yOut.toFixed(1)}`;
        const withCapPath = `M ${x0} ${yOut.toFixed(1)} L ${(dipX - 12).toFixed(1)} ${yOut.toFixed(1)} Q ${dipX.toFixed(1)} ${(yOut + 6).toFixed(1)} ${(dipX + 18).toFixed(1)} ${yOut.toFixed(1)} L ${x1} ${yOut.toFixed(1)}`;

        svg.innerHTML = `
          <rect x="${x0}" y="${yTop}" width="${w}" height="${yBot - yTop}" rx="6" fill="var(--alt-bg)" stroke="var(--line)" stroke-width="1"/>
          <!-- Heat loss band between Vin and Vout -->
          <rect x="${x0}" y="${Math.min(yIn, yOut).toFixed(1)}" width="${w}" height="${Math.max(2, Math.abs(yOut - yIn)).toFixed(1)}" fill="${heatFill}"/>
          <line x1="${x0}" y1="${yIn.toFixed(1)}" x2="${x1}" y2="${yIn.toFixed(1)}" stroke="var(--accent)" stroke-width="2.4"/>
          <path d="${noCapPath}" fill="none" stroke="#ef4444" stroke-width="1.8" stroke-dasharray="5 4"/>
          <path d="${withCapPath}" fill="none" stroke="#10b981" stroke-width="2.6"/>

          <text x="${x0 - 8}" y="${(yIn + 4).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="700" fill="var(--accent-dark)">${s.vin.toFixed(1)}V</text>
          <text x="${x0 - 8}" y="${(yOut + 4).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="700" fill="#10b981">${m.vOutActual.toFixed(1)}V</text>
          <text x="${x0 - 8}" y="${yBot}" text-anchor="end" font-size="10" fill="var(--muted)">0V</text>

          <text x="${(x0 + x1) / 2}" y="${((yIn + yOut) / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="750" fill="${heatStroke}">
            压差耗散区：ΔV = ${Math.max(0, s.vin - m.vOutActual).toFixed(2)}V × ${s.iload.toFixed(2)}A = ${m.pLoss.toFixed(2)} W
          </text>
          <text x="${dipX.toFixed(1)}" y="${Math.min(yBot - 8, yOut + 52).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#ef4444">无 100nF 贴脚时瞬态深跌</text>

          <text x="${x0}" y="222" font-size="10.5" fill="var(--accent)">━ Vin 直流输入</text>
          <text x="${x0 + 130}" y="222" font-size="10.5" fill="#10b981">━ Vout (10μF + 100nF 贴脚稳压)</text>
          <text x="${x0 + 360}" y="222" font-size="10.5" fill="#ef4444">┅ 缺退耦瞬态掉压风险</text>
        `;
        return;
      }

      // Switching topologies: 2-channel scope (Top: V_SW square wave, Bottom: I_L triangle wave + I_sat)
      const cycles = 3;
      const cycleW = w / cycles;
      const d = clamp(m.duty, 0.06, 0.94);

      // Channel 1: V_SW (y: 22..90)
      const swTop = 26;
      const swBot = 88;
      let swPts = [];
      for (let c = 0; c < cycles; c++) {
        const cx0 = x0 + c * cycleW;
        const cxOn = cx0 + d * cycleW;
        const cx1 = cx0 + cycleW;
        // For Boost, Q1 ON pulls SW to 0V, Q1 OFF rises SW to Vout
        const yTon = s.topo === 'boost' || (s.topo === 'buckboost' && m.subMode === 'boost') ? swBot : swTop;
        const yToff = s.topo === 'boost' || (s.topo === 'buckboost' && m.subMode === 'boost') ? swTop : swBot;
        if (c === 0) swPts.push(`M ${cx0.toFixed(1)} ${yTon}`);
        else swPts.push(`L ${cx0.toFixed(1)} ${yTon}`);
        swPts.push(`L ${cxOn.toFixed(1)} ${yTon}`);
        swPts.push(`L ${cxOn.toFixed(1)} ${yToff}`);
        swPts.push(`L ${cx1.toFixed(1)} ${yToff}`);
      }

      // Channel 2: I_L (y: 112..200)
      const ilTop = 114;
      const ilBot = 198;
      const iScaleMax = Math.max(m.iSatRec * 1.15, 1.0);
      const yFromI = (val) => ilBot - (clamp(val, 0, iScaleMax) / iScaleMax) * (ilBot - ilTop);
      const yPeak = yFromI(m.iLPeak);
      const yVal = yFromI(m.iLValley);
      const yAvg = yFromI(m.iLAvg);
      const ySat = yFromI(m.iSatRec);

      let ilPts = [];
      for (let c = 0; c < cycles; c++) {
        const cx0 = x0 + c * cycleW;
        const cxOn = cx0 + d * cycleW;
        const cx1 = cx0 + cycleW;
        if (c === 0) ilPts.push(`M ${cx0.toFixed(1)} ${yVal.toFixed(1)}`);
        ilPts.push(`L ${cxOn.toFixed(1)} ${yPeak.toFixed(1)}`);
        ilPts.push(`L ${cx1.toFixed(1)} ${yVal.toFixed(1)}`);
      }

      // Active phase highlight band in Cycle 1
      const hlX = s.phase === 1 ? x0 : x0 + d * cycleW;
      const hlW = s.phase === 1 ? d * cycleW : (1 - d) * cycleW;
      const hlColor = s.phase === 1 ? 'rgba(0, 122, 255, 0.12)' : 'rgba(245, 158, 11, 0.14)';

      svg.innerHTML = `
        <!-- Grids -->
        <rect x="${x0}" y="20" width="${w}" height="74" rx="5" fill="var(--alt-bg)" stroke="var(--line)" stroke-width="1"/>
        <rect x="${x0}" y="108" width="${w}" height="94" rx="5" fill="var(--alt-bg)" stroke="var(--line)" stroke-width="1"/>
        <!-- Phase highlight band -->
        <rect x="${hlX.toFixed(1)}" y="20" width="${hlW.toFixed(1)}" height="182" fill="${hlColor}"/>
        <text x="${(hlX + hlW / 2).toFixed(1)}" y="15" text-anchor="middle" font-size="10" font-weight="750" fill="${s.phase === 1 ? 'var(--accent-dark)' : 'var(--warm)'}">${s.phase === 1 ? 'Ton 拍①' : 'Toff 拍②'}</text>

        <!-- CH1 V_SW -->
        <path d="${swPts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
        <text x="${x0 - 8}" y="31" text-anchor="end" font-size="10" font-weight="700" fill="var(--accent-dark)">${m.vSwHigh.toFixed(1)}V</text>
        <text x="${x0 - 8}" y="89" text-anchor="end" font-size="10" fill="var(--muted)">0V</text>
        <text x="${x1}" y="15" text-anchor="end" font-size="10" font-weight="700" fill="var(--accent-dark)">V_SW · D = ${(d * 100).toFixed(1)}% · ${s.fswKhz} kHz</text>

        <!-- CH2 I_L -->
        <line x1="${x0}" y1="${ySat.toFixed(1)}" x2="${x1}" y2="${ySat.toFixed(1)}" stroke="#ef4444" stroke-width="1.3" stroke-dasharray="5 3"/>
        <text x="${x1 - 6}" y="${Math.max(120, ySat - 4).toFixed(1)}" text-anchor="end" font-size="10" font-weight="750" fill="#ef4444">推荐 I_sat ≥ ${m.iSatRec.toFixed(2)} A (1.3×)</text>

        <line x1="${x0}" y1="${yAvg.toFixed(1)}" x2="${x1}" y2="${yAvg.toFixed(1)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>
        <path d="${ilPts.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linejoin="round"/>

        <text x="${x0 - 8}" y="${Math.max(120, yPeak + 3).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="#10b981">${m.iLPeak.toFixed(2)}A</text>
        <text x="${x0 - 8}" y="${ilBot}" text-anchor="end" font-size="10" fill="var(--muted)">0A</text>

        <text x="${x0}" y="222" font-size="10.5" fill="var(--accent)">━ V_SW 开关节点方波</text>
        <text x="${x0 + 165}" y="222" font-size="10.5" fill="#10b981">━ I_L 电感电流 (ΔI_L ≈ ${m.deltaIL.toFixed(2)} A)</text>
        <text x="${x0 + 425}" y="222" font-size="10.5" fill="#ef4444">┅ 1.3× I_sat 饱和红线</text>
      `;
    }

    function render() {
      setText('#pwr-val-vin', `${state.vin.toFixed(1)} V`);
      setText('#pwr-val-vout', `${state.vout.toFixed(1)} V`);
      setText('#pwr-val-iload', `${state.iload.toFixed(2)} A`);
      setText('#pwr-val-ind', state.topo === 'ldo' ? '无需电感' : `${state.indUh.toFixed(1)} μH`);
      setText('#pwr-val-fsw', state.topo === 'ldo' ? '纯直流 (无开关)' : `${state.fswKhz} kHz`);

      const isLdo = state.topo === 'ldo';
      if (elInd) elInd.disabled = isLdo;
      if (elFsw) elFsw.disabled = isLdo;
      if (fieldInd) fieldInd.classList.toggle('is-disabled', isLdo);
      if (fieldFsw) fieldFsw.classList.toggle('is-disabled', isLdo);

      // Update phase button labels for LDO vs switching
      const p1Btn = root.querySelector('.pwr-phase-btn[data-phase="1"]');
      const p2Btn = root.querySelector('.pwr-phase-btn[data-phase="2"]');
      if (p1Btn && p2Btn) {
        if (isLdo) {
          p1Btn.textContent = '稳态压差视图';
          p2Btn.textContent = '瞬态退耦视图';
        } else if (state.topo === 'buckboost') {
          p1Btn.textContent = '拍① 舀水/充能';
          p2Btn.textContent = '拍② 倒水/释能';
        } else {
          p1Btn.textContent = '拍① 充能 (Ton)';
          p2Btn.textContent = '拍② 释能 (Toff)';
        }
      }

      const m = computeModel(state);

      // Stats
      let modeLabel = '';
      if (state.topo === 'ldo') {
        modeLabel = m.valid
          ? `LDO 稳压 · ΔV = ${(state.vin - state.vout).toFixed(2)} V`
          : `⚠️ 压差不足 (掉出稳压区)`;
      } else if (state.topo === 'buck') {
        modeLabel = m.valid
          ? `Buck ${m.dcmRisk ? 'DCM' : 'CCM'} · D = ${(m.duty * 100).toFixed(1)}%`
          : `⚠️ Vin 需高于 Vout`;
      } else if (state.topo === 'boost') {
        modeLabel = m.valid
          ? `Boost ${m.dcmRisk ? 'DCM' : 'CCM'} · D = ${(m.duty * 100).toFixed(1)}%`
          : `⚠️ Vin 过高直通失稳`;
      } else {
        const subName = m.subMode === 'buck' ? '自动 Buck 区' : m.subMode === 'boost' ? '自动 Boost 区' : '水桶拐点过渡区';
        modeLabel = `${subName} · D = ${(m.duty * 100).toFixed(1)}%`;
      }

      setText('#pwr-stat-mode', modeLabel);
      setText('#pwr-stat-iin', `${m.iInAvg.toFixed(2)} A · η ${(m.eta * 100).toFixed(1)}%`);
      setText('#pwr-stat-loss', `${m.pLoss.toFixed(2)} W (${m.thermalRisk === 'danger' ? '过热告警' : m.thermalRisk === 'warn' ? '明显发热' : '微温'})`);
      setText(
        '#pwr-stat-peak',
        isLdo
          ? `推荐 10 μF + 100 nF 贴脚`
          : `${m.iLPeak.toFixed(2)} A / ≥ ${m.iSatRec.toFixed(2)} A`
      );

      const lossEl = root.querySelector('#pwr-stat-loss');
      if (lossEl) {
        lossEl.className = `aiw-stat-value ${m.thermalRisk === 'danger' ? 'pwr-val-danger' : m.thermalRisk === 'warn' ? 'warn' : 'pwr-val-ok'}`;
      }
      const modeEl = root.querySelector('#pwr-stat-mode');
      if (modeEl) {
        modeEl.className = `aiw-stat-value ${!m.valid ? 'pwr-val-danger' : 'accent'}`;
      }

      setText(
        '#pwr-scope-heading',
        isLdo
          ? '压差热耗剖面与退耦对比'
          : '双通道示波器：V_SW 与 I_L'
      );
      setText(
        '#pwr-scope-hint',
        isLdo
          ? '红区=压差热耗 · 绿=贴脚退耦 · 红虚线=缺退耦掉压'
          : '蓝=V_SW 方波 · 绿=I_L 三角波 · 红虚线=1.3× I_sat 下限'
      );

      // Diagnostic box
      const diagEl = root.querySelector('#pwr-diag-box');
      if (diagEl) {
        let cls = 'is-ok';
        let msg = '';

        if (m.faultType === 'ldo-dropout') {
          cls = 'is-danger';
          msg = `【LDO 压差不足（Dropout）】按当前「${m.gradeObj.ldoLabel}」最小压差 ${m.gradeObj.vDrop.toFixed(2)} V 计算，输出 ${state.vout.toFixed(1)} V 至少需要 Vin ≥ ${(state.vout + m.gradeObj.vDrop).toFixed(2)} V。当前 Vin = ${state.vin.toFixed(1)} V 已经掉出稳压区，实际输出跌至约 ${m.vOutActual.toFixed(2)} V；请提高输入电压、换超低压差 LDO 或改用四开关 Buck-Boost。`;
        } else if (m.faultType === 'buck-under') {
          cls = 'is-danger';
          msg = `【Buck 只能降压不能升压】当前 Vin (${state.vin.toFixed(1)} V) 不高于目标 Vout (${state.vout.toFixed(1)} V)，Buck 无法维持目标输出。若输入范围横跨输出电压（例如单节锂电稳 3.3 V），请切换到「Buck-Boost 四开关」。`;
        } else if (m.faultType === 'boost-over') {
          cls = 'is-danger';
          msg = `【Boost 无法降压且存在直通风险】当前 Vin (${state.vin.toFixed(1)} V) ≥ 目标 Vout (${state.vout.toFixed(1)} V)。普通 Boost 即使彻底关死 Q1，输入仍会经电感与二极管直通到输出端（约 ${m.vOutActual.toFixed(2)} V），无法向下稳压。需要降压请换 Buck，需跨压请换四开关 Buck-Boost。`;
        } else if (state.topo === 'ldo' && m.thermalRisk === 'danger') {
          cls = 'is-danger';
          msg = `【LDO 严重过热 (${m.pLoss.toFixed(2)} W)】输入 ${state.vin.toFixed(1)} V 与输出 ${state.vout.toFixed(1)} V 之间 ${(state.vin - state.vout).toFixed(1)} V 压差全由调整管硬磨，转换效率仅 ${(m.eta * 100).toFixed(1)}%，远超 SOT-223 / SOT-23 常规无散热片承受上限，极易数秒触发热关断。点击上方切换到「Buck 开关降压」，对比同一工况下热耗骤降！`;
        } else if (state.topo === 'ldo' && m.thermalRisk === 'warn') {
          cls = 'is-warn';
          msg = `【LDO 温升偏高 (${m.pLoss.toFixed(2)} W)】压差 ${(state.vin - state.vout).toFixed(1)} V × ${state.iload.toFixed(2)} A 带来明显发热，务必保证大面积散热敷铜或评估前级 Buck 降压；同时在负载引脚旁紧贴放置 10 μF + 100 nF 退耦组合。`;
        } else if (state.topo === 'boost') {
          cls = m.iLPeak >= 2.0 ? 'is-warn' : 'is-ok';
          msg = `【Boost 升压能量账本】输出 ${state.vout.toFixed(1)} V / ${state.iload.toFixed(2)} A（${m.pOut.toFixed(2)} W），按 ${(m.eta * 100).toFixed(0)}% 效率输入侧平均需抽 ${m.iInAvg.toFixed(2)} A，电感峰值电流达 ${m.iLPeak.toFixed(2)} A。画板避坑：① 电感饱和电流 I_sat 至少选 ≥ ${m.iSatRec.toFixed(2)} A（绝不能按输出 ${state.iload.toFixed(2)} A 选）；② 电池供电务必确认芯片支持 True Shutdown 真关断防止关机直通漏电。`;
        } else if (state.topo === 'buckboost' && m.subMode === 'bb-bucket') {
          cls = 'is-ok';
          msg = `【进入四开关拐点水桶过渡区】当前 Vin (${state.vin.toFixed(1)} V) 紧贴 Vout (${state.vout.toFixed(1)} V)，直接硬切 Buck/Boost 会导致输出剧烈抖动。芯片启用四管水桶两拍（拍① Q1+Q4 舀水充磁隔离输出 → 拍② Q2+Q3 倒水反转推电），占空比 D = ${(m.duty * 100).toFixed(1)}% 平滑跨过拐点，推荐电感 I_sat ≥ ${m.iSatRec.toFixed(2)} A。`;
        } else if (m.dcmRisk) {
          cls = 'is-warn';
          msg = `【电感纹波偏大 / 进入断续模式 DCM】当前电感纹波 ΔI_L ≈ ${m.deltaIL.toFixed(2)} A 超过平均电感电流的两倍，峰值电流抬升至 ${m.iLPeak.toFixed(2)} A。如需压低电流纹波与 EMI，可适当增大电感感值 L（当前 ${state.indUh.toFixed(1)} μH）或提高开关频率 f_sw（当前 ${state.fswKhz} kHz）。`;
        } else if (state.topo === 'ldo') {
          cls = 'is-ok';
          msg = `【LDO 舒适区】压差 ${(state.vin - state.vout).toFixed(1)} V、热耗仅 ${m.pLoss.toFixed(2)} W，无开关纹波且外围极简，非常适合给 MCU、高精度 ADC 或模拟前端供电；注意把 100 nF 电容紧贴芯片 VDD/GND 引脚，先过电容焊盘再进引脚。`;
        } else {
          cls = 'is-ok';
          msg = `【${state.topo === 'buck' ? 'Buck 高效降压' : '四开关自动模式'}】输出 ${m.pOut.toFixed(2)} W 仅从输入端平均抽电 ${m.iInAvg.toFixed(2)} A，估算总损耗 ${m.pLoss.toFixed(2)} W（对比同工况 LDO 需烧掉 ${Math.max(0, (state.vin - state.vout) * state.iload).toFixed(2)} W）。电感纹波 ΔI_L ≈ ${m.deltaIL.toFixed(2)} A，峰值 ${m.iLPeak.toFixed(2)} A，推荐电感 I_sat ≥ ${m.iSatRec.toFixed(2)} A。`;
        }

        diagEl.className = `pwr-diag-box ${cls}`;
        diagEl.textContent = msg;
      }

      renderTopoSvg(state, m);
      renderScopeSvg(state, m);
    }

    function syncControls() {
      if (elVin) elVin.value = state.vin.toFixed(1);
      if (elVout) elVout.value = state.vout.toFixed(1);
      if (elIload) elIload.value = state.iload.toFixed(2);
      if (elInd) elInd.value = state.indUh.toFixed(1);
      if (elFsw) elFsw.value = String(state.fswKhz);
      if (elGrade) elGrade.value = state.grade;

      topoBtns.forEach((btn) => {
        const active = btn.getAttribute('data-topo') === state.topo;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });

      phaseBtns.forEach((btn) => {
        const active = Number(btn.getAttribute('data-phase')) === state.phase;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      if (autoBtn) {
        autoBtn.classList.toggle('is-active', state.autoPlay);
        autoBtn.setAttribute('aria-pressed', state.autoPlay ? 'true' : 'false');
        autoBtn.textContent = state.autoPlay ? '暂停慢放' : '慢放循环';
      }
    }

    function stopAuto() {
      state.autoPlay = false;
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    }

    function bindRange(el, key) {
      el?.addEventListener('input', () => {
        state[key] = parseFloat(el.value);
        render();
      });
    }

    bindRange(elVin, 'vin');
    bindRange(elVout, 'vout');
    bindRange(elIload, 'iload');
    bindRange(elInd, 'indUh');
    bindRange(elFsw, 'fswKhz');

    elGrade?.addEventListener('change', () => {
      state.grade = elGrade.value;
      render();
    });

    topoBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-topo');
        if (!val) return;
        state.topo = val;
        syncControls();
        render();
      });
    });

    phaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        stopAuto();
        state.phase = Number(btn.getAttribute('data-phase')) === 2 ? 2 : 1;
        syncControls();
        render();
      });
    });

    autoBtn?.addEventListener('click', () => {
      if (state.autoPlay) {
        stopAuto();
      } else {
        state.autoPlay = true;
        autoTimer = setInterval(() => {
          state.phase = state.phase === 1 ? 2 : 1;
          syncControls();
          render();
        }, 1400);
      }
      syncControls();
    });

    const presets = {
      'ldo-hot': { topo: 'ldo', phase: 1, vin: 12.0, vout: 3.3, iload: 1.0, indUh: 10.0, fswKhz: 500, grade: 'async82' },
      'buck-cool': { topo: 'buck', phase: 1, vin: 12.0, vout: 3.3, iload: 1.0, indUh: 10.0, fswKhz: 500, grade: 'sync90' },
      'boost-5v': { topo: 'boost', phase: 2, vin: 3.7, vout: 5.0, iload: 1.0, indUh: 4.7, fswKhz: 600, grade: 'sync90' },
      'bb-cross': { topo: 'buckboost', phase: 1, vin: 3.3, vout: 3.3, iload: 0.8, indUh: 4.7, fswKhz: 1000, grade: 'sync90' },
      'bb-low': { topo: 'buckboost', phase: 2, vin: 3.0, vout: 3.3, iload: 0.8, indUh: 4.7, fswKhz: 1000, grade: 'sync90' },
    };

    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        const p = presets[key];
        if (!p) return;
        stopAuto();
        Object.assign(state, p);
        syncControls();
        render();
      });
    });

    syncControls();
    render();
  }

  try {
    initPowerTopoLab();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initPowerTopoLab', err);
  }
})();
