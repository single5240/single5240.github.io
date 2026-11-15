(() => {
  function initFlashSimulator() {
    const root = document.getElementById('flash-demo-app');
    if (!root) return;

    let generation = 1;
    let selectedSlot = 1;
    let validRecordsCount = 0;
    let recordSerial = 101;
    const SLOT_COUNT = 10;

    // 0 是 Header，1..9 是记录槽
    const slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      slots.push({
        idx: i,
        status: i === 0 ? 'valid' : 'erased', // Header 默认有效
        magic: i === 0 ? 'SECT' : '0xFFFFFFFF',
        version: i === 0 ? 3 : 255,
        gen: i === 0 ? 1 : 0xFFFFFFFF,
        id: i === 0 ? 0 : 0xFFFFFFFF,
        val: i === 0 ? 0 : 0xFFFFFFFF,
        lifecycle: i === 0 ? 0xFFFF : 0xFFFF,
        crc16: i === 0 ? '0x3A21' : '0xFFFF',
        commitFlag: i === 0 ? 0x00 : 0xFF
      });
    }

    const elGen = root.querySelector('#flash-stat-gen');
    const elCount = root.querySelector('#flash-stat-count');
    const elNext = root.querySelector('#flash-stat-next');
    const elStatus = root.querySelector('#flash-stat-status');
    const elSlotsGrid = root.querySelector('#flash-slots-grid');
    const elInspector = root.querySelector('#flash-inspector-body');
    const elLog = root.querySelector('#flash-log');

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

    function computeStats() {
      validRecordsCount = 0;
      let nextErased = -1;
      for (let i = 1; i < SLOT_COUNT; i++) {
        const s = slots[i];
        if (s.status === 'valid' && s.gen === generation && s.lifecycle === 0xFFFF) {
          validRecordsCount++;
        }
        if (nextErased === -1 && s.status === 'erased') {
          nextErased = i;
        }
      }
      if (elGen) elGen.textContent = `Gen ${generation}`;
      if (elCount) elCount.textContent = `${validRecordsCount} 条有效记录`;
      if (elNext) elNext.textContent = nextErased === -1 ? '扇区已满' : `Slot ${nextErased}`;
      return nextErased;
    }

    function renderSlots() {
      if (!elSlotsGrid) return;
      elSlotsGrid.innerHTML = '';
      computeStats();

      slots.forEach((s, idx) => {
        const slotEl = document.createElement('div');
        slotEl.className = `flash-slot ${s.status} ${idx === selectedSlot ? 'is-selected' : ''}`;

        let label = 'ERASED';
        if (idx === 0) label = 'HEADER';
        else if (s.status === 'tombstone' || s.lifecycle === 0x0000) label = 'TOMB';
        else if (s.status === 'valid') label = s.gen === generation ? 'VALID' : 'OLD_GEN';
        else if (s.status === 'pending') label = 'P1_WAIT';
        else if (s.status === 'dirty') label = 'DIRTY';

        slotEl.innerHTML = `
          <div class="flash-slot-num">Slot ${idx}</div>
          <div class="flash-slot-status">${label}</div>
          <div style="font-size: 9px; opacity: 0.8; margin-top: 2px;">${s.commitFlag === 0x00 ? 'CF: 0x00' : 'CF: 0xFF'}</div>
        `;
        slotEl.addEventListener('click', () => {
          selectedSlot = idx;
          renderSlots();
          renderInspector();
        });
        elSlotsGrid.appendChild(slotEl);
      });
      renderInspector();
    }

    function renderInspector() {
      if (!elInspector) return;
      const s = slots[selectedSlot];
      if (!s) return;
      elInspector.innerHTML = `
        <tr><td>0..3 magic</td><td>${s.magic}</td><td>${idxLabel(s.idx)} 魔数ASCII标识</td></tr>
        <tr><td>4 version</td><td>${s.version}</td><td>格式版本号</td></tr>
        <tr><td>8..11 generation</td><td>${s.gen === 0xFFFFFFFF ? '0xFFFFFFFF' : s.gen}</td><td>世代号 (当前系统: ${generation})</td></tr>
        <tr><td>12..15 recordId</td><td>${s.id === 0xFFFFFFFF ? '0xFFFFFFFF' : s.id}</td><td>单调递增稳定主键</td></tr>
        <tr><td>28..31 result1</td><td>${s.val === 0xFFFFFFFF ? '0xFFFFFFFF' : (s.val / 1000).toFixed(2) + ' N'}</td><td>测量有符号拉压力值 (mN)</td></tr>
        <tr><td>59..60 lifecycle</td><td>${s.lifecycle === 0xFFFF ? '0xFFFF (有效)' : '0x0000 (墓碑删除)'}</td><td>原位单向位编程生命周期码</td></tr>
        <tr><td>61..62 crc16</td><td>${s.crc16}</td><td>覆盖偏移 0..58 正文的 CRC-16</td></tr>
        <tr><td>63 commitFlag</td><td><strong>${s.commitFlag === 0x00 ? '0x00 (已提交)' : '0xFF (未提交/掉电)'}</strong></td><td>独立提交字节标志</td></tr>
      `;
    }

    function idxLabel(idx) {
      return idx === 0 ? '扇区头' : `数据槽 ${idx}`;
    }

    function write2PC() {
      const nextIdx = computeStats();
      if (nextIdx === -1) {
        log('[WRITE FAIL] 当前数据扇区无可用空槽，请点击【紧缩迁移回收 (Sector GC)】搬移存活记录并释放空闲空间！', 'warn');
        return;
      }

      const s = slots[nextIdx];
      selectedSlot = nextIdx;
      if (elStatus) elStatus.textContent = `写入 Slot ${nextIdx} 阶段 1...`;

      // 阶段 1: 写入正文与 CRC，commitFlag 保持 0xFF
      s.status = 'pending';
      s.magic = 'RECD';
      s.version = 3;
      s.gen = generation;
      s.id = recordSerial++;
      s.val = 20000 + Math.floor(Math.random() * 30000);
      s.lifecycle = 0xFFFF;
      s.crc16 = '0x' + Math.floor(0x1000 + Math.random() * 0xE000).toString(16).toUpperCase();
      s.commitFlag = 0xFF; // 关键：阶段1不写提交标志

      renderSlots();
      log(`[2PC 阶段 1] Slot ${nextIdx} 写入 0..58 正文与 CRC16(${s.crc16})，commitFlag 保持 0xFF -> 读回整槽校验成功`, 'event');

      // 阶段 2: 延迟 400ms 模拟页编程并写入 commitFlag 0x00
      setTimeout(() => {
        s.commitFlag = 0x00;
        s.status = 'valid';
        if (elStatus) elStatus.textContent = '写入就绪 (IDLE)';
        renderSlots();
        log(`[2PC 阶段 2] Slot ${nextIdx} 对偏移 63 单独发起 1 字节编程: 0xFF ➔ 0x00，记录正式合法生效！`, 'success');
      }, 450);
    }

    function powerFail() {
      const nextIdx = computeStats();
      if (nextIdx === -1) {
        log('[FAULT REJECT] 无可用空槽用于注入故障', 'warn');
        return;
      }
      const s = slots[nextIdx];
      selectedSlot = nextIdx;
      s.status = 'dirty';
      s.magic = 'RECD';
      s.version = 3;
      s.gen = generation;
      s.id = recordSerial++;
      s.val = 31500;
      s.lifecycle = 0xFFFF;
      s.crc16 = '0xDEAD'; // 模拟断电导致半写 CRC 或正文损坏
      s.commitFlag = 0xFF; // 关键：掉电使得阶段 2 永远没有发生！
      renderSlots();
      log(`[FAULT INJECT] Slot ${nextIdx} 写入正文中途硬件突发断电！留下残存半写数据，commitFlag 仍为 0xFF（成为 DIRTY 残槽）`, 'error');
    }

    function tombstoneDelete() {
      // 找到选中的有效槽，或从头找一个有效槽
      let target = selectedSlot;
      if (target === 0 || slots[target].status !== 'valid' || slots[target].lifecycle === 0x0000) {
        target = slots.findIndex((s, i) => i > 0 && s.status === 'valid' && s.lifecycle === 0xFFFF);
      }
      if (target === -1) {
        log('[DELETE REJECT] 当前无有效数据记录可供删除', 'warn');
        return;
      }
      selectedSlot = target;
      const s = slots[target];
      s.lifecycle = 0x0000;
      s.status = 'tombstone';
      renderSlots();
      log(`[TOMBSTONE] Slot ${target} (ID:${s.id}) 执行原位墓碑单条删除：利用 NOR Flash 物理特性将 lifecycle 从 0xFFFF 编程为 0x0000 (仅将位从 1 改为 0)，耗时 < 0.2ms，免除 400ms 整扇区擦除！`, 'warn');
    }

    let currentSectorAddr = 0xFDC000;

    function migrateSector() {
      // 1. 扫描当前属于当前世代且未被墓碑删除的有效存活记录
      const validRecords = [];
      for (let i = 1; i < SLOT_COUNT; i++) {
        const s = slots[i];
        if (s.status === 'valid' && s.gen === generation && s.lifecycle === 0xFFFF) {
          validRecords.push({ ...s });
        }
      }

      const oldCount = validRecords.length;
      const discardedCount = (SLOT_COUNT - 1) - oldCount;
      const oldAddrHex = '0x' + currentSectorAddr.toString(16).toUpperCase();
      currentSectorAddr = currentSectorAddr === 0xFDC000 ? 0xFDD000 : 0xFDC000;
      const newAddrHex = '0x' + currentSectorAddr.toString(16).toUpperCase();

      log(`[MIGRATE BEGIN] 启动稀疏扇区紧缩迁移回收：源扇区 ${oldAddrHex} ➔ 目标扇区 ${newAddrHex}`, 'event');
      log(`[GC SCAN] 扫描完成：检出 ${oldCount} 条有效存活记录，识别并过滤 ${discardedCount} 个脏槽/墓碑/历史旧世代槽`, 'normal');

      // 更新界面扇区物理地址
      const elSectorTitle = root.querySelector('#flash-sector-addr');
      if (elSectorTitle) {
        elSectorTitle.textContent = `数据扇区 ${newAddrHex} (4 KiB) 物理槽位视图`;
      }

      // 重建 slots 数组：Slot 0 为新扇区 Header，版本更新为当前 generation
      slots[0] = {
        idx: 0,
        status: 'valid',
        magic: 'SECT',
        version: 3,
        gen: generation,
        id: 0,
        val: 0,
        lifecycle: 0xFFFF,
        crc16: '0x' + Math.floor(0x1000 + Math.random() * 0xE000).toString(16).toUpperCase(),
        commitFlag: 0x00
      };

      // Slot 1..oldCount 为紧凑迁移搬移过来的有效记录
      for (let i = 0; i < validRecords.length; i++) {
        const rec = validRecords[i];
        slots[i + 1] = {
          idx: i + 1,
          status: 'valid',
          magic: rec.magic,
          version: rec.version,
          gen: generation,
          id: rec.id,
          val: rec.val,
          lifecycle: 0xFFFF,
          crc16: rec.crc16,
          commitFlag: 0x00
        };
      }

      // 剩余槽位恢复全新干净态 (全 0xFF ERASED)
      for (let i = validRecords.length + 1; i < SLOT_COUNT; i++) {
        slots[i] = {
          idx: i,
          status: 'erased',
          magic: '0xFFFFFFFF',
          version: 255,
          gen: 0xFFFFFFFF,
          id: 0xFFFFFFFF,
          val: 0xFFFFFFFF,
          lifecycle: 0xFFFF,
          crc16: '0xFFFF',
          commitFlag: 0xFF
        };
      }

      selectedSlot = validRecords.length > 0 ? 1 : 0;
      const nextIdx = computeStats();
      renderSlots();

      if (oldCount > 0) {
        log(`[MIGRATE COMMIT] ${oldCount} 条有效记录已按 2PC 契约原子搬移至新扇区 Slot 1..${oldCount}！`, 'success');
      } else {
        log(`[GC ERASE] 当前扇区无有效存活记录（全为废弃/旧世代），新扇区干净清空，空间 100% 回收！`, 'success');
      }
      log(`[SOURCE RELEASE] 源扇区 ${oldAddrHex} 执行整扇区 4KB 擦除并安全归还全局可用扇区池！下一追加槽位为 Slot ${nextIdx}`, 'success');
    }

    function clearAllGeneration() {
      generation++;
      recordSerial = 101;
      log(`[CLEAR ALL] 世代控制环执行逻辑清空：控制扇区顺序追加 Generation: ${generation} 记录，耗时 1ms！历史 36 个扇区全部数据瞬间逻辑失效，看门狗零风险！`, 'success');
      renderSlots();
    }

    let scanTimer = null;
    function bootScan() {
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      log('[BOOT SCAN] 模拟系统复位上电，扫描扇区 0xFDC000 中所有 64B 槽位...', 'event');
      let i = 0;
      scanTimer = setInterval(() => {
        if (i >= SLOT_COUNT) {
          clearInterval(scanTimer);
          const nextIdx = computeStats();
          renderSlots();
          log(`[SCAN DONE] 上电重构完成：检测到 ${validRecordsCount} 条有效提交记录，下一安全追加槽位锁定为 Slot ${nextIdx}`, 'success');
          return;
        }
        selectedSlot = i;
        renderSlots();
        const s = slots[i];
        if (i === 0) {
          log(`[SCAN] Slot 0 扇区头校验正常 (SECT, Gen: ${s.gen})`, 'normal');
        } else if (s.status === 'dirty' || (s.commitFlag === 0xFF && s.magic === 'RECD')) {
          log(`[SCAN] 发现 Slot ${i} 为掉电残槽 (commitFlag==0xFF)，安全跳过并标记为废弃，绝不回读误判！`, 'warn');
        } else if (s.status === 'valid' && s.gen === generation && s.lifecycle === 0xFFFF) {
          log(`[SCAN] 命中有效记录 Slot ${i} (ID: ${s.id}, Val: ${(s.val/1000).toFixed(2)}N, CRC通过)`, 'success');
        } else if (s.status === 'tombstone' || s.lifecycle === 0x0000) {
          log(`[SCAN] Slot ${i} 生命周期为 0x0000 (墓碑已删除)，跳过`, 'normal');
        } else if (s.status === 'erased') {
          log(`[SCAN] Slot ${i} 读回全 0xFF (ERASED)，定位到首个可用写空间`, 'normal');
        }
        i++;
      }, 200);
    }

    function eraseSector() {
      for (let i = 1; i < SLOT_COUNT; i++) {
        slots[i] = {
          idx: i,
          status: 'erased',
          magic: '0xFFFFFFFF',
          version: 255,
          gen: 0xFFFFFFFF,
          id: 0xFFFFFFFF,
          val: 0xFFFFFFFF,
          lifecycle: 0xFFFF,
          crc16: '0xFFFF',
          commitFlag: 0xFF
        };
      }
      log(`[SECTOR ERASE] 模拟整扇区 4KB 擦除指令 0x20，所有记录槽恢复全 0xFF 干净态`, 'normal');
      selectedSlot = 1;
      renderSlots();
    }

    root.querySelector('#flash-btn-write')?.addEventListener('click', write2PC);
    root.querySelector('#flash-btn-fail')?.addEventListener('click', powerFail);
    root.querySelector('#flash-btn-del')?.addEventListener('click', tombstoneDelete);
    root.querySelector('#flash-btn-migrate')?.addEventListener('click', migrateSector);
    root.querySelector('#flash-btn-clear')?.addEventListener('click', clearAllGeneration);
    root.querySelector('#flash-btn-scan')?.addEventListener('click', bootScan);
    root.querySelector('#flash-btn-erase')?.addEventListener('click', eraseSector);

    renderSlots();
    log('[INIT] NOR Flash 存储引擎就绪：当前处于 Generation 1，扇区头校验通过', 'normal');
  }

  try {
    initFlashSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initFlashSimulator', err);
  }
})();
