(() => {
  const content = document.querySelector('.content');
  if (!content) return;
  const toc = document.querySelector('#article-toc');
  const list = toc ? toc.querySelector('ol') : null;
  const headings = [...content.querySelectorAll('h2,h3')];
  const links = new Map();

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback to execCommand below
      }
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      area.style.pointerEvents = 'none';
      document.body.append(area);
      area.focus();
      area.select();
      const success = document.execCommand('copy');
      area.remove();
      return success;
    } catch {
      return false;
    }
  };

  // Keep existing Markdown anchors stable; generate only missing IDs.
  if (toc && list) {
    headings.forEach((heading, index) => {
      if (!heading.id) {
        const base = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `section-${index + 1}`;
        let id = base;
        for (let n = 2; document.getElementById(id); n += 1) id = `${base}-${n}`;
        heading.id = id;
      }
      const item = document.createElement('li');
      if (heading.tagName === 'H3') item.className = 'toc-sub';
      const link = document.createElement('a');
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = heading.textContent;
      item.append(link);
      list.append(item);
      links.set(heading, link);
    });
    toc.hidden = headings.length < 2;
    if (matchMedia('(max-width: 1000px)').matches) toc.open = false;
  }

  content.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '可横向滚动的表格');
    table.replaceWith(wrap);
    wrap.append(table);
  });
  content.querySelectorAll('pre').forEach((pre) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const language = document.createElement('span');
    language.textContent = pre.closest('[class*="language-"]')?.className.match(/language-([\w+-]+)/)?.[1] || 'text';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    button.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      const text = pre.querySelector('code')?.textContent || pre.textContent;
      const ok = await copyText(text);
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { button.textContent = '复制'; }, 1800);
    });
    toolbar.append(language, button);
    pre.replaceWith(wrapper);
    wrapper.append(toolbar, pre);
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', `${language.textContent} 代码，可横向滚动`);
  });
  const progress = document.querySelector('#reading-progress');
  let ticking = false;
  const update = () => {
    const height = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0})`;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > 150) break;
      current = heading;
    }
    links.forEach((link, heading) => {
      if (heading === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    ticking = false;
  };
  const schedule = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', schedule);
  update();

  /* ==========================================================================
     Interactive Article Widgets: FSM, Flash 2PC & Scheduler Ring Buffer
     ========================================================================== */
  function initFsmSimulator() {
    const root = document.getElementById('fsm-demo-app');
    if (!root) return;

    const STATE_NAMES = ['IDLE (待机)', 'RUNNING (测试中)', 'PEAK_HOLD (峰值保持)', 'ALARM (超载报警)'];
    const LOOP_EVENTS = ['EVENT_IDLE_LOOP', 'EVENT_RUNNING_LOOP', 'EVENT_PEAK_LOOP', 'EVENT_ALARM_LOOP'];
    const TRANSITIONS = [
      { event: 'EVENT_START', state: 0, action: 'Demo_Start', next: 1, desc: '启动测试: 计数清零并进入 RUNNING' },
      { event: 'EVENT_STOP', state: 1, action: 'Demo_Stop', next: 0, desc: '停止测试: 归零并返回 IDLE' },
      { event: 'EVENT_PEAK', state: 1, action: 'Demo_PeakHold', next: 2, desc: '检出峰值: 锁存极大值并进入 PEAK_HOLD' },
      { event: 'EVENT_STOP', state: 2, action: 'Demo_Stop', next: 0, desc: '停止测试: 退出峰值保持返回 IDLE' },
      { event: 'EVENT_ALARM', state: 0, action: 'Demo_Alarm', next: 3, desc: '待机超载: 触发声光报警进入 ALARM' },
      { event: 'EVENT_ALARM', state: 1, action: 'Demo_Alarm', next: 3, desc: '测试超载: 立即急停并进入 ALARM' },
      { event: 'EVENT_ALARM', state: 2, action: 'Demo_Alarm', next: 3, desc: '保持期超载: 触发急停并进入 ALARM' },
      { event: 'EVENT_RESET', state: 3, action: 'Demo_Reset', next: 0, desc: '故障复位: 清除报警并返回 IDLE' },
      { event: 'EVENT_IDLE_LOOP', state: 0, action: 'NULL', next: 0, desc: '空闲自环: 无操作保持 IDLE' },
      { event: 'EVENT_RUNNING_LOOP', state: 1, action: 'Demo_RunningLoop', next: 1, desc: '采样自环: 累加运行计数' },
      { event: 'EVENT_PEAK_LOOP', state: 2, action: 'Demo_PeakLoop', next: 2, desc: '保持自环: 维持当前读数显示' },
      { event: 'EVENT_ALARM_LOOP', state: 3, action: 'Demo_AlarmLoop', next: 3, desc: '报警自环: 蜂鸣器交替闪烁' }
    ];

    let currentState = 0;
    const QUEUE_CAP = 8;
    const queue = new Array(QUEUE_CAP).fill(null);
    let head = 0;
    let tail = 0;
    let count = 0;
    let stepCount = 0;
    let runCount = 0;
    let timer = null;

    const elState = root.querySelector('#fsm-stat-state');
    const elEvent = root.querySelector('#fsm-stat-event');
    const elAction = root.querySelector('#fsm-stat-action');
    const elQueueCount = root.querySelector('#fsm-stat-qcount');
    const elSlots = root.querySelector('#fsm-queue-slots');
    const elLog = root.querySelector('#fsm-log');
    const elAutoBtn = root.querySelector('#fsm-btn-auto');
    const stateCards = root.querySelectorAll('.fsm-state-card');
    const tableRows = root.querySelectorAll('.fsm-table tbody tr');

    function log(msg, type = 'normal') {
      if (!elLog) return;
      const line = document.createElement('div');
      line.className = 'aiw-log-line';
      const time = `[${String(stepCount).padStart(3, '0')}]`;
      let styledMsg = msg;
      if (type === 'event') styledMsg = `<span class="aiw-log-event">${msg}</span>`;
      else if (type === 'success') styledMsg = `<span class="aiw-log-success">${msg}</span>`;
      else if (type === 'warn') styledMsg = `<span class="aiw-log-warn">${msg}</span>`;
      else if (type === 'error') styledMsg = `<span class="aiw-log-error">${msg}</span>`;
      line.innerHTML = `<span class="aiw-log-time">${time}</span> ${styledMsg}`;
      elLog.appendChild(line);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function renderQueue() {
      if (!elSlots) return;
      elSlots.innerHTML = '';
      for (let i = 0; i < QUEUE_CAP; i++) {
        const slot = document.createElement('div');
        slot.className = `fsm-slot ${queue[i] ? 'has-item' : ''}`;
        const isHead = (i === head);
        const isTail = (i === tail && count > 0);
        let ptrText = '';
        if (isHead && isTail) ptrText = 'H/T';
        else if (isHead) ptrText = 'H';
        else if (isTail) ptrText = 'T';
        if (ptrText) {
          const ptr = document.createElement('span');
          ptr.className = 'fsm-slot-ptr';
          ptr.textContent = ptrText;
          slot.appendChild(ptr);
        }
        const idx = document.createElement('span');
        idx.className = 'fsm-slot-idx';
        idx.textContent = `[${i}]`;
        const val = document.createElement('span');
        val.textContent = queue[i] ? queue[i].replace('EVENT_', '') : '—';
        slot.appendChild(idx);
        slot.appendChild(val);
        elSlots.appendChild(slot);
      }
      if (elQueueCount) {
        elQueueCount.textContent = `${count} / ${QUEUE_CAP} ${count === QUEUE_CAP ? '(满载)' : (count === 0 ? '(空闲)' : '')}`;
      }
    }

    function renderStates(matchedIdx = -1) {
      stateCards.forEach((card, idx) => {
        card.classList.toggle('is-active', idx === currentState);
      });
      if (elState) elState.textContent = STATE_NAMES[currentState];

      tableRows.forEach((row, idx) => {
        row.classList.toggle('is-matched', idx === matchedIdx);
        if (idx === matchedIdx) {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }

    function postEvent(evName) {
      if (count >= QUEUE_CAP) {
        log(`[POST REJECT] 外部事件队列已满(${QUEUE_CAP})，已丢弃 ${evName}（零堆内存静态安全）`, 'warn');
        return false;
      }
      queue[head] = evName;
      head = (head + 1) % QUEUE_CAP;
      count++;
      renderQueue();
      log(`[POST] 投递外部事件: ${evName} (进入队列槽 [${(head - 1 + QUEUE_CAP) % QUEUE_CAP}])`, 'event');
      return true;
    }

    function step() {
      stepCount++;
      let ev = '';
      let fromQueue = false;

      if (count > 0) {
        ev = queue[tail];
        queue[tail] = null;
        tail = (tail + 1) % QUEUE_CAP;
        count--;
        fromQueue = true;
      } else {
        ev = LOOP_EVENTS[currentState];
      }

      if (elEvent) elEvent.textContent = `${ev} ${fromQueue ? '(外部FIFO)' : '(自环)'}`;

      let matchedIdx = -1;
      for (let i = 0; i < TRANSITIONS.length; i++) {
        const tr = TRANSITIONS[i];
        if (tr.event === ev && tr.state === currentState) {
          matchedIdx = i;
          break;
        }
      }

      if (matchedIdx === -1) {
        log(`[IGNORED] 事件 ${ev} 在状态 ${STATE_NAMES[currentState]} 下未定义转移，状态保持不变`, 'warn');
        if (elAction) elAction.textContent = '无 (IGNORED)';
        renderQueue();
        renderStates(-1);
        return;
      }

      const match = TRANSITIONS[matchedIdx];
      const oldState = currentState;

      // 动作在状态切换前执行 (语义对齐 C99 内核)
      if (match.action === 'Demo_Start') {
        runCount = 0;
      } else if (match.action === 'Demo_RunningLoop') {
        runCount++;
        if (runCount >= 4) {
          log(`[ACTION] 测量计数达 4 次，Demo_RunningLoop 自动投递 EVENT_PEAK 模拟自动检出峰值`, 'event');
          postEvent('EVENT_PEAK');
        }
      }

      if (elAction) elAction.textContent = `${match.action}()`;
      currentState = match.next;

      renderQueue();
      renderStates(matchedIdx);

      if (fromQueue) {
        log(`[DISPATCH] FIFO消费: ${ev} -> 执行 ${match.action}() -> 状态: ${STATE_NAMES[oldState]} ➔ ${STATE_NAMES[currentState]}`, 'success');
      } else {
        log(`[LOOP] 空闲自环: ${ev} -> 执行 ${match.action}() (计数:${runCount}) -> 状态保持 ${STATE_NAMES[currentState]}`, 'normal');
      }
    }

    function reset() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        if (elAutoBtn) elAutoBtn.textContent = '连续自动运行';
      }
      currentState = 0;
      head = 0;
      tail = 0;
      count = 0;
      stepCount = 0;
      runCount = 0;
      queue.fill(null);
      if (elLog) elLog.innerHTML = '';
      if (elAction) elAction.textContent = '无';
      if (elEvent) elEvent.textContent = '就绪';
      log('[INIT] 状态机复位完成，初始状态置为 IDLE，事件队列已清空', 'success');
      renderQueue();
      renderStates(-1);
    }

    // 事件绑定
    root.querySelectorAll('[data-fsm-event]').forEach(btn => {
      btn.addEventListener('click', () => postEvent(btn.getAttribute('data-fsm-event')));
    });

    const stepBtn = root.querySelector('#fsm-btn-step');
    if (stepBtn) stepBtn.addEventListener('click', step);

    if (elAutoBtn) {
      elAutoBtn.addEventListener('click', () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
          elAutoBtn.textContent = '连续自动运行';
          log('[PAUSE] 自动运行已暂停', 'normal');
        } else {
          elAutoBtn.textContent = '暂停运行';
          log('[RUN] 启动连续周期调度 (650ms/step)', 'normal');
          timer = setInterval(step, 650);
        }
      });
    }

    const resetBtn = root.querySelector('#fsm-btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', reset);

    reset();
  }

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
        else if (s.status === 'valid') label = s.gen === generation ? (s.lifecycle === 0x0000 ? 'TOMB' : 'VALID') : 'OLD_GEN';
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

    function bootScan() {
      log('[BOOT SCAN] 模拟系统复位上电，扫描扇区 0xFDC000 中所有 64B 槽位...', 'event');
      let i = 0;
      const scanTimer = setInterval(() => {
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

  function initSchedulerSimulator() {
    const root = document.getElementById('sched-demo-app');
    if (!root) return;

    let currentTick = 0;
    let lastTick1ms = 0;
    let lastTick10ms = 0;
    let lastTick100ms = 0;

    let countL0 = 0;
    let countL1 = 0;
    let countL2 = 0;
    let stripIndex = 0; // 0..39 (共 40 个 8 行条带，刷新 320 行屏幕)
    let totalStrips = 0;

    const RING_CAP = 10;
    const ringItems = new Array(RING_CAP).fill(null);
    let rHead = 0;
    let rTail = 0;
    let rCount = 0;

    let isRunning = false;
    let runTimer = null;

    const elTick = root.querySelector('#sched-stat-tick');
    const elCycle = root.querySelector('#sched-stat-cycle');
    const elStripText = root.querySelector('#sched-stat-strip');
    const elQText = root.querySelector('#sched-stat-q');
    const elStripFill = root.querySelector('#sched-strip-fill');
    const elRingTrack = root.querySelector('#sched-ring-track');
    const elLog = root.querySelector('#sched-log');
    const elRunBtn = root.querySelector('#sched-btn-run');

    const cardL0 = root.querySelector('#sched-card-l0');
    const cardL1 = root.querySelector('#sched-card-l1');
    const cardL2 = root.querySelector('#sched-card-l2');
    const cardL3 = root.querySelector('#sched-card-l3');

    function log(msg, type = 'normal') {
      if (!elLog) return;
      const line = document.createElement('div');
      line.className = 'aiw-log-line';
      const time = `[${String(currentTick).padStart(4, '0')}ms]`;
      let styledMsg = msg;
      if (type === 'event') styledMsg = `<span class="aiw-log-event">${msg}</span>`;
      else if (type === 'success') styledMsg = `<span class="aiw-log-success">${msg}</span>`;
      else if (type === 'warn') styledMsg = `<span class="aiw-log-warn">${msg}</span>`;
      else if (type === 'error') styledMsg = `<span class="aiw-log-error">${msg}</span>`;
      line.innerHTML = `<span class="aiw-log-time">${time}</span> ${styledMsg}`;
      elLog.appendChild(line);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function renderRing() {
      if (!elRingTrack) return;
      elRingTrack.innerHTML = '';
      for (let i = 0; i < RING_CAP; i++) {
        const slot = document.createElement('div');
        slot.className = `sched-ring-slot ${ringItems[i] ? 'has-item' : ''}`;
        const isHead = (i === rHead);
        const isTail = (i === rTail && rCount > 0);
        let ptr = '';
        if (isHead && isTail) ptr = 'H/T';
        else if (isHead) ptr = 'Head';
        else if (isTail) ptr = 'Tail';
        if (ptr) {
          const ptrEl = document.createElement('span');
          ptrEl.className = 'fsm-slot-ptr';
          ptrEl.textContent = ptr;
          slot.appendChild(ptrEl);
        }
        const val = document.createElement('span');
        val.textContent = ringItems[i] ? ringItems[i].replace('EV_', '') : `[${i}]`;
        slot.appendChild(val);
        elRingTrack.appendChild(slot);
      }
      if (elQText) elQText.textContent = `${rCount} / ${RING_CAP} ${rCount === RING_CAP ? '(满)' : ''}`;
    }

    function renderUI() {
      if (elTick) elTick.textContent = `${currentTick} ms`;
      if (elCycle) elCycle.textContent = `L0:${countL0} | L1:${countL1} | L2:${countL2}`;
      if (elStripText) elStripText.textContent = `条带 ${stripIndex + 1}/40 (行 ${stripIndex * 8}..${stripIndex * 8 + 7})`;
      if (elStripFill) elStripFill.style.width = `${((stripIndex + 1) / 40) * 100}%`;
      renderRing();
    }

    function pushEvent(name) {
      if (rCount >= RING_CAP) {
        log(`[RING OVERRUN] 环形事件缓冲区已满(${RING_CAP})，安全拒绝入队 ${name}（防覆盖未处理事件）`, 'error');
        return false;
      }
      ringItems[rHead] = name;
      rHead = (rHead + 1) % RING_CAP;
      rCount++;
      renderRing();
      log(`[PRODUCE] 生产者入队事件: ${name} (Head➔[${rHead}])`, 'event');
      return true;
    }

    function tickStep(msToAdd = 1) {
      for (let step = 0; step < msToAdd; step++) {
        currentTick += 1;
        let l0Fired = false;
        let l1Fired = false;
        let l2Fired = false;

        // Level 0: 1 ms 高频输入与消抖
        if ((currentTick - lastTick1ms) >= 1) {
          lastTick1ms = currentTick;
          countL0++;
          l0Fired = true;
        }

        // Level 1: 10 ms 测控与算法
        if ((currentTick - lastTick10ms) >= 10) {
          lastTick10ms = currentTick;
          countL1++;
          l1Fired = true;
        }

        // Level 2: 100 ms 低频状态量
        if ((currentTick - lastTick100ms) >= 100) {
          lastTick100ms = currentTick;
          countL2++;
          l2Fired = true;
        }

        // Level 3: 空闲分片任务 (每圈推进 1 个条带 + 消费 1 个环形事件)
        stripIndex = (stripIndex + 1) % 40;
        totalStrips++;

        let consumedEvent = null;
        if (rCount > 0) {
          consumedEvent = ringItems[rTail];
          ringItems[rTail] = null;
          rTail = (rTail + 1) % RING_CAP;
          rCount--;
        }

        // 仅在关键事件或整 10ms 节点记录日志，避免刷屏
        if (consumedEvent) {
          log(`[CONSUME] UI空闲轮询消费事件: ${consumedEvent} (Tail➔[${rTail}])`, 'success');
        }
        if (l2Fired) {
          log(`[LEVEL 2] 100ms周期到达: 检查电池电量与重力方向 (当前耗时预算 < 300μs)`, 'normal');
        } else if (l1Fired && currentTick % 50 === 0) {
          log(`[LEVEL 1] 10ms周期到达: AD7190力值解算与峰值检测 (耗时预算 < 200μs)`, 'normal');
        }

        // 触发闪烁动画
        if (cardL0) cardL0.classList.toggle('is-firing', l0Fired);
        if (cardL1) cardL1.classList.toggle('is-firing', l1Fired);
        if (cardL2) cardL2.classList.toggle('is-firing', l2Fired);
        if (cardL3) cardL3.classList.toggle('is-firing', true);
      }
      renderUI();
    }

    root.querySelector('#sched-btn-key-click')?.addEventListener('click', () => pushEvent('EV_KEY_CLICK'));
    root.querySelector('#sched-btn-key-long')?.addEventListener('click', () => pushEvent('EV_KEY_LONG'));
    root.querySelector('#sched-btn-alarm')?.addEventListener('click', () => pushEvent('EV_OVERLOAD'));
    root.querySelector('#sched-btn-burst')?.addEventListener('click', () => {
      log('[BURST] 突发并发投递 4 项事件测试缓冲回绕与满溢保护...', 'warn');
      pushEvent('EV_KEY_DOWN');
      pushEvent('EV_PEAK_HIT');
      pushEvent('EV_CALIB_DONE');
      pushEvent('EV_KEY_UP');
    });

    root.querySelector('#sched-btn-step1')?.addEventListener('click', () => tickStep(1));
    root.querySelector('#sched-btn-step10')?.addEventListener('click', () => tickStep(10));
    root.querySelector('#sched-btn-step100')?.addEventListener('click', () => tickStep(100));

    if (elRunBtn) {
      elRunBtn.addEventListener('click', () => {
        isRunning = !isRunning;
        if (isRunning) {
          elRunBtn.textContent = '暂停调度器';
          log('[SCHEDULER RUN] 启动协作调度主循环 (10ms 步进)', 'normal');
          runTimer = setInterval(() => tickStep(2), 50);
        } else {
          elRunBtn.textContent = '连续运行';
          clearInterval(runTimer);
          runTimer = null;
          log('[SCHEDULER PAUSE] 主循环已暂停', 'normal');
        }
      });
    }

    root.querySelector('#sched-btn-reset')?.addEventListener('click', () => {
      if (runTimer) {
        clearInterval(runTimer);
        runTimer = null;
        isRunning = false;
        if (elRunBtn) elRunBtn.textContent = '连续运行';
      }
      currentTick = 0;
      lastTick1ms = 0;
      lastTick10ms = 0;
      lastTick100ms = 0;
      countL0 = 0;
      countL1 = 0;
      countL2 = 0;
      stripIndex = 0;
      totalStrips = 0;
      rHead = 0;
      rTail = 0;
      rCount = 0;
      ringItems.fill(null);
      if (elLog) elLog.innerHTML = '';
      log('[RESET] 调度器与环形缓冲区已复位，时钟重归 0ms', 'normal');
      renderUI();
    });

    renderUI();
    log('[INIT] 四级分频协作调度器初始化完成：时基 1ms / 10ms / 100ms / Idle', 'normal');
  }

  /* ==========================================================================
     EEPROM Page Wrap-around & A/B Dual Slot Controller
     ========================================================================== */
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

      if (elStatAddr) elStatAddr.textContent = `0x${selectedAddr.toString(16).padStart(2, '0').toUpperCase()} (值: 0x${val})`;
      if (elStatPage) elStatPage.textContent = `Page ${page} (页首: 0x${(page*16).toString(16).padStart(2, '0').toUpperCase()})`;
      if (elStatSlot) elStatSlot.textContent = `当前活动: Slot ${activeSlot} (${activeSlot === 'A' ? '0x00..0x7F' : '0x80..0xFF'})`;
      if (elStatCrc) elStatCrc.textContent = corruptedAddrs.size > 0 ? '损坏 (校验失败)' : '0x4A1B (合法)';

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

  /* ==========================================================================
     RGB565 Diagnostic Laboratory Controller
     ========================================================================== */
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

  /* ==========================================================================
     LCD Strip Rendering & Frame Snapshot Controller
     ========================================================================== */
  function initLcdStripSimulator() {
    const root = document.getElementById('strip-demo-app');
    if (!root) return;

    let stripIdx = 0;
    let snapshotEnabled = true;
    let realTimeVal = 45.20;
    let snapshotVal = 45.20;
    let isTorn = false;
    let isRunning = false;
    let timer = null;

    const elBand = root.querySelector('#strip-band');
    const elVal = root.querySelector('#strip-screen-val');
    const elStatStrip = root.querySelector('#strip-stat-strip');
    const elStatY = root.querySelector('#strip-stat-y');
    const elStatTear = root.querySelector('#strip-stat-tear');
    const elLog = root.querySelector('#strip-log');
    const chkSnapshot = root.querySelector('#strip-chk-snapshot');
    const elRunBtn = root.querySelector('#strip-btn-run');
    const canvas = root.querySelector('#strip-canvas');

    function log(msg, type = 'normal') {
      if (!elLog) return;
      const line = document.createElement('div');
      line.className = 'aiw-log-line';
      const time = `[Strip ${String(stripIdx).padStart(2, '0')}]`;
      let styledMsg = msg;
      if (type === 'event') styledMsg = `<span class="aiw-log-event">${msg}</span>`;
      else if (type === 'success') styledMsg = `<span class="aiw-log-success">${msg}</span>`;
      else if (type === 'warn') styledMsg = `<span class="aiw-log-warn">${msg}</span>`;
      else if (type === 'error') styledMsg = `<span class="aiw-log-error">${msg}</span>`;
      line.innerHTML = `<span class="aiw-log-time">${time}</span> ${styledMsg}`;
      elLog.appendChild(line);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function drawWave() {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#0f818d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x += 4) {
        const y = canvas.height / 2 + Math.sin(x * 0.08 + stripIdx * 0.2) * 16;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function renderUI() {
      const topY = stripIdx * 8;
      if (elBand) elBand.style.top = `${topY}px`;
      if (elStatStrip) elStatStrip.textContent = `条带 ${stripIdx} / 39 (总计 40 条带)`;
      if (elStatY) elStatY.textContent = `y = ${topY} .. ${topY + 7} px`;

      if (elVal) {
        if (isTorn) {
          elVal.textContent = '45.89';
          elVal.classList.add('is-torn');
          if (elStatTear) {
            elStatTear.textContent = '检测到画面撕裂 (Torn!)';
            elStatTear.className = 'aiw-stat-value warn';
          }
        } else {
          elVal.textContent = (snapshotEnabled ? snapshotVal : realTimeVal).toFixed(2);
          elVal.classList.remove('is-torn');
          if (elStatTear) {
            elStatTear.textContent = '画面原子一致 (无撕裂)';
            elStatTear.className = 'aiw-stat-value accent';
          }
        }
      }

      drawWave();
    }

    function stepStrip() {
      stripIdx = (stripIdx + 1) % 40;

      if (stripIdx === 0) {
        snapshotVal = realTimeVal;
        isTorn = false;
        log(`[FRAME START] Strip 0 开始：锁定新帧不可变快照 (数值: ${snapshotVal.toFixed(2)} N)，消除中途数据跳变！`, 'success');
      }

      if (!snapshotEnabled && stripIdx > 12 && stripIdx < 25 && realTimeVal !== snapshotVal) {
        isTorn = true;
        log(`[TEARING DETECTED] Strip ${stripIdx} 处于大数字 Y=100..140 跨度内！因关闭了帧快照，新到达力值 (${realTimeVal}N) 覆盖了旧力值 (${snapshotVal}N)，屏幕上下半截断裂！`, 'error');
      }

      renderUI();
    }

    function triggerJump() {
      realTimeVal = realTimeVal === 45.20 ? 89.60 : 45.20;
      log(`[SENSOR EVENT] 传感器高频中断到达新采样：力值瞬时跳变为 ${realTimeVal.toFixed(2)} N (当前刷新处于 Strip ${stripIdx})`, 'event');
      if (!snapshotEnabled && stripIdx >= 10 && stripIdx <= 22) {
        isTorn = true;
      }
      renderUI();
    }

    chkSnapshot?.addEventListener('change', (e) => {
      snapshotEnabled = e.target.checked;
      log(`[SNAPSHOT MODE] 帧快照已${snapshotEnabled ? '开启 (AppUiRenderer 冻结一帧数据)' : '关闭 (直读全局变量，存在撕裂风险)'}`, 'normal');
      renderUI();
    });

    root.querySelector('#strip-btn-step')?.addEventListener('click', stepStrip);
    root.querySelector('#strip-btn-jump')?.addEventListener('click', triggerJump);

    if (elRunBtn) {
      elRunBtn.addEventListener('click', () => {
        isRunning = !isRunning;
        if (isRunning) {
          elRunBtn.textContent = '暂停刷屏';
          timer = setInterval(stepStrip, 60);
          log('[RUN] 启动连续 40 条带逐行异步刷新', 'normal');
        } else {
          elRunBtn.textContent = '连续刷屏';
          clearInterval(timer);
          timer = null;
          log('[PAUSE] 异步刷屏已暂停', 'normal');
        }
      });
    }

    root.querySelector('#strip-btn-reset')?.addEventListener('click', () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
        isRunning = false;
        if (elRunBtn) elRunBtn.textContent = '连续刷屏';
      }
      stripIdx = 0;
      realTimeVal = 45.20;
      snapshotVal = 45.20;
      isTorn = false;
      if (elLog) elLog.innerHTML = '';
      log('[RESET] 条带渲染引擎复位：回到 Strip 0，局部画布 3.84 KB 就绪', 'normal');
      renderUI();
    });

    renderUI();
    log('[INIT] 240×8 条带渲染引擎初始化完成：40 条带覆盖 320 行，RAM 占用仅 3.84 KB', 'normal');
  }


  /* ========================================================
     Interactive Simulator 7: 1-bit Bitmap Font Pipeline
     ======================================================== */
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
        const code = val.charCodeAt(0);
        bTarget = code;
        resetBsearch();
      });
    }

    loadPreset('gui');
    resetBsearch();
  }


  /* ========================================================
     Interactive Simulator 8: EtherCAT State Machine (ESM)
     ======================================================== */
  function initEcatEsmSimulator() {
    const root = document.getElementById('ecat-esm-demo-app');
    if (!root) return;

    let currentState = 'INIT';
    let hasError = false;
    let alStatusCode = 0x0000;
    let alStatusName = 'No error';

    const modules = [
      { id: 'm1', name: 'Slot 1: 4通道数字量输入 (4-CH DI)', type: 'tx', bytes: 1, active: true },
      { id: 'm2', name: 'Slot 2: 8通道数字量输出 (8-CH DO)', type: 'rx', bytes: 1, active: true },
      { id: 'm3', name: 'Slot 3: 2通道模拟量输出 (2-CH AO 16b)', type: 'rx', bytes: 4, active: true },
      { id: 'm4', name: 'Slot 4: 4通道模拟量输入 (4-CH AI 16b)', type: 'tx', bytes: 8, active: true }
    ];

    let faultMbxSize = false;
    let faultRxSize = false;
    let faultTxSize = false;
    let faultDcSync = false;

    const elAlControl = root.querySelector('#ecat-al-control');
    const elAlStatus = root.querySelector('#ecat-al-status');
    const elAlCode = root.querySelector('#ecat-al-code');
    const elLog = root.querySelector('#ecat-log');
    const elRxSum = root.querySelector('#ecat-rx-sum');
    const elTxSum = root.querySelector('#ecat-tx-sum');

    function log(msg, type) {
      if (!elLog) return;
      const time = new Date().toTimeString().split(' ')[0] + '.' + Math.floor(performance.now() % 1000).toString().padStart(3, '0');
      let color = '#d4d4d4';
      if (type === 'error') color = '#ef4444';
      if (type === 'success') color = '#10b981';
      if (type === 'warn') color = '#f59e0b';
      if (type === 'info') color = '#38bdf8';
      const div = document.createElement('div');
      div.style.color = color;
      div.innerHTML = '[' + time + '] ' + msg;
      elLog.appendChild(div);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function calcPdoSizes() {
      let rxBytes = 0;
      let txBytes = 0;
      modules.forEach(m => {
        if (m.active) {
          if (m.type === 'rx') rxBytes += m.bytes;
          if (m.type === 'tx') txBytes += m.bytes;
        }
      });
      if (elRxSum) elRxSum.textContent = rxBytes + ' 字节';
      if (elTxSum) elTxSum.textContent = txBytes + ' 字节';
      return { rxBytes, txBytes };
    }

    function updateUI() {
      const stateCodes = { INIT: '0x01', PREOP: '0x02', SAFEOP: '0x04', OP: '0x08' };
      if (elAlControl) elAlControl.textContent = stateCodes[currentState];
      if (elAlStatus) {
        elAlStatus.textContent = stateCodes[currentState] + (hasError ? ' + ERROR' : '');
        elAlStatus.className = 'ecat-status-val' + (hasError ? ' error' : '');
      }
      if (elAlCode) {
        elAlCode.textContent = '0x' + alStatusCode.toString(16).padStart(4, '0').toUpperCase() + ' (' + alStatusName + ')';
        elAlCode.className = 'ecat-status-val' + (hasError ? ' error' : '');
      }

      ['INIT', 'PREOP', 'SAFEOP', 'OP'].forEach(s => {
        const node = root.querySelector('#esm-node-' + s.toLowerCase());
        if (node) {
          node.classList.remove('active', 'error');
          if (s === currentState) {
            node.classList.add(hasError ? 'error' : 'active');
          }
        }
      });

      const sm0 = root.querySelector('#sm-status-0');
      const sm1 = root.querySelector('#sm-status-1');
      const sm2 = root.querySelector('#sm-status-2');
      const sm3 = root.querySelector('#sm-status-3');

      const isMailboxActive = ['PREOP', 'SAFEOP', 'OP'].includes(currentState) && !hasError;
      const isInputActive = ['SAFEOP', 'OP'].includes(currentState) && !hasError;
      const isOutputActive = currentState === 'OP' && !hasError;

      if (sm0) {
        sm0.textContent = isMailboxActive ? 'ACTIVE (128B)' : 'CLOSED';
        sm0.className = isMailboxActive ? 'ecat-sm-active' : 'ecat-sm-inactive';
      }
      if (sm1) {
        sm1.textContent = isMailboxActive ? 'ACTIVE (128B)' : 'CLOSED';
        sm1.className = isMailboxActive ? 'ecat-sm-active' : 'ecat-sm-inactive';
      }
      if (sm2) {
        sm2.textContent = isOutputActive ? ('ACTIVE (' + calcPdoSizes().rxBytes + 'B)') : 'LOCKED';
        sm2.className = isOutputActive ? 'ecat-sm-active' : 'ecat-sm-inactive';
      }
      if (sm3) {
        sm3.textContent = isInputActive ? ('ACTIVE (' + calcPdoSizes().txBytes + 'B)') : 'CLOSED';
        sm3.className = isInputActive ? 'ecat-sm-active' : 'ecat-sm-inactive';
      }
    }

    function gotoPreOp() {
      log('[TRANSITION] 主站写 AL Control (0x0120) = 0x02 (PREOP 请求)...', 'info');
      if (faultMbxSize) {
        hasError = true;
        alStatusCode = 0x0016;
        alStatusName = 'Invalid mailbox configuration';
        log('[ERROR 0x0016] CheckSmSettings 校验失败：主站下发 SM0 长度(64B) 与 ESI XML/代码宏(128B) 不匹配！状态转换拒绝，置位 Error Ind。', 'error');
      } else {
        currentState = 'PREOP';
        hasError = false;
        alStatusCode = 0x0000;
        alStatusName = 'No error';
        log('[SUCCESS] SM0 (Mailbox Out) & SM1 (Mailbox In) 校验通过并启动，邮箱 SDO 通道开启！', 'success');
      }
      updateUI();
    }

    function gotoSafeOp() {
      log('[TRANSITION] 主站写 AL Control (0x0120) = 0x04 (SAFEOP 请求)...', 'info');
      const { rxBytes, txBytes } = calcPdoSizes();
      log('[APPL_GenerateMapping] 从站计算当前生效 PDO 长度：RxPDO (SM2)=' + rxBytes + ' 字节, TxPDO (SM3)=' + txBytes + ' 字节', 'info');

      if (faultRxSize) {
        hasError = true;
        alStatusCode = 0x001D;
        alStatusName = 'Invalid output configuration';
        log('[ERROR 0x001D] CheckSmSettings 失败：主站写入 SM2 寄存器长度(8 字节) 与 从站 APPL_GenerateMapping 计算值(' + rxBytes + ' 字节) 不相等！常见于 0x1C12 动态映射或 Slot 步进错位。', 'error');
      } else if (faultTxSize) {
        hasError = true;
        alStatusCode = 0x001E;
        alStatusName = 'Invalid input configuration';
        log('[ERROR 0x001E] CheckSmSettings 失败：主站写入 SM3 长度与从站 TxPDO 计算值(' + txBytes + ' 字节) 不一致！', 'error');
      } else {
        currentState = 'SAFEOP';
        hasError = false;
        alStatusCode = 0x0000;
        alStatusName = 'No error';
        log('[SUCCESS] SM2/SM3 长度完全匹配，FMMU 逻辑地址映射生效，启动从站 SM3 输入采集上传！', 'success');
      }
      updateUI();
    }

    function gotoOp() {
      log('[TRANSITION] 主站写 AL Control (0x0120) = 0x08 (OP 请求)...', 'info');
      if (faultDcSync) {
        hasError = true;
        alStatusCode = 0x002C;
        alStatusName = 'Fatal sync error';
        log('[ERROR 0x002C] DC 分布式时钟校验失败：ESC 未在限定窗口内检测到 SYNC0 锁相中断！检查 LAN9252 SYNC0 引脚与 EXTI 中断配置。', 'error');
      } else {
        currentState = 'OP';
        hasError = false;
        alStatusCode = 0x0000;
        alStatusName = 'No error';
        log('[SUCCESS] 收到主站持续周期性过程数据帧，释放硬件输出锁：SM2 输出驱动物理设备，进入全功能闭环 OP 状态！', 'success');
      }
      updateUI();
    }

    function triggerWatchdogTimeout() {
      if (currentState !== 'OP') {
        log('[WARN] 看门狗超时故障注入仅在 OP 状态下有效！', 'warn');
        return;
      }
      log('[FAULT INJECT] 主站突发中断发送周期过程数据帧，ESC 的 SM2 过程数据看门狗超时！', 'error');
      currentState = 'SAFEOP';
      hasError = true;
      alStatusCode = 0x001B;
      alStatusName = 'Sync manager watchdog';
      log('[ERROR 0x001B] 从站紧急切回 SAFEOP + ERROR，立即关闭 SM2 输出以保现场安全！排查方向：网线掉线、MCU 中断死锁或 ESC_IRQ 丢失。', 'error');
      updateUI();
    }

    function resetToInit() {
      currentState = 'INIT';
      hasError = false;
      alStatusCode = 0x0000;
      alStatusName = 'No error';
      log('[RESET] 从站复位至 INIT 初始状态，关闭所有 SyncManager 与过程数据。', 'normal');
      updateUI();
    }

    root.querySelector('#ecat-btn-to-preop')?.addEventListener('click', gotoPreOp);
    root.querySelector('#ecat-btn-to-safeop')?.addEventListener('click', gotoSafeOp);
    root.querySelector('#ecat-btn-to-op')?.addEventListener('click', gotoOp);
    root.querySelector('#ecat-btn-to-init')?.addEventListener('click', resetToInit);
    root.querySelector('#ecat-btn-fault-wd')?.addEventListener('click', triggerWatchdogTimeout);

    root.querySelector('#ecat-fault-mbx')?.addEventListener('change', (e) => { faultMbxSize = e.target.checked; });
    root.querySelector('#ecat-fault-rx')?.addEventListener('change', (e) => { faultRxSize = e.target.checked; });
    root.querySelector('#ecat-fault-tx')?.addEventListener('change', (e) => { faultTxSize = e.target.checked; });
    root.querySelector('#ecat-fault-dc')?.addEventListener('change', (e) => { faultDcSync = e.target.checked; });

    modules.forEach(m => {
      root.querySelector('#ecat-mod-' + m.id)?.addEventListener('change', (e) => {
        m.active = e.target.checked;
        calcPdoSizes();
        log('[DYNAMIC PDO] SDO 更新模块列表：' + m.name + ' ➔ ' + (m.active ? '使能' : '禁用'), 'info');
      });
    });

    calcPdoSizes();
    updateUI();
    log('[INIT] EtherCAT 从站协议栈初始化就绪：当前处于 INIT 状态', 'normal');
  }


  /* ========================================================
     Interactive Simulator 9: W25Q128 Non-blocking Flash Driver
     ======================================================== */
  function initW25q128Simulator() {
    const root = document.getElementById('w25q-demo-app');
    if (!root) return;

    let isNonBlocking = true;
    let isOperating = false;
    let opType = 'IDLE';
    let opProgress = 0;
    let totalOpTimeMs = 0;
    let elapsedMs = 0;

    let mainLoopJitterMs = 0.15;
    let queueCount = 2;
    let iwdgRemainingMs = 1000;

    const elModeBtn = root.querySelector('#w25q-mode-toggle');
    const elJitterVal = root.querySelector('#w25q-jitter-val');
    const elJitterBar = root.querySelector('#w25q-jitter-bar');
    const elQueueVal = root.querySelector('#w25q-queue-val');
    const elQueueBar = root.querySelector('#w25q-queue-bar');
    const elIwdgVal = root.querySelector('#w25q-iwdg-val');
    const elIwdgBar = root.querySelector('#w25q-iwdg-bar');
    const elLedWel = root.querySelector('#w25q-led-wel');
    const elLedBusy = root.querySelector('#w25q-led-busy');
    const elChipStateText = root.querySelector('#w25q-chip-state-text');
    const elLog = root.querySelector('#w25q-log');

    const seg0 = root.querySelector('#w25q-seg-0');
    const seg1 = root.querySelector('#w25q-seg-1');
    const seg2 = root.querySelector('#w25q-seg-2');

    function log(msg, type) {
      if (!elLog) return;
      const time = new Date().toTimeString().split(' ')[0] + '.' + Math.floor(performance.now() % 1000).toString().padStart(3, '0');
      let color = '#d4d4d4';
      if (type === 'error') color = '#ef4444';
      if (type === 'success') color = '#10b981';
      if (type === 'warn') color = '#f59e0b';
      if (type === 'info') color = '#38bdf8';
      const div = document.createElement('div');
      div.style.color = color;
      div.innerHTML = '[' + time + '] ' + msg;
      elLog.appendChild(div);
      elLog.scrollTop = elLog.scrollHeight;
    }

    function updateMeters() {
      if (elJitterVal) elJitterVal.textContent = mainLoopJitterMs.toFixed(2) + ' ms';
      if (elJitterBar) {
        const pct = Math.min(100, (mainLoopJitterMs / 90) * 100);
        elJitterBar.style.width = pct + '%';
        elJitterBar.className = 'w25q-meter-fill' + (mainLoopJitterMs > 50 ? ' danger' : mainLoopJitterMs > 5 ? ' warn' : '');
      }

      if (elQueueVal) elQueueVal.textContent = queueCount + ' / 255 帧';
      if (elQueueBar) {
        const pct = (queueCount / 255) * 100;
        elQueueBar.style.width = pct + '%';
        elQueueBar.className = 'w25q-meter-fill' + (queueCount > 200 ? ' danger' : queueCount > 50 ? ' warn' : '');
      }

      if (elIwdgVal) elIwdgVal.textContent = Math.round(iwdgRemainingMs) + ' ms';
      if (elIwdgBar) {
        const pct = (iwdgRemainingMs / 1000) * 100;
        elIwdgBar.style.width = pct + '%';
        elIwdgBar.className = 'w25q-meter-fill' + (iwdgRemainingMs < 200 ? ' danger' : iwdgRemainingMs < 500 ? ' warn' : '');
      }

      if (elLedBusy) elLedBusy.classList.toggle('busy', isOperating);
      if (elLedWel) elLedWel.classList.toggle('active', isOperating);
      if (elChipStateText) {
        if (!isOperating) elChipStateText.textContent = 'STANDBY (空闲就绪)';
        else elChipStateText.textContent = opType + ' 进行中 (' + Math.round(opProgress) + '%)...';
      }
    }

    function startOperation(type, durationMs, desc) {
      if (isOperating) {
        log('[WARN] 上一次 Flash 写入/擦除尚未完成 (硬件 BUSY=1)！', 'warn');
        return;
      }

      isOperating = true;
      opType = type;
      totalOpTimeMs = durationMs;
      elapsedMs = 0;
      opProgress = 0;

      log('[START] 发送 0x06 (Write Enable) ➔ 校验 WEL=1 ➔ 下发指令 ' + desc, 'info');

      if (!isNonBlocking) {
        log('[BLOCKING] 主循环调用阻塞函数，原地死等 while(BUSY == 1)... 耗时约 ' + durationMs + ' ms！', 'warn');
        mainLoopJitterMs = durationMs;
        queueCount = Math.min(255, Math.floor(queueCount + durationMs * 2.4));
        iwdgRemainingMs = Math.max(0, iwdgRemainingMs - durationMs);
        updateMeters();

        setTimeout(() => {
          isOperating = false;
          opProgress = 100;
          mainLoopJitterMs = 0.15;
          const drain = setInterval(() => {
            if (queueCount > 2) {
              queueCount -= 15;
              if (queueCount < 2) queueCount = 2;
              updateMeters();
            } else {
              clearInterval(drain);
            }
          }, 30);
          iwdgRemainingMs = 1000;
          log('[BLOCKING COMPLETE] 硬件 BUSY 清零，拉高 /CS，主循环终于恢复调度！', 'success');
          updateMeters();
        }, 1200);
      } else {
        log('[NON-BLOCKING] 下发指令与地址(耗时 < 0.2ms) ➔ 拉高 /CS ➔ 立即返回主循环，开启非阻塞轮询状态机！', 'success');
        mainLoopJitterMs = 0.18;
        queueCount = 2;
        updateMeters();

        const stepTime = 50;
        const interval = setInterval(() => {
          elapsedMs += stepTime * (durationMs / 600);
          opProgress = Math.min(100, (elapsedMs / durationMs) * 100);

          queueCount = 1 + Math.floor(Math.random() * 2);
          mainLoopJitterMs = 0.15 + (Math.random() * 0.05);
          iwdgRemainingMs = 998;

          if (type === 'MULTI_PAGE') {
            if (opProgress > 15 && seg0) seg0.classList.add('active');
            if (opProgress > 65 && seg1) seg1.classList.add('active');
            if (opProgress >= 99 && seg2) seg2.classList.add('active');
          }

          updateMeters();

          if (elapsedMs >= durationMs) {
            clearInterval(interval);
            isOperating = false;
            opProgress = 100;
            log('[POLL COMPLETE] W25q128_PollOperation 检测到 BUSY=0，事务平稳完成！主循环全程零卡顿！', 'success');
            updateMeters();
          }
        }, stepTime);
      }
    }

    root.querySelector('#w25q-btn-erase')?.addEventListener('click', () => {
      startOperation('SECTOR_ERASE', 88, '0x20 扇区擦除 (4 KiB, 地址 0x001000)');
    });

    root.querySelector('#w25q-btn-prog')?.addEventListener('click', () => {
      startOperation('PAGE_PROGRAM', 5, '0x02 单页编程 (256 B, 地址 0x001000)');
    });

    root.querySelector('#w25q-btn-multipage')?.addEventListener('click', () => {
      if (seg0) seg0.classList.remove('active');
      if (seg1) seg1.classList.remove('active');
      if (seg2) seg2.classList.remove('active');

      log('[MULTI-PAGE WRITE] 用户发起 500 字节写入，起始地址 0x0010E0：', 'info');
      log('  ├─ Chunk 1: 0x0010E0..0x0010FF (256 - 0xE0 = 32 字节，跨页尾截断)', 'info');
      log('  ├─ Chunk 2: 0x001100..0x0011FF (满整页 256 字节)', 'info');
      log('  └─ Chunk 3: 0x001200..0x0012D3 (剩余 212 字节)', 'info');

      startOperation('MULTI_PAGE', 60, '自动拆分 3 笔页编程事务');
    });

    if (elModeBtn) {
      elModeBtn.addEventListener('click', () => {
        if (isOperating) {
          log('[WARN] 操作进行中，无法切换驱动工作模式！', 'warn');
          return;
        }
        isNonBlocking = !isNonBlocking;
        elModeBtn.textContent = isNonBlocking ? '切换为：阻塞轮询 while(BUSY)' : '切换为：非阻塞状态机驱动';
        const modeBadge = root.querySelector('#w25q-mode-badge');
        if (modeBadge) {
          modeBadge.textContent = isNonBlocking ? '当前模式：非阻塞状态机 (推荐)' : '当前模式：阻塞轮询 while(BUSY) (高危)';
          modeBadge.className = 'ecat-status-val' + (isNonBlocking ? '' : ' error');
        }
        log('[MODE SWITCH] 驱动模式已切换为：' + (isNonBlocking ? '非阻塞异步状态机' : '阻塞轮询 while(BUSY)'), 'warn');
      });
    }

    updateMeters();
    log('[INIT] W25Q128 SPI NOR Flash 驱动仿真器就绪：默认采用非阻塞状态机架构', 'normal');
  }


  // 11. 专题/系列阅读导航与目录交互 (Steph Ango & Eli Bendersky 风格)
  function initSeriesNav() {
    const dropdown = document.querySelector('#series-toc-dropdown');
    if (!dropdown) return;

    // 点击页面外部区域时自动收起目录面板
    document.addEventListener('click', (e) => {
      if (dropdown.open && !dropdown.contains(e.target)) {
        dropdown.open = false;
      }
    });

    // 按下 ESC 键时收起目录
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.open) {
        dropdown.open = false;
        dropdown.querySelector('summary')?.focus();
      }
    });
  }

  // 10. N32G455 三路 SPI 架构与 DMA1 硬件仲裁实验室
  function initSpiDmaSimulator() {
    const root = document.getElementById('spi-dma-demo-app');
    if (!root) return;

    const logEl = root.querySelector('#spi-dma-log');
    const log = (msg, level = 'normal') => {
      if (!logEl) return;
      const row = document.createElement('div');
      row.className = `aiw-log-line ${level === 'warn' ? 'aiw-log-warn' : (level === 'danger' ? 'aiw-log-error' : (level === 'success' ? 'aiw-log-success' : ''))}`;
      const time = new Date().toTimeString().slice(0, 8);
      row.innerHTML = `<span class="aiw-log-time">[${time}]</span> <span class="aiw-log-msg">${msg}</span>`;
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    };

    root.querySelector('#btn-clear-spilog')?.addEventListener('click', () => {
      if (logEl) logEl.innerHTML = '';
    });

    // --- Tab Navigation ---
    const tabBtns = root.querySelectorAll('.spi-dma-tab-btn');
    const views = root.querySelectorAll('.spi-dma-view');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabBtns.forEach(b => {
          const isActive = b === btn;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        views.forEach(v => {
          const isMatch = v.id === `spi-view-${targetTab}`;
          v.classList.toggle('is-active', isMatch);
          v.hidden = !isMatch;
        });
      });
    });

    // --- Tab 1: Clock Tree & SCLK Evaluation ---
    const spi1Select = root.querySelector('#spi1-prescaler');
    const spi2Select = root.querySelector('#spi2-prescaler');
    const spi3Select = root.querySelector('#spi3-prescaler');

    function updateClocks() {
      // SPI1 on APB2 (64 MHz)
      if (spi1Select) {
        const div1 = parseInt(spi1Select.value, 10);
        const sclk1 = 64 / div1;
        const period1 = (1000 / sclk1).toFixed(2);
        root.querySelector('#spi1-sclk').textContent = `${sclk1.toFixed(1)} MHz`;
        root.querySelector('#spi1-period').textContent = `${period1} ns`;
        const evalText1 = root.querySelector('#spi1-eval-text');
        const evalIcon1 = root.querySelector('#spi1-eval .spi-eval-icon');
        if (sclk1 > 32) {
          evalIcon1.className = 'spi-eval-icon warn';
          evalText1.textContent = `SCLK 为 ${sclk1.toFixed(1)} MHz：写操作可用（上限~66MHz），但若执行 RDDID 等读操作将严重违规（读上限 6.6MHz）！`;
        } else {
          evalIcon1.className = 'spi-eval-icon success';
          evalText1.textContent = 'ST7789 像素写入周期约 15ns (最高~66MHz)，当前处于高速安全范围。';
        }
      }

      // SPI2 on APB1 (32 MHz)
      if (spi2Select) {
        const div2 = parseInt(spi2Select.value, 10);
        const sclk2 = 32 / div2;
        const period2 = (1000 / sclk2).toFixed(1);
        root.querySelector('#spi2-sclk').textContent = `${sclk2.toFixed(1)} MHz`;
        root.querySelector('#spi2-period').textContent = `${period2} ns`;
        const evalText2 = root.querySelector('#spi2-eval-text');
        const evalIcon2 = root.querySelector('#spi2-eval .spi-eval-icon');
        if (sclk2 > 4.9) {
          evalIcon2.className = 'spi-eval-icon danger';
          evalText2.textContent = `严重超频 (${sclk2.toFixed(1)} MHz)！AD7190 手册硬性上限 4.9 MHz，将导致 Sinc4 滤波器锁死与采样数据全 0xFF！`;
        } else if (sclk2 === 4.0) {
          evalIcon2.className = 'spi-eval-icon success';
          evalText2.textContent = 'AD7190 最大容许 SCLK 为 4.9 MHz。4 MHz 满足手册规范且保留了 18% 时序裕量。';
        } else {
          evalIcon2.className = 'spi-eval-icon success';
          evalText2.textContent = `AD7190 运行于 ${sclk2.toFixed(1)} MHz，处于安全工作区间。`;
        }
      }

      // SPI3 on APB1 (32 MHz)
      if (spi3Select) {
        const div3 = parseInt(spi3Select.value, 10);
        const sclk3 = 32 / div3;
        const period3 = (1000 / sclk3).toFixed(1);
        root.querySelector('#spi3-sclk').textContent = `${sclk3.toFixed(1)} MHz`;
        root.querySelector('#spi3-period').textContent = `${period3} ns`;
        const evalText3 = root.querySelector('#spi3-eval-text');
        const evalIcon3 = root.querySelector('#spi3-eval .spi-eval-icon');
        evalIcon3.className = 'spi-eval-icon success';
        evalText3.textContent = `W25Q128 支持高达 104 MHz。当前 ${sclk3.toFixed(1)} MHz 处于高可靠抗干扰轮询区间。`;
      }
    }

    [spi1Select, spi2Select, spi3Select].forEach(sel => {
      sel?.addEventListener('change', () => {
        updateClocks();
        log(`[RCC/SPI] 分频系数已更新：SPI1=${spi1Select.value}分频, SPI2=${spi2Select.value}分频, SPI3=${spi3Select.value}分频`);
      });
    });

    // --- Tab 2: DMA1 Arbiter Simulator ---
    const channels = {
      ch4: { name: 'DMA1_CH4 (AD7190 RX)', prio: 3, prioName: 'Very High', total: 4, cndtr: 0, elBar: root.querySelector('#dma-bar-ch4'), elVal: root.querySelector('#dma-cndtr-ch4'), elCard: root.querySelector('#dma-card-ch4') },
      ch5: { name: 'DMA1_CH5 (AD7190 TX)', prio: 2, prioName: 'High', total: 4, cndtr: 0, elBar: root.querySelector('#dma-bar-ch5'), elVal: root.querySelector('#dma-cndtr-ch5'), elCard: root.querySelector('#dma-card-ch5') },
      ch1: { name: 'DMA1_CH1 (LCD RX)', prio: 1, prioName: 'Medium', total: 1920, cndtr: 0, elBar: root.querySelector('#dma-bar-ch1'), elVal: root.querySelector('#dma-cndtr-ch1'), elCard: root.querySelector('#dma-card-ch1') },
      ch2: { name: 'DMA1_CH2 (LCD TX)', prio: 1, prioName: 'Medium', total: 1920, cndtr: 0, elBar: root.querySelector('#dma-bar-ch2'), elVal: root.querySelector('#dma-cndtr-ch2'), elCard: root.querySelector('#dma-card-ch2') },
    };

    const busSlotsEl = root.querySelector('#dma-bus-slots');
    const busOwnerEl = root.querySelector('#dma-bus-owner');
    let busHistory = Array(16).fill('IDLE');
    let dmaTimer = null;

    function renderSlots() {
      if (!busSlotsEl) return;
      busSlotsEl.innerHTML = '';
      busHistory.forEach(slot => {
        const d = document.createElement('div');
        d.className = 'dma-bus-slot';
        if (slot === 'CH4') { d.className += ' slot-ch4'; d.textContent = 'CH4 RX'; }
        else if (slot === 'CH5') { d.className += ' slot-ch5'; d.textContent = 'CH5 TX'; }
        else if (slot === 'CH2') { d.className += ' slot-ch2'; d.textContent = 'CH2 TX'; }
        else if (slot === 'CH1') { d.className += ' slot-ch1'; d.textContent = 'CH1 RX'; }
        else { d.textContent = 'IDLE'; }
        busSlotsEl.appendChild(d);
      });
    }

    function updateChannelUI() {
      Object.keys(channels).forEach(k => {
        const ch = channels[k];
        if (ch.elVal) ch.elVal.textContent = ch.cndtr;
        const pct = ch.total > 0 ? Math.min(100, Math.max(0, ((ch.total - ch.cndtr) / ch.total) * 100)) : 0;
        if (ch.elBar) ch.elBar.style.width = `${pct.toFixed(0)}%`;
      });
    }

    function stepDmaBus() {
      let winner = null;
      let slotCode = 'IDLE';

      // Hardware arbiter priority: Very High (CH4) > High (CH5) > Medium (CH2/CH1)
      if (channels.ch4.cndtr > 0) {
        winner = channels.ch4;
        slotCode = 'CH4';
        channels.ch4.cndtr = Math.max(0, channels.ch4.cndtr - 1);
        if (channels.ch4.cndtr === 0) {
          log('[DMA1_CH4 TC] AD7190 24-bit 连续采样帧接收完毕！触发 DMA1_Channel4_IRQHandler 并压入环形队列', 'success');
        }
      } else if (channels.ch5.cndtr > 0) {
        winner = channels.ch5;
        slotCode = 'CH5';
        channels.ch5.cndtr = Math.max(0, channels.ch5.cndtr - 1);
      } else if (channels.ch2.cndtr > 0) {
        winner = channels.ch2;
        slotCode = 'CH2';
        const stepItems = 120;
        channels.ch2.cndtr = Math.max(0, channels.ch2.cndtr - stepItems);
        channels.ch1.cndtr = channels.ch2.cndtr;
        if (channels.ch2.cndtr === 0) {
          log('[DMA1_CH1 TC] LCD 8行条带 1920 像素传输完成！置位完成标志，等待 BSY 清零后拉高 CS', 'success');
        }
      }

      busHistory.shift();
      busHistory.push(slotCode);
      renderSlots();

      // Highlight active card
      Object.keys(channels).forEach(k => {
        const card = channels[k].elCard;
        if (card) card.classList.toggle('is-active-bus', winner === channels[k]);
      });

      if (busOwnerEl) {
        busOwnerEl.textContent = winner ? `总线占有：${winner.name} [${winner.prioName}]` : '总线状态：空闲 (IDLE)';
      }

      updateChannelUI();
      return !!winner;
    }

    root.querySelector('#btn-start-lcd')?.addEventListener('click', () => {
      channels.ch1.cndtr = 1920;
      channels.ch2.cndtr = 1920;
      updateChannelUI();
      log('[LCD DMA] 启动 240x8 像素条带传输 (1920 像素 / 16-bit) -> 映射至 DMA1_CH1/CH2 (Medium 优先级)', 'normal');
    });

    root.querySelector('#btn-trigger-ad7190')?.addEventListener('click', () => {
      channels.ch4.cndtr = 4;
      channels.ch5.cndtr = 4;
      updateChannelUI();
      log('[EXTI14] AD7190 PB14 DOUT/RDY 下降沿触发！申请 DMA1_CH4 (Very High) / CH5 (High) 瞬时抢占总线', 'warn');
    });

    root.querySelector('#btn-step-dma')?.addEventListener('click', () => {
      stepDmaBus();
    });

    const autoBtn = root.querySelector('#btn-auto-dma');
    autoBtn?.addEventListener('click', () => {
      if (dmaTimer) {
        clearInterval(dmaTimer);
        dmaTimer = null;
        autoBtn.textContent = '连续运行';
      } else {
        autoBtn.textContent = '暂停运行';
        dmaTimer = setInterval(() => {
          const hasWork = stepDmaBus();
          if (!hasWork && channels.ch2.cndtr === 0 && channels.ch4.cndtr === 0) {
            clearInterval(dmaTimer);
            dmaTimer = null;
            autoBtn.textContent = '连续运行';
          }
        }, 120);
      }
    });

    root.querySelector('#btn-reset-dma')?.addEventListener('click', () => {
      if (dmaTimer) { clearInterval(dmaTimer); dmaTimer = null; }
      if (autoBtn) autoBtn.textContent = '连续运行';
      Object.keys(channels).forEach(k => { channels[k].cndtr = 0; });
      busHistory = Array(16).fill('IDLE');
      renderSlots();
      updateChannelUI();
      if (busOwnerEl) busOwnerEl.textContent = '总线状态：空闲 (IDLE)';
      Object.keys(channels).forEach(k => channels[k].elCard?.classList.remove('is-active-bus'));
      log('[DMA1] 总线仲裁器已复位');
    });

    renderSlots();
    updateChannelUI();

    // --- Tab 3: Full Duplex & Pitfalls Sandbox ---
    let currentScenario = 'correct';
    let pitfallStep = 0;
    let pitfallTimer = null;

    const scenarios = {
      correct: [
        { desc: '【空闲就绪态】SPI1 关闭，CS 处于高电平非选中态，RXNE=0, TXE=1, BSY=0。', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 0, exti: 1 },
        { desc: '【第 1 步：配置并使能 RX DMA】DMA1_CH1 使能并指向丢弃接收缓冲区。此时 RX 通道处于监听就绪态。', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 0, exti: 1 },
        { desc: '【第 2 步：配置并使能 TX DMA】DMA1_CH2 使能，拉低 CS。TX DMA 立即将首个 16-bit 像素写入 SPI_DR，SCLK 开始翻转振荡！', rxne: 0, txe: 0, bsy: 1, ovr: 0, tc: 0, exti: 1 },
        { desc: '【第 3 步：全双工时钟同步】SCLK 驱动从机返回数据，移位寄存器装满触发 RXNE=1；RX DMA 硬件请求几乎同时响应并清零 RXNE，数据零延迟转存！', rxne: 0, txe: 1, bsy: 1, ovr: 0, tc: 0, exti: 1 },
        { desc: '【第 4 步：传输收尾与释放 CS】1920 像素传输完成，RX TC 中断置位。主循环确认 BSY 清零后释放 CS 并恢复 8-bit。通信完美无误！', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 1, exti: 1, success: true }
      ],
      'wrong-order': [
        { desc: '【空闲就绪态】待测状态：准备演示“先开 TX 后开 RX”的经典硬件越界时序。', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 0, exti: 1 },
        { desc: '【致命第 1 步：错误先开启 TX DMA】TX DMA 刚使能便立即向 SPI_DR 写入首字，硬件 SCLK 瞬间迸发！', rxne: 0, txe: 0, bsy: 1, ovr: 0, tc: 0, exti: 1, warn: true },
        { desc: '【致命第 2 步：从机响应返回】首个数据帧到达 SPI 移位寄存器并置位 RXNE=1；但此时 RX DMA 根本尚未开启，无人搬移数据！', rxne: 1, txe: 1, bsy: 1, ovr: 0, tc: 0, exti: 1, warn: true },
        { desc: '【硬件灾难发生：OVR 溢出触发】第二个数据字随时钟移入，由于前一数据尚未读出，SPI 硬件强制置位 OVR (Overrun Error) 标志！首字节被直接冲刷丢弃！', rxne: 1, txe: 1, bsy: 1, ovr: 1, tc: 0, exti: 1, danger: true },
        { desc: '【事故结论】随后即便使能 RX DMA，首字节已永久丢失，后续接收全部错位错包，通信全面崩溃！', rxne: 0, txe: 1, bsy: 0, ovr: 1, tc: 0, exti: 1, danger: true }
      ],
      'exti-storm': [
        { desc: '【空闲态】AD7190 CS 保持低电平，PB14 被配置为 EXTI14 下降沿触发。', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 0, exti: 1 },
        { desc: '【第 1 步：采样就绪触发】AD7190 DOUT/RDY 变低电平，触发 EXTI15_10_IRQHandler。', rxne: 0, txe: 1, bsy: 0, ovr: 0, tc: 0, exti: 1, warn: true },
        { desc: '【致命疏漏：未关闭 EXTI14】驱动在未清挂起且未禁用 EXTI14 的情况下直接使能 SPI2 DMA 发送 dummy byte！', rxne: 0, txe: 0, bsy: 1, ovr: 0, tc: 0, exti: 1, warn: true },
        { desc: '【边沿陷阱爆发：MISO 数据跳变】PB14 兼作 MISO，随数据位（如 0x55、0xA0）高低快速翻转，多次产生虚假下降沿！', rxne: 1, txe: 1, bsy: 1, ovr: 0, tc: 0, exti: 1, danger: true },
        { desc: '【死锁灾难：中断风暴】EXTI14 在 DMA 传输中被重入触发数十次，CPU 彻底卡死在 ISR 中，主循环与喂狗全被饿死！必须在 DMA 启动前关 EXTI14！', rxne: 1, txe: 1, bsy: 1, ovr: 0, tc: 0, exti: 1, danger: true }
      ]
    };

    function renderPitfall() {
      const steps = scenarios[currentScenario];
      const cur = steps[Math.min(pitfallStep, steps.length - 1)];

      const regRxne = root.querySelector('#reg-rxne');
      const regTxe = root.querySelector('#reg-txe');
      const regBsy = root.querySelector('#reg-bsy');
      const regOvr = root.querySelector('#reg-ovr');
      const regTc = root.querySelector('#reg-tc');
      const regExti = root.querySelector('#reg-exti');
      const descEl = root.querySelector('#pitfall-desc-text');

      if (regRxne) { regRxne.textContent = `RXNE: ${cur.rxne}`; regRxne.classList.toggle('active', cur.rxne === 1); }
      if (regTxe) { regTxe.textContent = `TXE: ${cur.txe}`; regTxe.classList.toggle('active', cur.txe === 1); }
      if (regBsy) { regBsy.textContent = `BSY: ${cur.bsy}`; regBsy.classList.toggle('active', cur.bsy === 1); }
      if (regOvr) { regOvr.textContent = `OVR: ${cur.ovr}`; regOvr.classList.toggle('active', cur.ovr === 1); }
      if (regTc) { regTc.textContent = `TCIF: ${cur.tc}`; regTc.classList.toggle('active', cur.tc === 1); }
      if (regExti) { regExti.textContent = `EXTI14: ${cur.exti ? 'EN' : 'DIS'}`; regExti.classList.toggle('active', cur.exti === 1); }

      if (descEl) descEl.textContent = cur.desc;
    }

    const choiceBtns = root.querySelectorAll('.pitfall-choice');
    choiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        choiceBtns.forEach(b => {
          const isActive = b === btn;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
        currentScenario = btn.getAttribute('data-scenario') || 'correct';
        pitfallStep = 0;
        if (pitfallTimer) { clearInterval(pitfallTimer); pitfallTimer = null; root.querySelector('#btn-pitfall-run').textContent = '自动演练'; }
        renderPitfall();
        log(`[PITFALL LAB] 切换实验场景为：${btn.querySelector('strong').textContent.trim()}`);
      });
    });

    const stepPitfallBtn = root.querySelector('#btn-pitfall-step');
    stepPitfallBtn?.addEventListener('click', () => {
      const maxSteps = scenarios[currentScenario].length;
      pitfallStep = (pitfallStep + 1) % maxSteps;
      renderPitfall();
      const cur = scenarios[currentScenario][pitfallStep];
      log(`[STEP ${pitfallStep}] ${cur.desc}`, cur.danger ? 'danger' : (cur.warn ? 'warn' : 'normal'));
    });

    const runPitfallBtn = root.querySelector('#btn-pitfall-run');
    runPitfallBtn?.addEventListener('click', () => {
      if (pitfallTimer) {
        clearInterval(pitfallTimer);
        pitfallTimer = null;
        runPitfallBtn.textContent = '自动演练';
      } else {
        runPitfallBtn.textContent = '暂停演练';
        pitfallTimer = setInterval(() => {
          const maxSteps = scenarios[currentScenario].length;
          pitfallStep++;
          if (pitfallStep >= maxSteps) {
            clearInterval(pitfallTimer);
            pitfallTimer = null;
            runPitfallBtn.textContent = '自动演练';
            pitfallStep = maxSteps - 1;
          }
          renderPitfall();
          const cur = scenarios[currentScenario][pitfallStep];
          log(`[STEP ${pitfallStep}] ${cur.desc}`, cur.danger ? 'danger' : (cur.warn ? 'warn' : 'normal'));
        }, 1200);
      }
    });

    root.querySelector('#btn-pitfall-reset')?.addEventListener('click', () => {
      if (pitfallTimer) { clearInterval(pitfallTimer); pitfallTimer = null; }
      if (runPitfallBtn) runPitfallBtn.textContent = '自动演练';
      pitfallStep = 0;
      renderPitfall();
      log('[PITFALL LAB] 实验场景已复位至初始就绪态');
    });

    renderPitfall();
    updateClocks();
    log('[INIT] N32G455 SPI & DMA 硬件仿真实验室就绪：时钟分频/DMA1仲裁/全双工避坑已激活', 'normal');
  }

  // 初始化所有已挂载的交互组件（增加错误隔离保护）
  [
    initFsmSimulator,
    initFlashSimulator,
    initSchedulerSimulator,
    initEepromSimulator,
    initRgb565Simulator,
    initLcdStripSimulator,
    initFontSimulator,
    initEcatEsmSimulator,
    initW25q128Simulator,
    initSpiDmaSimulator,
    initSeriesNav,
  ].forEach((sim) => {
    try {
      sim();
    } catch (err) {
      console.warn('[Widget] Failed to initialize simulator:', sim.name, err);
    }
  });
})();
