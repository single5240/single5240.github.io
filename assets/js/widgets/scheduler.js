(() => {
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
        const isTail = (i === rTail);
        let ptr = '';
        if (isHead && (isTail || rCount === 0)) ptr = 'H/T';
        else if (isHead) ptr = 'Head';
        else if (isTail && rCount > 0) ptr = 'Tail';
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
      let anyL0 = false;
      let anyL1 = false;
      let anyL2 = false;

      for (let step = 0; step < msToAdd; step++) {
        currentTick += 1;

        // Level 0: 1 ms 高频输入与消抖
        if ((currentTick - lastTick1ms) >= 1) {
          lastTick1ms = currentTick;
          countL0++;
          anyL0 = true;
        }

        // Level 1: 10 ms 测控与算法
        if ((currentTick - lastTick10ms) >= 10) {
          lastTick10ms = currentTick;
          countL1++;
          anyL1 = true;
        }

        // Level 2: 100 ms 低频状态量
        if ((currentTick - lastTick100ms) >= 100) {
          lastTick100ms = currentTick;
          countL2++;
          anyL2 = true;
        }

        // Level 3: 空闲分片任务 (推进条带，空闲时适度消费队列)
        stripIndex = (stripIndex + 1) % 40;
        totalStrips++;

        let consumedEvent = null;
        if (rCount > 0 && (step === 0 || step === Math.floor(msToAdd / 2))) {
          consumedEvent = ringItems[rTail];
          ringItems[rTail] = null;
          rTail = (rTail + 1) % RING_CAP;
          rCount--;
        }

        if (consumedEvent) {
          log(`[CONSUME] UI空闲轮询消费事件: ${consumedEvent} (Tail➔[${rTail}])`, 'success');
        }
      }

      if (anyL2) {
        log(`[LEVEL 2] 100ms周期到达: 检查电池电量与重力方向 (耗时预算 < 300μs)`, 'normal');
      }
      if (anyL1) {
        log(`[LEVEL 1] 10ms周期到达: AD7190力值解算与峰值检测 (耗时预算 < 200μs)`, 'normal');
      }

      // 触发多级协调激活指示高亮脉冲
      if (cardL0) cardL0.classList.add('is-firing');
      if (cardL1 && anyL1) cardL1.classList.add('is-firing');
      if (cardL2 && anyL2) cardL2.classList.add('is-firing');
      if (cardL3) cardL3.classList.add('is-firing');

      setTimeout(() => {
        if (cardL0) cardL0.classList.remove('is-firing');
        if (cardL1) cardL1.classList.remove('is-firing');
        if (cardL2) cardL2.classList.remove('is-firing');
        if (cardL3) cardL3.classList.remove('is-firing');
      }, 180);

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
      pendingLogs.length = 0;
      if (elLog) elLog.textContent = '';
      log('[RESET] 调度器与环形缓冲区已复位，时钟重归 0ms', 'normal');
      renderUI();
    });

    renderUI();
    log('[INIT] 四级分频协作调度器初始化完成：时基 1ms / 10ms / 100ms / Idle', 'normal');
  }

  try {
    initSchedulerSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initSchedulerSimulator', err);
  }
})();
