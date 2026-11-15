(() => {
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

      if (type !== 'MULTI_PAGE') {
        if (seg0) seg0.classList.remove('active');
        if (seg1) seg1.classList.remove('active');
        if (seg2) seg2.classList.remove('active');
      }

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

  try {
    initW25q128Simulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initW25q128Simulator', err);
  }
})();
