(() => {
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
      // AD7190 为 SPI 全双工模式：TX(CH5) 与 RX(CH4) 同步触发
      if (channels.ch4.cndtr > 0 || channels.ch5.cndtr > 0) {
        winner = channels.ch4;
        slotCode = 'CH4';
        channels.ch4.cndtr = Math.max(0, channels.ch4.cndtr - 1);
        channels.ch5.cndtr = Math.max(0, channels.ch5.cndtr - 1);
        if (channels.ch4.cndtr === 0) {
          log('[DMA1_CH4 TC] AD7190 24-bit 采样全双工完成！触发 DMA1_Channel4_IRQHandler 并压入环形队列', 'success');
        }
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
        // 如果当前总线空闲，默认启动一次 LCD 传输以供观察
        if (channels.ch2.cndtr === 0 && channels.ch4.cndtr === 0) {
          channels.ch1.cndtr = 1920;
          channels.ch2.cndtr = 1920;
          updateChannelUI();
          log('[LCD DMA] 启动 240x8 像素条带传输 (1920 像素 / 16-bit) -> 映射至 DMA1_CH1/CH2', 'normal');
        }
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
        const maxSteps = scenarios[currentScenario].length;
        if (pitfallStep >= maxSteps - 1) {
          pitfallStep = 0;
          renderPitfall();
        }
        runPitfallBtn.textContent = '暂停演练';
        pitfallTimer = setInterval(() => {
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

  try {
    initSpiDmaSimulator();
  } catch (err) {
    console.warn('[Widget] Failed to initialize simulator:', 'initSpiDmaSimulator', err);
  }
})();
