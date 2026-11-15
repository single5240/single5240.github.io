(() => {
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
      if (currentState !== 'INIT' && currentState !== 'SAFEOP') {
        log('[REJECT 0x0011] 状态机跳转违规：仅允许从 INIT 升至 PREOP，或从 SAFEOP 降至 PREOP！当前为 ' + currentState, 'warn');
        return;
      }
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
      if (currentState !== 'PREOP' && currentState !== 'OP') {
        log('[REJECT 0x0011] 状态机跳转违规：仅允许从 PREOP 升至 SAFEOP，或从 OP 降至 SAFEOP！当前为 ' + currentState, 'warn');
        return;
      }
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
      if (currentState !== 'SAFEOP') {
        log('[REJECT 0x0011] 状态机跳转违规：必须先进入 SAFEOP 验证过程数据后，方可请求 OP！当前为 ' + currentState, 'warn');
        return;
      }
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

  try {
    initEcatEsmSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initEcatEsmSimulator', err);
  }
})();
