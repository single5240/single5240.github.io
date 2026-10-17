(() => {
  const content = document.querySelector('.content');
  if (!content) return;
  const toc = document.querySelector('#article-toc');
  const list = toc.querySelector('ol');
  const headings = [...content.querySelectorAll('h2,h3')];
  const links = new Map();
  // Keep existing Markdown anchors stable; generate only missing IDs.
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
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);
        button.textContent = '已复制';
      } catch { button.textContent = '复制失败'; }
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
        log('[WRITE FAIL] 当前数据扇区无可用空槽，需先执行清空或扇区迁移回收', 'error');
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

  // 初始化所有已挂载的交互组件
  initFsmSimulator();
  initFlashSimulator();
  initSchedulerSimulator();
  initEepromSimulator();
  initRgb565Simulator();
  initLcdStripSimulator();
})();
