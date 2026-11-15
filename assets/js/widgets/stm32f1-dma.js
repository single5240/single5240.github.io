(() => {
  function initStm32f1DmaLab() {
    const root = document.getElementById('stm32f1-dma-demo-app');
    if (!root) return;

    // --- Tab switching ---
    const tabBtns = root.querySelectorAll('.f1dma-tab-btn');
    const views = root.querySelectorAll('.f1dma-view');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        views.forEach((v) => {
          const match = v.id === `f1dma-view-${target}`;
          v.classList.toggle('is-active', match);
          v.hidden = !match;
        });
      });
    });

    // --- Logger ---
    const logEl = root.querySelector('#f1dma-log');
    const log = (msg, level = 'normal') => {
      if (!logEl) return;
      const row = document.createElement('div');
      row.className = `aiw-log-line ${
        level === 'warn'
          ? 'aiw-log-warn'
          : level === 'danger'
          ? 'aiw-log-error'
          : level === 'success'
          ? 'aiw-log-success'
          : ''
      }`;
      const time = new Date().toTimeString().slice(0, 8);
      const tSpan = document.createElement('span');
      tSpan.className = 'aiw-log-time';
      tSpan.textContent = `[${time}]`;
      const mSpan = document.createElement('span');
      mSpan.className = 'aiw-log-msg';
      mSpan.textContent = msg;
      row.append(tSpan, ' ', mSpan);
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    };

    root.querySelector('#f1dma-btn-clear-log')?.addEventListener('click', () => {
      if (logEl) logEl.innerHTML = '';
    });

    // --- Tab 1: 3-Byte Pipeline & Tail Truncation Lab ---
    let policy = 'bare-dma'; // 'bare-dma' | 'hal-tc'
    let stepIndex = 0;
    let playTimer = null;

    // Build 8 hardware steps (0..7) conditioned on policy
    function getStepState(step, activePolicy) {
      const bare = activePolicy === 'bare-dma';
      switch (step) {
        case 0:
          return {
            phase: 'T0 / 7 · 参数装载完毕',
            cndtr: 3,
            cndtrText: '3 (待搬运 3 B)',
            shadowIdx: 0,
            sramStates: ['ready', 'ready', 'ready'],
            en: 0,
            dmat: 0,
            req: '待命 (开关未合)',
            tdr: '(空)',
            tdrTag: 'idle',
            shift: '(空)',
            shiftTag: 'idle',
            txe: 1,
            tcif4: 0,
            tc: 0,
            de: 1,
            frames: ['pending', 'pending', 'pending'],
            wireText: '空闲 (待启动)',
            severity: 'normal',
            explain:
              '已完成前置配置：开启 RCC_AHBENR.DMA1EN，设置 CPAR4 = &USART1->DR (0x4001 3804)、CMAR4 = &tx_buf[0]、CNDTR4 = 3，并按规范清除了旧的 USART_SR.TC。此时双开关仍断开。',
          };
        case 1:
          return {
            phase: 'T1 / 7 · 闭合开关，拉起请求 #1',
            cndtr: 3,
            cndtrText: '3 (通道已锁定)',
            shadowIdx: 0,
            sramStates: ['reading', 'ready', 'ready'],
            en: 1,
            dmat: 1,
            req: '请求 #1 触发 (因 TXE=1)',
            tdr: '(空)',
            tdrTag: 'idle',
            shift: '(空)',
            shiftTag: 'idle',
            txe: 1,
            tcif4: 0,
            tc: 0,
            de: 1,
            frames: ['pending', 'pending', 'pending'],
            wireText: 'PA9 准备发送 Frame 1',
            severity: 'normal',
            explain:
              '依次闭合 DMA_CCR4.EN = 1 与 USART_CR3.DMAT = 1。由于 TDR 本身为空 (TXE = 1)，USART1 立刻沿固定请求线向 DMA1 Ch4 发出第 1 次硬件请求。EN = 1 期间硬件禁止改写 CNDTR4/CPAR4/CMAR4。',
          };
        case 2:
          return {
            phase: "T2 / 7 · 'A' 入移位器，TXE 再次置 1",
            cndtr: 2,
            cndtrText: '2 (已搬走 1 B)',
            shadowIdx: 1,
            sramStates: ['done', 'reading', 'ready'],
            en: 1,
            dmat: 1,
            req: '请求 #1 握手完成 → 请求 #2 就绪',
            tdr: "(已移空) → 准备接 'B'",
            tdrTag: 'idle',
            shift: "'A' (0x41) 发送中",
            shiftTag: 'active',
            txe: 1,
            tcif4: 0,
            tc: 0,
            de: 1,
            frames: ['shifting', 'pending', 'pending'],
            wireText: "PA9 正在逐位输出 Frame 1 ('A')",
            severity: 'normal',
            explain:
              "DMA1 Ch4 经 BusMatrix → Bridge 2 → APB2 将 'A' (0x41) 写入 TDR；内部影子指针步进到 tx_buf[1]（但软件读 CMAR4 仍为 &tx_buf[0]），CNDTR4 减为 2。因移位寄存器原本空闲，'A' 瞬间落入移位器开始发送 Frame 1，TDR 立刻腾空并再次置起 TXE = 1。",
          };
        case 3:
          return {
            phase: "T3 / 7 · 'B' 进 TDR 排队等待",
            cndtr: 1,
            cndtrText: '1 (已搬走 2 B)',
            shadowIdx: 2,
            sramStates: ['done', 'done', 'reading'],
            en: 1,
            dmat: 1,
            req: '请求 #2 完成 (TXE 清零)',
            tdr: "'B' (0x42) 排队中",
            tdrTag: 'queued',
            shift: "'A' (0x41) 尾位发送中",
            shiftTag: 'active',
            txe: 0,
            tcif4: 0,
            tc: 0,
            de: 1,
            frames: ['shifting', 'pending', 'pending'],
            wireText: "Frame 1 ('A') 发送中 · 'B' 在 TDR 排队",
            severity: 'normal',
            explain:
              "TXE = 1 触发请求 #2。DMA 读出 'B' (0x42) 写入 TDR，CNDTR4 减为 1，影子指针指向 tx_buf[2]。因为移位器还在发 'A'，'B' 只能留在 TDR 中排队，整个 Frame 1 剩余期间 TXE 保持为 0。",
          };
        case 4:
          return {
            phase: "T4 / 7 · 'C' 入 TDR → TCIF4 = 1！",
            cndtr: 0,
            cndtrText: '0 (DMA 搬运计数归零)',
            shadowIdx: 3,
            sramStates: ['done', 'done', 'done'],
            en: 1,
            dmat: 1,
            req: '请求 #3 完成 → 置位 TCIF4=1！',
            tdr: "'C' (0x43) 刚入队列！",
            tdrTag: 'queued',
            shift: "'B' (0x42) 刚开始发送！",
            shiftTag: 'active',
            txe: 0,
            tcif4: 1,
            tc: 0,
            de: 1,
            frames: ['done', 'shifting', 'pending'],
            wireText: "⚠️ TCIF4=1！此时线上在发 'B'，'C' 还在 TDR！",
            severity: 'warn',
            explain:
              "关键转折点！'A' 停止位一结束，'B' 装入移位器开始发送 Frame 2；TDR 腾空触发请求 #3，DMA 把最后的 'C' (0x43) 写入 TDR，CNDTR4 归零并立刻置起 DMA_ISR.TCIF4 = 1！注意：此时线上 'B' 才刚起步，'C' 甚至还没进移位器！",
          };
        case 5:
          if (bare) {
            return {
              phase: 'T5 / 7 · ❌ 裸 DMA 中断误拉低 DE！',
              cndtr: 0,
              cndtrText: '0 (DMA 已完 · 引脚未完)',
              shadowIdx: 3,
              sramStates: ['done', 'done', 'done'],
              en: 0,
              dmat: 0,
              req: 'ISR 误判“已发完”，强行关闭输出',
              tdr: "'C' 被困死在 TDR 中！",
              tdrTag: 'error',
              shift: "'B' 刚发几 bit 就被截断！",
              shiftTag: 'error',
              txe: 0,
              tcif4: 1,
              tc: 0,
              de: 0,
              frames: ['done', 'truncated', 'lost'],
              wireText: "❌ 丢尾事故！DE=0 切断 'B'，'C' 丢失",
              severity: 'danger',
              explain:
                "【事故发生】程序在 DMA TCIF4=1 中断里直接拉低 RS-485 DE（或关串口 / 拉高 SPI CS）。物理线上 Frame 2 ('B') 的波形当场被截断成乱码，Frame 3 ('C') 连移位寄存器都没进去就直接作废！对应 SPI 屏幕就是条带末尾几像素花屏。",
            };
          }
          return {
            phase: 'T5 / 7 · ✅ TCIF4 后开 TCIE 接力等待',
            cndtr: 0,
            cndtrText: '0 (可安全复用 tx_buf)',
            shadowIdx: 3,
            sramStates: ['reusable', 'reusable', 'reusable'],
            en: 1,
            dmat: 0,
            req: '关 DMAT，开启 USART_CR1.TCIE',
            tdr: "'C' (0x43) 排队等待移位",
            tdrTag: 'queued',
            shift: "'B' (0x42) 正常移位输出",
            shiftTag: 'active',
            txe: 0,
            tcif4: 1,
            tc: 0,
            de: 1,
            frames: ['done', 'shifting', 'pending'],
            wireText: "✅ 保持 DE=1，等待 'B' 与 'C' 发完",
            severity: 'normal',
            explain:
              "【HAL 正确做法】在 DMA 完成中断中：由于所有字节均已读离 SRAM，tx_buf 可安全复用；但绝不拉低 DE / CS，而是关闭 USART_CR3.DMAT，打开串口自身传输完成中断 USART_CR1.TCIE，让硬件继续把 'B' 和 'C' 送出引脚。",
          };
        case 6:
          if (bare) {
            return {
              phase: 'T6 / 7 · 对端收到残缺尾帧',
              cndtr: 0,
              cndtrText: '0',
              shadowIdx: 3,
              sramStates: ['done', 'done', 'done'],
              en: 0,
              dmat: 0,
              req: '总线已提前进入接收态 (DE=0)',
              tdr: "'C' 未发出",
              tdrTag: 'error',
              shift: '波形已于 T5 中断截断',
              shiftTag: 'error',
              txe: 0,
              tcif4: 1,
              tc: 0,
              de: 0,
              frames: ['done', 'truncated', 'lost'],
              wireText: "❌ 接收结果：['A', 帧错误/乱码]（缺失 'C'）",
              severity: 'danger',
              explain:
                "物理引脚在 'B' 发送半途就失去驱动能力（或 SPI 从机因 CS 拉高而忽略后续 SCK）。对于串口协议，末尾永远少 1~2 字节且 CRC 校验失败；对于 ST7789 屏幕，窗口最后几个像素残缺或错位。",
            };
          }
          return {
            phase: 'T6 / 7 · 请求 #4 被忽略，发送 Frame 3',
            cndtr: 0,
            cndtrText: '0 (Normal 忽略 #4 请求)',
            shadowIdx: 3,
            sramStates: ['reusable', 'reusable', 'reusable'],
            en: 1,
            dmat: 0,
            req: 'TDR 腾空产生第4次信号 → 被忽略',
            tdr: '(空) TXE = 1',
            tdrTag: 'idle',
            shift: "'C' (0x43) 正在输出 Frame 3",
            shiftTag: 'active',
            txe: 1,
            tcif4: 1,
            tc: 0,
            de: 1,
            frames: ['done', 'done', 'shifting'],
            wireText: "PA9 正在输出最后一帧 Frame 3 ('C')",
            severity: 'normal',
            explain:
              "Frame 2 ('B') 发完后，'C' 落入移位器开始发 Frame 3；TDR 第四次腾空置起 TXE=1，但 Normal 模式下 CNDTR4=0 且 DMAT 已关闭，不会再产生无效搬运（对应 RM0008 Figure 297 最右侧）。",
          };
        case 7:
        default:
          if (bare) {
            return {
              phase: 'T7 / 7 · 复盘：混淆了两条完成边界',
              cndtr: 0,
              cndtrText: '0',
              shadowIdx: 3,
              sramStates: ['done', 'done', 'done'],
              en: 0,
              dmat: 0,
              req: '请切到「正确做法」对比复现',
              tdr: '(未完即断)',
              tdrTag: 'error',
              shift: '(截断)',
              shiftTag: 'error',
              txe: 0,
              tcif4: 1,
              tc: 0,
              de: 0,
              frames: ['done', 'truncated', 'lost'],
              wireText: '❌ 故障复现完成：切「正确做法」看修复效果',
              severity: 'danger',
              explain:
                '总结：TCIF4=1 仅代表“SRAM 发送缓冲区已不再被 DMA 读取”；凡是要切 RS-485 DE、关串口、进 Stop 休眠或拉高 SPI CS，必须等待外设物理空闲标志（USART_SR.TC == 1 或 SPI_SR.BSY == 0）。',
            };
          }
          return {
            phase: 'T7 / 7 · ✅ USART_SR.TC = 1，物理发完！',
            cndtr: 0,
            cndtrText: '0 (下包前需先关 EN 再重装)',
            shadowIdx: 3,
            sramStates: ['reusable', 'reusable', 'reusable'],
            en: 0,
            dmat: 0,
            req: 'TC=1 中断安全收尾 (拉低 DE / 释放 CS)',
            tdr: '(空)',
            tdrTag: 'idle',
            shift: '(空 · 停止位已离开引脚)',
            shiftTag: 'done',
            txe: 1,
            tcif4: 1,
            tc: 1,
            de: 0,
            frames: ['done', 'done', 'done'],
            wireText: "✅ 接收完整：['A', 'B', 'C'] (0x41, 0x42, 0x43)",
            severity: 'success',
            explain:
              "Frame 3 ('C') 最后一个停止位走出 PA9 后，TDR 与移位器均为空，硬件置位 USART_SR.TC = 1！此刻在 TC 中断里拉低 RS-485 DE（或 SPI 确认 BSY==0 后拉高 CS）才真正零丢尾。下次发送前记得按：关 EN → 写 IFCR 清 TCIF4 → 重写 CNDTR4 → 开 EN。",
          };
      }
    }

    const sramStateLabels = {
      ready: '待搬运',
      reading: 'DMA 读取中',
      done: '已进外设',
      reusable: '可安全复用',
    };

    const frameLabels = {
      pending: '等待移位',
      shifting: '逐位输出中…',
      done: '完整发送 ✓',
      truncated: 'DE=0 截断！',
      lost: '滞留 TDR 丢失',
    };

    function renderPipeline() {
      const st = getStepState(stepIndex, policy);
      const setText = (sel, val) => {
        const el = root.querySelector(sel);
        if (el) el.textContent = val;
      };

      setText('#f1dma-stat-step', st.phase);
      setText('#f1dma-stat-cndtr', st.cndtrText);
      setText('#f1dma-stat-flags', `TXE:${st.txe} | TCIF4:${st.tcif4} | TC:${st.tc}`);
      setText('#f1dma-stat-wire', st.wireText);

      const wireEl = root.querySelector('#f1dma-stat-wire');
      if (wireEl) {
        wireEl.className = `aiw-stat-value ${
          st.severity === 'danger'
            ? 'f1dma-val-danger'
            : st.severity === 'warn'
            ? 'warn'
            : st.severity === 'success'
            ? 'f1dma-val-success'
            : 'accent'
        }`;
      }

      // SRAM cells & pointers
      st.sramStates.forEach((cellState, idx) => {
        const cell = root.querySelector(`#f1dma-sram-${idx}`);
        const badge = root.querySelector(`#f1dma-sram-st-${idx}`);
        if (cell) {
          cell.className = `f1dma-mem-cell is-${cellState}`;
        }
        if (badge) {
          badge.textContent = sramStateLabels[cellState] || cellState;
        }
      });

      const shadowLabels = [
        '&tx_buf[0] (\'A\')',
        '&tx_buf[1] (\'B\')',
        '&tx_buf[2] (\'C\')',
        '&tx_buf[3] (末尾完成)',
      ];
      setText('#f1dma-ptr-shadow', shadowLabels[st.shadowIdx] || shadowLabels[0]);

      // DMA1 block
      setText('#f1dma-ccr-en', `CCR4.EN = ${st.en}`);
      setText('#f1dma-cr3-dmat', `CR3.DMAT = ${st.dmat}`);
      setText('#f1dma-req-status', st.req);

      const pillEn = root.querySelector('#f1dma-ccr-en');
      const pillDmat = root.querySelector('#f1dma-cr3-dmat');
      if (pillEn) pillEn.className = `f1dma-mini-pill ${st.en ? 'is-on' : ''}`;
      if (pillDmat) pillDmat.className = `f1dma-mini-pill ${st.dmat ? 'is-on' : ''}`;

      // USART1 TDR & Shift register
      const tdrEl = root.querySelector('#f1dma-tdr-box');
      const shiftEl = root.querySelector('#f1dma-shift-box');
      if (tdrEl) {
        tdrEl.textContent = st.tdr;
        tdrEl.className = `f1dma-reg-box is-${st.tdrTag}`;
      }
      if (shiftEl) {
        shiftEl.textContent = st.shift;
        shiftEl.className = `f1dma-reg-box is-${st.shiftTag}`;
      }

      // Register pills
      const setFlag = (id, text, cls) => {
        const el = root.querySelector(id);
        if (!el) return;
        el.textContent = text;
        el.className = `f1dma-flag-pill ${cls}`;
      };
      setFlag('#f1dma-flag-txe', `TXE = ${st.txe}`, st.txe ? 'is-ok' : 'is-off');
      setFlag('#f1dma-flag-tcif4', `TCIF4 = ${st.tcif4}`, st.tcif4 ? 'is-warn' : 'is-off');
      setFlag('#f1dma-flag-tc', `USART_SR.TC = ${st.tc}`, st.tc ? 'is-ok' : 'is-off');
      setFlag(
        '#f1dma-flag-de',
        st.de ? 'RS-485 DE = 1 (驱动总线)' : 'RS-485 DE = 0 (切断发送)',
        st.de ? 'is-ok' : 'is-danger'
      );

      // 3-Frame physical output timeline
      st.frames.forEach((fState, idx) => {
        const box = root.querySelector(`#f1dma-frame-${idx}`);
        const lbl = root.querySelector(`#f1dma-frame-lbl-${idx}`);
        if (box) box.className = `f1dma-frame-box is-${fState}`;
        if (lbl) lbl.textContent = frameLabels[fState] || fState;
      });

      // Explanation card
      const expEl = root.querySelector('#f1dma-explain');
      if (expEl) {
        expEl.textContent = st.explain;
        expEl.className = `f1dma-explain is-${st.severity}`;
      }

      const stepBtn = root.querySelector('#f1dma-btn-step');
      if (stepBtn) {
        stepBtn.textContent = stepIndex >= 7 ? '重新从 T0 开始' : `单步推进 (T${stepIndex + 1})`;
      }
    }

    function stopPlayback() {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
      }
      const playBtn = root.querySelector('#f1dma-btn-play');
      if (playBtn) playBtn.textContent = '自动演练';
    }

    // Policy radio buttons
    const policyBtns = root.querySelectorAll('.f1dma-policy-btn');
    policyBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPolicy = btn.getAttribute('data-policy');
        if (!nextPolicy || nextPolicy === policy) return;
        policy = nextPolicy;
        policyBtns.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        stopPlayback();
        renderPipeline();
        const label =
          policy === 'bare-dma'
            ? '错误做法：裸 DMA TCIF4=1 立即拉低 DE / CS'
            : '正确做法：TCIF4 后关 DMAT、开 TCIE，等 USART_SR.TC=1';
        log(`[策略切换] ${label}`, policy === 'bare-dma' ? 'warn' : 'success');
      });
    });

    root.querySelector('#f1dma-btn-step')?.addEventListener('click', () => {
      stopPlayback();
      stepIndex = stepIndex >= 7 ? 0 : stepIndex + 1;
      renderPipeline();
      const st = getStepState(stepIndex, policy);
      log(`[${st.phase}] ${st.wireText}`, st.severity);
    });

    root.querySelector('#f1dma-btn-jump-tcif')?.addEventListener('click', () => {
      stopPlayback();
      stepIndex = 4;
      renderPipeline();
      log("[跳转 T4] 刚写完 'C' 至 TDR，TCIF4=1 置位，但引脚还在发 'B'！再点单步看分岔后果", 'warn');
    });

    const playBtn = root.querySelector('#f1dma-btn-play');
    playBtn?.addEventListener('click', () => {
      if (playTimer) {
        stopPlayback();
        return;
      }
      if (stepIndex >= 7) {
        stepIndex = 0;
        renderPipeline();
      }
      playBtn.textContent = '暂停演练';
      playTimer = setInterval(() => {
        if (stepIndex >= 7) {
          stopPlayback();
          return;
        }
        stepIndex += 1;
        renderPipeline();
        const st = getStepState(stepIndex, policy);
        log(`[${st.phase}] ${st.wireText}`, st.severity);
        if (stepIndex >= 7) stopPlayback();
      }, 1350);
    });

    root.querySelector('#f1dma-btn-reset')?.addEventListener('click', () => {
      stopPlayback();
      stepIndex = 0;
      renderPipeline();
      log('[复位] 恢复至 T0 待命状态 (CNDTR4=3, tx_buf={"A","B","C"})');
    });

    // --- Tab 2: Channel 4 OR-Gate & BusMatrix Contention ---
    const reqCheckboxes = root.querySelectorAll('.f1dma-req-chk');
    const orResultEl = root.querySelector('#f1dma-or-result');
    const orGateEl = root.querySelector('#f1dma-or-gate');

    function updateOrGate() {
      const enabled = [];
      reqCheckboxes.forEach((chk) => {
        const chip = chk.closest('.f1dma-req-item');
        if (chk.checked) {
          enabled.push(chk.value);
          chip?.classList.add('is-on');
        } else {
          chip?.classList.remove('is-on');
        }
      });

      if (!orResultEl || !orGateEl) return;
      if (enabled.length === 0) {
        orGateEl.className = 'f1dma-or-gate is-idle';
        orResultEl.className = 'f1dma-arch-banner is-idle';
        orResultEl.textContent = '未开启任何外设 DMA 请求：Channel 4 处于空闲。';
      } else if (enabled.length === 1) {
        orGateEl.className = 'f1dma-or-gate is-ok';
        orResultEl.className = 'f1dma-arch-banner is-ok';
        orResultEl.textContent = `正常：当前仅启用 ${enabled[0]}，固定请求线一对一握手无冲突（对应 RM0008 Figure 50 & Table 78）。`;
      } else {
        orGateEl.className = 'f1dma-or-gate is-danger';
        orResultEl.className = 'f1dma-arch-banner is-danger';
        orResultEl.textContent = `硬件请求碰撞！${enabled.join(' + ')} 同时连入同一个逻辑“或”门，DMA1 Ch4 无法区分是谁发出的请求，也无法同时指向两个外设 CPAR4。STM32F1 同一时刻只能启用其中之一（较新 G4/H7 才提供可编程 DMAMUX）。`;
      }
    }

    reqCheckboxes.forEach((chk) => {
      chk.addEventListener('change', updateOrGate);
    });

    const cpuTargetBtns = root.querySelectorAll('.f1dma-cpu-btn');
    const busDiagramEl = root.querySelector('#f1dma-bus-banner');
    const busPathCpu = root.querySelector('#f1dma-path-cpu');
    const busPathDma = root.querySelector('#f1dma-path-dma');

    function updateBusMatrix(target) {
      cpuTargetBtns.forEach((b) => {
        const active = b.getAttribute('data-cpu-target') === target;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      if (!busDiagramEl || !busPathCpu || !busPathDma) return;
      if (target === 'flash') {
        busPathCpu.textContent = 'CPU 经 ICode/DCode → FLITF → Flash (独立通道)';
        busPathDma.textContent = 'DMA1 经 BusMatrix → SRAM ↔ Bridge 2 → APB2 (并行)';
        busDiagramEl.className = 'f1dma-arch-banner is-ok';
        busDiagramEl.textContent =
          '✅ 并行无阻塞：CPU 通过 ICode/DCode 取指读常量，与 DMA1 经过多层总线矩阵搬运 SRAM → USART1 不交叉，两条路径同时跑，零争用等待。';
      } else if (target === 'sram') {
        busPathCpu.textContent = 'CPU 经 System 总线 → BusMatrix → SRAM (交叉!)';
        busPathDma.textContent = 'DMA1 经 BusMatrix → SRAM (同时争用 SRAM 端口)';
        busDiagramEl.className = 'f1dma-arch-banner is-warn';
        busDiagramEl.textContent =
          '⚠️ 同目标轮询仲裁：CPU System 总线与 DMA1 同一拍访问 SRAM，BusMatrix 轮询交替放行（其中一方等几个周期）；硬件至少为 CPU 保留 50% AHB 带宽，不会让 CPU 死锁卡死。';
      } else {
        busPathCpu.textContent = 'CPU 经 System → BusMatrix → Bridge 2 → APB2 (交叉!)';
        busPathDma.textContent = 'DMA1 经 BusMatrix → Bridge 2 → APB2 (同桥争用)';
        busDiagramEl.className = 'f1dma-arch-banner is-warn';
        busDiagramEl.textContent =
          '⚠️ 跨桥同目标仲裁：CPU 与 DMA1 同时跨 Bridge 2 访问 APB2（如写 USART1），总线矩阵按轮询放行并保障 CPU 至少一半 AHB 带宽。注意：DMA 无法直接访问 CPU 内核通用寄存器。';
      }
    }

    cpuTargetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        updateBusMatrix(btn.getAttribute('data-cpu-target') || 'flash');
      });
    });

    // Initial render
    renderPipeline();
    updateOrGate();
    updateBusMatrix('flash');
    log('[INIT] STM32F103C8T6 USART1_TX + DMA1_CH4 3字节双缓冲实验台就绪');
  }

  try {
    initStm32f1DmaLab();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initStm32f1DmaLab', err);
  }
})();
