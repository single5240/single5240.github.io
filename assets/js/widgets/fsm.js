(() => {
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
    let peakHoldCount = 0;
    let alarmCount = 0;
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
        const isTail = (i === tail);
        let ptrText = '';
        if (isHead && (isTail || count === 0)) ptrText = 'H/T';
        else if (isHead) ptrText = 'H';
        else if (isTail && count > 0) ptrText = 'T';
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

      // 动作在状态切换前执行 (语义对齐 C99 内核，并自动推进完整测试生命周期)
      if (match.action === 'Demo_Start') {
        runCount = 0;
        peakHoldCount = 0;
        alarmCount = 0;
      } else if (match.action === 'Demo_RunningLoop') {
        runCount++;
        if (runCount >= 4) {
          log(`[ACTION] 测量计数达 4 次，Demo_RunningLoop 自动投递 EVENT_PEAK 模拟自动检出峰值`, 'event');
          postEvent('EVENT_PEAK');
        }
      } else if (match.action === 'Demo_PeakHold') {
        peakHoldCount = 0;
      } else if (match.action === 'Demo_PeakLoop') {
        peakHoldCount++;
        if (peakHoldCount >= 3) {
          log(`[ACTION] 峰值保持达 3 周期，Demo_PeakLoop 自动投递 EVENT_STOP 归零切回 IDLE`, 'event');
          postEvent('EVENT_STOP');
          peakHoldCount = 0;
        }
      } else if (match.action === 'Demo_Alarm') {
        alarmCount = 0;
      } else if (match.action === 'Demo_AlarmLoop') {
        alarmCount++;
        if (alarmCount >= 5) {
          log(`[ACTION] 报警声光持续 5 周期，Demo_AlarmLoop 自动投递 EVENT_RESET 故障复位回 IDLE`, 'event');
          postEvent('EVENT_RESET');
          alarmCount = 0;
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
      logHistory.length = 0;
      logDirty = true;
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

  try {
    initFsmSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initFsmSimulator', err);
  }
})();
