(() => {
  function initEepromSimulator() {
    const root = document.getElementById('eeprom-demo-app');
    if (!root) return;

    const eeprom = new Uint8Array(256);
    let activeSlot = 'A';
    let selectedAddr = 0x0E;
    const corruptedAddrs = new Set();
    const writtenAddrs = new Set();
    let version = 1;
    let seq = 100;
    let calibVal = 4520;

    function factoryInit() {
      eeprom.fill(0xFF);
      corruptedAddrs.clear();
      writtenAddrs.clear();
      activeSlot = 'A';
      version = 1;
      seq = 100;
      calibVal = 4520;

      eeprom[0x00] = 0x50; eeprom[0x01] = 0x41; eeprom[0x02] = 0x52; eeprom[0x03] = 0x41;
      eeprom[0x04] = version;
      eeprom[0x08] = seq & 0xFF; eeprom[0x09] = (seq >> 8) & 0xFF;
      eeprom[0x0E] = 0xAA; eeprom[0x0F] = 0xBB;
      eeprom[0x10] = 0xCC; eeprom[0x11] = 0xDD;
      eeprom[0x7E] = 0x4A; eeprom[0x7F] = 0x1B;

      eeprom[0x80] = 0x50; eeprom[0x81] = 0x41; eeprom[0x82] = 0x52; eeprom[0x83] = 0x41;
      eeprom[0x84] = version;
      eeprom[0x88] = seq & 0xFF; eeprom[0x89] = (seq >> 8) & 0xFF;
      eeprom[0xFE] = 0x4A; eeprom[0xFF] = 0x1B;
    }

    factoryInit();

    const elGrid = root.querySelector('#eeprom-grid');
    const elLog = root.querySelector('#eeprom-log');
    const elSlotBadgeA = root.querySelector('#eeprom-badge-slot-a');
    const elSlotBadgeB = root.querySelector('#eeprom-badge-slot-b');
    const elStatSlot = root.querySelector('#eeprom-stat-slot');
    const elStatCrc = root.querySelector('#eeprom-stat-crc');
    const elStatAddr = root.querySelector('#eeprom-stat-addr');
    const elStatPage = root.querySelector('#eeprom-stat-page');

    function log(msg, type = 'normal') {
      if (!elLog) return;
      const line = document.createElement('div');
      line.className = 'aiw-log-line';
      const now = new Date();
      const time = `[${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0')}]`;
      let styledMsg = msg;
      if (type === 'event') styledMsg = `<span class="aiw-log-event">${msg}</span>`;
      else if (type === 'success') styledMsg = `<span class="aiw-log-success">${msg}</span>`;
      else if (type === 'warn') styledMsg = `<span class="aiw-log-warn">${msg}</span>`;
      else if (type === 'error') styledMsg = `<span class="aiw-log-error">${msg}</span>`;
      line.innerHTML = `<span class="aiw-log-time">${time}</span> ${styledMsg}`;
      elLog.appendChild(line);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function updateInspector() {
      const isSlotA = selectedAddr < 128;
      const page = Math.floor(selectedAddr / 16);
      const val = eeprom[selectedAddr].toString(16).padStart(2, '0').toUpperCase();

      const activeStart = activeSlot === 'A' ? 0 : 128;
      const activeEnd = activeSlot === 'A' ? 128 : 256;
      let activeCorrupted = false;
      for (let a = activeStart; a < activeEnd; a++) {
        if (corruptedAddrs.has(a)) { activeCorrupted = true; break; }
      }

      if (elStatAddr) elStatAddr.textContent = `0x${selectedAddr.toString(16).padStart(2, '0').toUpperCase()} (值: 0x${val}, ${isSlotA ? 'Slot A' : 'Slot B'})`;
      if (elStatPage) elStatPage.textContent = `Page ${page} (页首: 0x${(page*16).toString(16).padStart(2, '0').toUpperCase()})`;
      if (elStatSlot) elStatSlot.textContent = `当前活动: Slot ${activeSlot} (${activeSlot === 'A' ? '0x00..0x7F' : '0x80..0xFF'})`;
      if (elStatCrc) elStatCrc.textContent = activeCorrupted ? '损坏 (校验失败)' : '0x4A1B (合法通过)';

      if (elSlotBadgeA) elSlotBadgeA.classList.toggle('active-indicator', activeSlot === 'A');
      if (elSlotBadgeB) elSlotBadgeB.classList.toggle('active-indicator', activeSlot === 'B');
    }

    function renderGrid() {
      if (!elGrid) return;
      elGrid.innerHTML = '';

      for (let page = 0; page < 16; page++) {
        const row = document.createElement('div');
        row.className = 'eeprom-row';

        const pageStart = page * 16;
        const pageLabel = document.createElement('div');
        pageLabel.className = 'eeprom-page-label';
        pageLabel.textContent = `P${page.toString(16).toUpperCase()} 0x${pageStart.toString(16).padStart(2, '0').toUpperCase()}:`;
        row.appendChild(pageLabel);

        for (let col = 0; col < 16; col++) {
          const addr = pageStart + col;
          const isSlotA = addr < 128;
          const cell = document.createElement('div');
          let cls = `eeprom-cell ${isSlotA ? 'is-slot-a' : 'is-slot-b'}`;
          if (addr === selectedAddr) cls += ' is-selected';
          if (corruptedAddrs.has(addr)) cls += ' is-corrupted';
          else if (writtenAddrs.has(addr)) cls += ' is-written';

          cell.className = cls;
          cell.textContent = eeprom[addr].toString(16).padStart(2, '0').toUpperCase();
          cell.title = `0x${addr.toString(16).padStart(2, '0').toUpperCase()}: 0x${cell.textContent} (${isSlotA ? 'Slot A' : 'Slot B'}, Page ${page})`;

          cell.addEventListener('click', () => {
            selectedAddr = addr;
            updateInspector();
            renderGrid();
          });

          row.appendChild(cell);
        }
        elGrid.appendChild(row);
      }

      updateInspector();
    }

    function writeRawWrapBug() {
      corruptedAddrs.clear();
      writtenAddrs.clear();
      const testBytes = [0x11, 0x22, 0x33, 0x44];
      const start = 0x0E;
      log(`[RAW WRITE START] 模拟单笔事务向 0x0E 连续写入 4 字节 [0x11, 0x22, 0x33, 0x44] (未做跨页拆分)...`, 'warn');

      const pageBase = Math.floor(start / 16) * 16;
      let offset = start % 16;

      for (let i = 0; i < testBytes.length; i++) {
        const targetAddr = pageBase + offset;
        eeprom[targetAddr] = testBytes[i];
        if (i >= 2) {
          corruptedAddrs.add(targetAddr);
        } else {
          writtenAddrs.add(targetAddr);
        }
        offset = (offset + 1) % 16;
      }

      renderGrid();
      log(`[HARDWARE WRAP-AROUND BUG!] 前 2 字节写入 0x0E..0x0F；后 2 字节因芯片内部仅低 4 位自增，回绕覆盖了本页首地址 0x00 (0x11) 和 0x01 (0x22)！原魔数字节被彻底篡改！`, 'error');
    }

    function writeDriverSafe() {
      corruptedAddrs.clear();
      writtenAddrs.clear();
      const testBytes = [0x11, 0x22, 0x33, 0x44];
      const start = 0x0E;

      log(`[DRIVER CHUNK START] M24c02_Write() 启动：目标地址 0x0E，写入长度 4 字节...`, 'event');

      const pageRemain = 16 - (start % 16);
      const chunk1 = Math.min(testBytes.length, pageRemain);

      for (let i = 0; i < chunk1; i++) {
        eeprom[start + i] = testBytes[i];
        writtenAddrs.add(start + i);
      }
      log(`[CHUNK 1] 第一笔页写：写入 0x0E..0x0F (${chunk1} 字节) ➔ 发送 STOP ➔ ACK 轮询等待 tWR 完成`, 'success');

      const nextAddr = start + chunk1;
      const chunk2 = testBytes.length - chunk1;
      for (let i = 0; i < chunk2; i++) {
        eeprom[nextAddr + i] = testBytes[chunk1 + i];
        writtenAddrs.add(nextAddr + i);
      }
      log(`[CHUNK 2] 第二笔页写：跨入下一页写入 0x10..0x11 (${chunk2} 字节) ➔ 发送 STOP ➔ ACK 轮询完成`, 'success');
      log(`[DRIVER CHUNK SUCCESS] 4 字节跨页写入完全正确，Page 0 首地址 0x00..0x01 完好无损！`, 'success');

      renderGrid();
    }

    function pingPongUpdate() {
      corruptedAddrs.clear();
      writtenAddrs.clear();
      const targetSlot = activeSlot === 'A' ? 'B' : 'A';
      const base = targetSlot === 'A' ? 0x00 : 0x80;

      version++;
      seq++;
      calibVal += 150;

      log(`[PING-PONG UPDATE] 用户修改参数，准备写入非活动槽 Slot ${targetSlot} (地址 0x${base.toString(16).padStart(2, '0').toUpperCase()}..0x${(base+127).toString(16).padStart(2, '0').toUpperCase()})...`, 'event');

      eeprom[base] = 0x50; eeprom[base + 1] = 0x41; eeprom[base + 2] = 0x52; eeprom[base + 3] = 0x41;
      eeprom[base + 4] = version;
      eeprom[base + 8] = seq & 0xFF; eeprom[base + 9] = (seq >> 8) & 0xFF;
      eeprom[base + 14] = (calibVal >> 8) & 0xFF; eeprom[base + 15] = calibVal & 0xFF;

      for (let i = 0; i < 16; i++) writtenAddrs.add(base + i);

      const crc = (0x5A00 + version * 7) & 0xFFFF;
      eeprom[base + 126] = crc & 0xFF;
      eeprom[base + 127] = (crc >> 8) & 0xFF;
      writtenAddrs.add(base + 126);
      writtenAddrs.add(base + 127);

      activeSlot = targetSlot;
      renderGrid();
      log(`[PING-PONG SUCCESS] Slot ${targetSlot} 8 页(128B)写入完毕 ➔ 整槽读回逐字节校验一致 ➔ 活动槽指针原子切为 Slot ${targetSlot} (Version: ${version}, Seq: ${seq})！`, 'success');
    }

    function pingPongPowerFail() {
      const targetSlot = activeSlot === 'A' ? 'B' : 'A';
      const base = targetSlot === 'A' ? 0x00 : 0x80;

      corruptedAddrs.clear();
      writtenAddrs.clear();

      log(`[FAULT INJECT] 模拟正在向非活动槽 Slot ${targetSlot} 写入第 3 页数据时突发硬件断电！`, 'error');

      eeprom[base] = 0x50; eeprom[base + 1] = 0x41; eeprom[base + 2] = 0x52; eeprom[base + 3] = 0x41;
      eeprom[base + 4] = version + 1;
      for (let i = 0; i < 8; i++) corruptedAddrs.add(base + i);
      eeprom[base + 126] = 0xDE; eeprom[base + 127] = 0xAD;
      corruptedAddrs.add(base + 126);
      corruptedAddrs.add(base + 127);

      renderGrid();

      setTimeout(() => {
        log(`[REBOOT RECOVERY] MCU 上电复位，AppParam_Load() 启动自检...`, 'event');
        log(`[SCAN SLOT ${targetSlot}] 读取 Slot ${targetSlot} ➔ CRC 校验失败 (CRC不匹配/半写截断) ➔ 判定 Slot ${targetSlot} 为脏数据废弃！`, 'warn');
        log(`[FALLBACK ACTIVE SLOT ${activeSlot}] 读取当前活动槽 Slot ${activeSlot} ➔ 魔数匹配，CRC-16 正确 ➔ 系统自动回退至旧配置镜像，数据零丢失！`, 'success');
      }, 500);
    }

    root.querySelector('#eeprom-btn-raw-bug')?.addEventListener('click', writeRawWrapBug);
    root.querySelector('#eeprom-btn-driver-safe')?.addEventListener('click', writeDriverSafe);
    root.querySelector('#eeprom-btn-pingpong')?.addEventListener('click', pingPongUpdate);
    root.querySelector('#eeprom-btn-fail')?.addEventListener('click', pingPongPowerFail);
    root.querySelector('#eeprom-btn-reset')?.addEventListener('click', () => {
      factoryInit();
      renderGrid();
      log('[RESET] EEPROM 已恢复出厂初始状态 (Slot A 生效)', 'normal');
    });

    renderGrid();
    log('[INIT] M24C02 EEPROM 256B 存储引擎就绪：Page 0..15，Slot A 活动中', 'normal');
  }

  try {
    initEepromSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initEepromSimulator', err);
  }
})();
