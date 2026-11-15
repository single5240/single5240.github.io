(() => {
  function initFontSimulator() {
    const root = document.getElementById('font-demo-app');
    if (!root) return;

    // Tab switching
    const tabBtns = root.querySelectorAll('.font-tab-btn');
    const tabPanels = root.querySelectorAll('.font-tab-panel');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.toggle('active', b === btn));
        tabPanels.forEach(p => p.classList.toggle('active', p.id === 'font-panel-' + target));
        if (target === 'compare') renderCompare();
      });
    });

    // --- Tab 1: Editor & Generator ---
    const grid16 = root.querySelector('#font-grid-16');
    const previewCanvas = root.querySelector('#font-preview-canvas');
    const codePre = root.querySelector('#font-c-code');
    const infoBytes = root.querySelector('#font-byte-count');
    const infoDims = root.querySelector('#font-dim-label');

    let currentWidth = 16;
    const grid = Array.from({ length: 16 }, () => Array(16).fill(0));
    let isMouseDown = false;
    let drawValue = 1;

    // Presets
    const presets = {
      gui: [
        0x00,0x00, 0x7F,0xFC, 0x44,0x44, 0x5F,0xF4,
        0x44,0x44, 0x7F,0xFC, 0x04,0x40, 0xFF,0xFE,
        0x44,0x44, 0x47,0xC4, 0x44,0x44, 0x7F,0xFC,
        0x44,0x44, 0x44,0x44, 0x44,0x44, 0x00,0x00
      ],
      duan: [
        0x00,0x00, 0x24,0x48, 0x24,0x88, 0x7F,0xFC,
        0x24,0x08, 0x24,0x10, 0x7F,0xFE, 0x00,0x10,
        0x3E,0x10, 0x22,0x20, 0x22,0x20, 0x22,0x40,
        0x3E,0x40, 0x22,0x84, 0x22,0x78, 0x00,0x00
      ],
      he: [
        0x08,0x20, 0x7F,0xFC, 0x08,0x20, 0x00,0x00,
        0x3F,0xF8, 0x01,0x00, 0x01,0x00, 0x01,0x00,
        0x3F,0xF8, 0x21,0x08, 0x21,0x08, 0x3F,0xF8,
        0x21,0x08, 0x21,0x08, 0x21,0x08, 0x00,0x00
      ],
      asciiA: [
        0x00, 0x00, 0x18, 0x24, 0x42, 0x42, 0x7E, 0x42,
        0x42, 0x42, 0x42, 0x00, 0x00, 0x00, 0x00, 0x00
      ],
      ascii0: [
        0x00, 0x00, 0x3C, 0x42, 0x46, 0x4A, 0x52, 0x62,
        0x42, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
      ]
    };

    function loadPreset(key) {
      const data = presets[key];
      if (!data) return;
      if (key.startsWith('ascii')) {
        currentWidth = 8;
        if (infoDims) infoDims.textContent = '8 × 16 (ASCII)';
        if (infoBytes) infoBytes.textContent = '16 字节 (stride=1 B/行)';
        for (let y = 0; y < 16; y++) {
          const byte = data[y];
          for (let x = 0; x < 8; x++) {
            grid[y][x] = (byte & (0x80 >> x)) ? 1 : 0;
          }
          for (let x = 8; x < 16; x++) grid[y][x] = 0;
        }
      } else {
        currentWidth = 16;
        if (infoDims) infoDims.textContent = '16 × 16 (汉字)';
        if (infoBytes) infoBytes.textContent = '32 字节 (stride=2 B/行)';
        for (let y = 0; y < 16; y++) {
          const b0 = data[y * 2];
          const b1 = data[y * 2 + 1];
          for (let x = 0; x < 8; x++) grid[y][x] = (b0 & (0x80 >> x)) ? 1 : 0;
          for (let x = 0; x < 8; x++) grid[y][x + 8] = (b1 & (0x80 >> x)) ? 1 : 0;
        }
      }
      renderEditor();
    }

    function renderEditor() {
      if (!grid16) return;
      grid16.innerHTML = '';
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const pixel = document.createElement('div');
          pixel.className = 'font-pixel' + (grid[y][x] ? ' on' : '');
          if (x >= currentWidth) {
            pixel.style.opacity = '0.2';
            pixel.style.pointerEvents = 'none';
          }
          pixel.dataset.x = x;
          pixel.dataset.y = y;
          pixel.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isMouseDown = true;
            drawValue = grid[y][x] ? 0 : 1;
            grid[y][x] = drawValue;
            pixel.classList.toggle('on', drawValue === 1);
            updateOutput();
          });
          pixel.addEventListener('mouseenter', () => {
            if (isMouseDown) {
              grid[y][x] = drawValue;
              pixel.classList.toggle('on', drawValue === 1);
              updateOutput();
            }
          });
          grid16.appendChild(pixel);
        }
      }
      updateOutput();
    }

    document.addEventListener('mouseup', () => { isMouseDown = false; });

    function updateOutput() {
      if (previewCanvas) {
        const ctx = previewCanvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#10b981';
        const scale = 32 / 16;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < currentWidth; x++) {
            if (grid[y][x]) {
              ctx.fillRect(x * scale, y * scale, scale, scale);
            }
          }
        }
      }

      const stride = Math.floor((currentWidth + 7) / 8);
      const totalBytes = stride * 16;
      if (infoBytes) infoBytes.textContent = totalBytes + ' 字节 (stride=' + stride + ' B/行)';

      const bytes = [];
      for (let y = 0; y < 16; y++) {
        for (let s = 0; s < stride; s++) {
          let byteVal = 0;
          for (let b = 0; b < 8; b++) {
            const x = s * 8 + b;
            if (x < currentWidth && grid[y][x]) {
              byteVal |= (0x80 >> b);
            }
          }
          bytes.push('0x' + byteVal.toString(16).padStart(2, '0').toUpperCase());
        }
      }

      let cCode = '/* 1-bit Bitmap: ' + currentWidth + 'x16 (' + totalBytes + ' Bytes, Row-major MSB leftmost) */\n';
      cCode += 'const uint8_t glyph_bitmap[' + totalBytes + '] = {\n';
      for (let y = 0; y < 16; y++) {
        cCode += '  ';
        for (let s = 0; s < stride; s++) {
          cCode += bytes[y * stride + s] + ', ';
        }
        cCode += '/* Row ' + y.toString().padStart(2, ' ') + ' */\n';
      }
      cCode += '};';
      if (codePre) codePre.textContent = cCode;
    }

    root.querySelector('#font-preset-gui')?.addEventListener('click', () => loadPreset('gui'));
    root.querySelector('#font-preset-duan')?.addEventListener('click', () => loadPreset('duan'));
    root.querySelector('#font-preset-he')?.addEventListener('click', () => loadPreset('he'));
    root.querySelector('#font-preset-a')?.addEventListener('click', () => loadPreset('asciiA'));
    root.querySelector('#font-preset-0')?.addEventListener('click', () => loadPreset('ascii0'));
    root.querySelector('#font-btn-clear')?.addEventListener('click', () => {
      for (let y = 0; y < 16; y++) grid[y].fill(0);
      renderEditor();
    });
    root.querySelector('#font-btn-invert')?.addEventListener('click', () => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < currentWidth; x++) {
          grid[y][x] = grid[y][x] ? 0 : 1;
        }
      }
      renderEditor();
    });

    // --- Tab 2: Comparison (Vector Threshold vs Native Bitmap) ---
    const zoomVector = root.querySelector('#font-zoom-vector');
    const zoomNative = root.querySelector('#font-zoom-native');
    const threshSlider = root.querySelector('#font-thresh-slider');
    const threshVal = root.querySelector('#font-thresh-val');
    let compareChar = '歸';

    root.querySelectorAll('.font-compare-preset-btn').forEach(b => {
      b.addEventListener('click', () => {
        compareChar = b.dataset.char;
        root.querySelectorAll('.font-compare-preset-btn').forEach(btn => btn.classList.toggle('active', btn === b));
        renderCompare();
      });
    });

    if (threshSlider) {
      threshSlider.addEventListener('input', () => {
        if (threshVal) threshVal.textContent = threshSlider.value;
        renderCompare();
      });
    }

    function renderCompare() {
      if (!zoomVector || !zoomNative) return;
      const th = parseInt(threshSlider ? threshSlider.value : '128', 10);

      const offCanvas = document.createElement('canvas');
      offCanvas.width = 16;
      offCanvas.height = 16;
      const offCtx = offCanvas.getContext('2d');
      offCtx.fillStyle = '#FFFFFF';
      offCtx.fillRect(0, 0, 16, 16);
      offCtx.fillStyle = '#000000';
      offCtx.font = '15px "SimSun", "Songti SC", "Noto Serif CJK TC", serif';
      offCtx.textAlign = 'center';
      offCtx.textBaseline = 'middle';
      offCtx.fillText(compareChar, 8, 8);

      const imgData = offCtx.getImageData(0, 0, 16, 16);
      const data = imgData.data;

      const vCtx = zoomVector.getContext('2d');
      vCtx.imageSmoothingEnabled = false;
      vCtx.fillStyle = '#111';
      vCtx.fillRect(0, 0, 128, 128);

      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const idx = (y * 16 + x) * 4;
          const gray = (data[idx] + data[idx+1] + data[idx+2]) / 3;
          if (gray < th) {
            vCtx.fillStyle = '#ef4444';
            vCtx.fillRect(x * 8, y * 8, 7, 7);
          }
        }
      }

      const nCtx = zoomNative.getContext('2d');
      nCtx.imageSmoothingEnabled = false;
      nCtx.fillStyle = '#111';
      nCtx.fillRect(0, 0, 128, 128);
      nCtx.fillStyle = '#10b981';

      const presetData = compareChar === '斷' ? presets.duan : presets.gui;
      for (let y = 0; y < 16; y++) {
        const b0 = presetData[y * 2];
        const b1 = presetData[y * 2 + 1];
        for (let x = 0; x < 8; x++) {
          if (b0 & (0x80 >> x)) nCtx.fillRect(x * 8, y * 8, 7, 7);
        }
        for (let x = 0; x < 8; x++) {
          if (b1 & (0x80 >> x)) nCtx.fillRect((x + 8) * 8, y * 8, 7, 7);
        }
      }
    }

    // --- Tab 3: Unicode Binary Search Step-by-Step ---
    const codepoints = [
      { cp: 0x0020, ch: "' '" }, { cp: 0x002B, ch: "'+'" }, { cp: 0x0030, ch: "'0'" },
      { cp: 0x0039, ch: "'9'" }, { cp: 0x0041, ch: "'A'" }, { cp: 0x005A, ch: "'Z'" },
      { cp: 0x0061, ch: "'a'" }, { cp: 0x007E, ch: "'~'" }, { cp: 0x00B1, ch: "'±'" },
      { cp: 0x4E00, ch: "'一'" }, { cp: 0x505C, ch: "'停'" }, { cp: 0x514B, ch: "'克'" },
      { cp: 0x5206, ch: "'分'" }, { cp: 0x529F, ch: "'功'" }, { cp: 0x538B, ch: "'压'" },
      { cp: 0x65AD, ch: "'斷'" }, { cp: 0x6E05, ch: "'清'" }, { cp: 0x6E29, ch: "'温'" },
      { cp: 0x7247, ch: "'片'" }, { cp: 0x7535, ch: "'电'" }, { cp: 0x8377, ch: "'荷'" },
      { cp: 0x8B70, ch: "'議'" }, { cp: 0x8F93, ch: "'输'" }, { cp: 0x904B, ch: "'運'" },
      { cp: 0x91CF, ch: "'量'" }, { cp: 0x95F8, ch: "'闸'" }, { cp: 0x9B41, ch: "'魁'" },
      { cp: 0x9ED1, ch: "'黑'" }
    ];

    const barEl = root.querySelector('#font-bsearch-bar');
    const logEl = root.querySelector('#font-bsearch-log');
    const searchInput = root.querySelector('#font-bsearch-input');
    const stepBtn = root.querySelector('#font-bsearch-step-btn');
    const resetBtn = root.querySelector('#font-bsearch-reset-btn');

    let bLow = 0;
    let bHigh = codepoints.length - 1;
    let bMid = -1;
    let bTarget = 0x8377;
    let bStepCount = 0;
    let bDone = false;

    function renderBsearchBar() {
      if (!barEl) return;
      barEl.innerHTML = '';
      codepoints.forEach((item, idx) => {
        const cell = document.createElement('div');
        cell.className = 'font-bsearch-cell';
        cell.title = 'Index ' + idx + ': ' + item.ch + ' (0x' + item.cp.toString(16).toUpperCase() + ')';

        if (bDone && idx === bMid && codepoints[idx].cp === bTarget) {
          cell.classList.add('found');
        } else if (idx === bMid) {
          cell.classList.add('mid');
        } else if (idx >= bLow && idx <= bHigh) {
          cell.classList.add('active-range');
        } else {
          cell.classList.add('eliminated');
        }

        cell.addEventListener('click', () => {
          if (searchInput) searchInput.value = item.ch.replace(/'/g, '');
          bTarget = item.cp;
          resetBsearch();
        });
        barEl.appendChild(cell);
      });
    }

    function resetBsearch() {
      bLow = 0;
      bHigh = codepoints.length - 1;
      bMid = -1;
      bStepCount = 0;
      bDone = false;
      const foundItem = codepoints.find(c => c.cp === bTarget);
      if (logEl) {
        logEl.innerHTML = '目标: 0x' + bTarget.toString(16).toUpperCase() + ' (' + (foundItem ? foundItem.ch : '自定义') + ')<br>初始范围: low=0, high=' + bHigh + ' (N=' + codepoints.length + ')';
      }
      if (stepBtn) stepBtn.disabled = false;
      renderBsearchBar();
    }

    function stepBsearch() {
      if (bDone || bLow > bHigh) return;
      bStepCount++;
      bMid = Math.floor((bLow + bHigh) / 2);
      const cur = codepoints[bMid];

      let logMsg = '第 ' + bStepCount + ' 步: low=' + bLow + ', high=' + bHigh + ' ➔ mid=' + bMid + ' [' + cur.ch + ' 0x' + cur.cp.toString(16).toUpperCase() + ']<br>';

      if (cur.cp === bTarget) {
        logMsg += '<span style="color:#10b981;font-weight:bold;">➔ 命中目标！共比较 ' + bStepCount + ' 次，直接提取 font_16_bitmap + offset</span>';
        bDone = true;
        if (stepBtn) stepBtn.disabled = true;
      } else if (cur.cp < bTarget) {
        logMsg += '➔ 0x' + cur.cp.toString(16).toUpperCase() + ' < 目标 0x' + bTarget.toString(16).toUpperCase() + '，向右收缩：low = ' + (bMid + 1);
        bLow = bMid + 1;
      } else {
        logMsg += '➔ 0x' + cur.cp.toString(16).toUpperCase() + ' > 目标 0x' + bTarget.toString(16).toUpperCase() + '，向左收缩：high = ' + (bMid - 1);
        bHigh = bMid - 1;
      }

      if (!bDone && bLow > bHigh) {
        logMsg += '<br><span style="color:#ef4444;font-weight:bold;">➔ 查找结束：未收录字符（返回 NULL，安全回退到空白或替换字形）</span>';
        bDone = true;
        if (stepBtn) stepBtn.disabled = true;
      }

      if (logEl) logEl.innerHTML = logMsg;
      renderBsearchBar();
    }

    if (stepBtn) stepBtn.addEventListener('click', stepBsearch);
    if (resetBtn) resetBtn.addEventListener('click', resetBsearch);
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (!val) return;
        let code = 0;
        if (/^0x[0-9a-fA-F]+$/i.test(val)) {
          code = parseInt(val.slice(2), 16);
        } else if (/^U\+[0-9a-fA-F]+$/i.test(val)) {
          code = parseInt(val.slice(2), 16);
        } else if (/^[0-9a-fA-F]{4}$/i.test(val)) {
          code = parseInt(val, 16);
        } else {
          code = val.charCodeAt(0);
        }
        if (!isNaN(code) && code > 0) {
          bTarget = code;
          resetBsearch();
        }
      });
    }

    loadPreset('gui');
    resetBsearch();
  }

  try {
    initFontSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initFontSimulator', err);
  }
})();
