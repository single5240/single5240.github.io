(() => {
  function initRgb565Simulator() {
    const root = document.getElementById('rgb-demo-app');
    if (!root) return;

    let baseR = 248;
    let baseG = 0;
    let baseB = 0;

    let flagInvert = false;
    let flagSwapChannels = false;
    let flagByteSwap = false;

    const elSwatchExpected = root.querySelector('#rgb-swatch-expected');
    const elSwatchActual = root.querySelector('#rgb-swatch-actual');
    const elBitsExpected = root.querySelector('#rgb-bits-expected');
    const elBitsActual = root.querySelector('#rgb-bits-actual');
    const elHexExpected = root.querySelector('#rgb-hex-expected');
    const elHexActual = root.querySelector('#rgb-hex-actual');
    const elDiagText = root.querySelector('#rgb-diag-text');
    const elByte0 = root.querySelector('#rgb-byte-0');
    const elByte1 = root.querySelector('#rgb-byte-1');

    const chkInvert = root.querySelector('#rgb-chk-invert');
    const chkSwapChannels = root.querySelector('#rgb-chk-swap-channels');
    const chkByteSwap = root.querySelector('#rgb-chk-byte-swap');

    function update() {
      const r5 = (baseR >> 3) & 0x1F;
      const g6 = (baseG >> 2) & 0x3F;
      const b5 = (baseB >> 3) & 0x1F;
      const rawRgb565 = (r5 << 11) | (g6 << 5) | b5;

      const expR = Math.round(r5 * 255 / 31);
      const expG = Math.round(g6 * 255 / 63);
      const expB = Math.round(b5 * 255 / 31);
      const expColorStr = `rgb(${expR}, ${expG}, ${expB})`;

      if (elSwatchExpected) elSwatchExpected.style.backgroundColor = expColorStr;
      if (elHexExpected) elHexExpected.textContent = `0x${rawRgb565.toString(16).padStart(4, '0').toUpperCase()}`;
      if (elBitsExpected) {
        elBitsExpected.innerHTML = `
          <span class="rgb-bit-pill rgb-bit-r">R5: ${r5.toString(2).padStart(5, '0')}</span>
          <span class="rgb-bit-pill rgb-bit-g">G6: ${g6.toString(2).padStart(6, '0')}</span>
          <span class="rgb-bit-pill rgb-bit-b">B5: ${b5.toString(2).padStart(5, '0')}</span>
        `;
      }

      let procR5 = r5;
      let procG6 = g6;
      let procB5 = b5;
      if (flagSwapChannels) {
        const tmp = procR5;
        procR5 = procB5;
        procB5 = tmp;
      }
      let proc16 = (procR5 << 11) | (procG6 << 5) | procB5;

      if (flagInvert) {
        proc16 = (~proc16) & 0xFFFF;
      }

      let b0 = (proc16 >> 8) & 0xFF;
      let b1 = proc16 & 0xFF;

      if (flagByteSwap) {
        const tmp = b0;
        b0 = b1;
        b1 = tmp;
      }

      if (elByte0) elByte0.textContent = `0x${b0.toString(16).padStart(2, '0').toUpperCase()}`;
      if (elByte1) elByte1.textContent = `0x${b1.toString(16).padStart(2, '0').toUpperCase()}`;

      const final16 = (b0 << 8) | b1;
      const finalR5 = (final16 >> 11) & 0x1F;
      const finalG6 = (final16 >> 5) & 0x3F;
      const finalB5 = final16 & 0x1F;

      const actR = Math.round(finalR5 * 255 / 31);
      const actG = Math.round(finalG6 * 255 / 63);
      const actB = Math.round(finalB5 * 255 / 31);
      const actColorStr = `rgb(${actR}, ${actG}, ${actB})`;

      if (elSwatchActual) elSwatchActual.style.backgroundColor = actColorStr;
      if (elHexActual) elHexActual.textContent = `0x${final16.toString(16).padStart(4, '0').toUpperCase()}`;
      if (elBitsActual) {
        elBitsActual.innerHTML = `
          <span class="rgb-bit-pill rgb-bit-r">R5: ${finalR5.toString(2).padStart(5, '0')}</span>
          <span class="rgb-bit-pill rgb-bit-g">G6: ${finalG6.toString(2).padStart(6, '0')}</span>
          <span class="rgb-bit-pill rgb-bit-b">B5: ${finalB5.toString(2).padStart(5, '0')}</span>
        `;
      }

      let diag = '';
      if (!flagInvert && !flagSwapChannels && !flagByteSwap) {
        diag = '<strong>当前状态正常</strong>：无任何硬件故障注入，屏幕成像与理论预期完全一致。';
      } else {
        const reasons = [];
        if (flagInvert) reasons.push('显示反相（INVON/INVOFF 互斥命令发反，数值按位 ~color）');
        if (flagSwapChannels) reasons.push('MADCTL Bit 3 通道模式反向（RGB/BGR 翻转）');
        if (flagByteSwap) reasons.push('SPI DMA 高低字节传输错位（缺少 __REV16 字节翻转）');

        diag = `<strong>故障注入分析</strong>：注入了【${reasons.join(' + ')}】。<br>`;
        if (flagInvert) {
          diag += '• <strong>关键诊断特征</strong>：若绿色变成紫色、黑色变白色，<strong>100% 属于反相配置错误</strong>，因为通道对调绝不会影响居中的 G 通道。<br>';
        }
        if (flagSwapChannels) {
          diag += '• <strong>关键诊断特征</strong>：纯红与纯蓝互相变异，但纯绿色（0x07E0）保持正常。<br>';
        }
        if (flagByteSwap) {
          diag += '• <strong>关键诊断特征</strong>：图像出现断裂错序，纯红色(0xF800)经高低字节对调后变成极微弱的杂色(0x00F8)。';
        }
      }
      if (elDiagText) elDiagText.innerHTML = diag;
    }

    root.querySelectorAll('[data-rgb-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-rgb-preset');
        if (val === 'red') { baseR = 248; baseG = 0; baseB = 0; }
        else if (val === 'green') { baseR = 0; baseG = 252; baseB = 0; }
        else if (val === 'blue') { baseR = 0; baseG = 0; baseB = 248; }
        else if (val === 'white') { baseR = 255; baseG = 255; baseB = 255; }
        else if (val === 'yellow') { baseR = 255; baseG = 255; baseB = 0; }
        else if (val === 'cyan') { baseR = 0; baseG = 255; baseB = 255; }
        else if (val === 'magenta') { baseR = 255; baseG = 0; baseB = 255; }
        update();
      });
    });

    chkInvert?.addEventListener('change', (e) => { flagInvert = e.target.checked; update(); });
    chkSwapChannels?.addEventListener('change', (e) => { flagSwapChannels = e.target.checked; update(); });
    chkByteSwap?.addEventListener('change', (e) => { flagByteSwap = e.target.checked; update(); });

    root.querySelector('#rgb-btn-reset')?.addEventListener('click', () => {
      baseR = 248; baseG = 0; baseB = 0;
      flagInvert = false; flagSwapChannels = false; flagByteSwap = false;
      if (chkInvert) chkInvert.checked = false;
      if (chkSwapChannels) chkSwapChannels.checked = false;
      if (chkByteSwap) chkByteSwap.checked = false;
      update();
    });

    update();
  }

  try {
    initRgb565Simulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initRgb565Simulator', err);
  }
})();
