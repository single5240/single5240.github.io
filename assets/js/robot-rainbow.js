(() => {
  const stage = document.querySelector("#robotStage");
  const canvas = document.querySelector("#scopeCanvas");
  const robot = document.querySelector("#retroRobot");
  const robotHead = document.querySelector("#robotHead");
  const robotPupils = document.querySelector("#robotPupils");
  const robotNeedle = document.querySelector("#robotNeedle");
  const speech = document.querySelector("#robotSpeech");
  const speechText = document.querySelector("#robotSpeechText");
  const channelBtn = document.querySelector("#scopeChannel");
  const channelNameEl = document.querySelector("#scopeChannelName");
  const readoutEl = document.querySelector("#scopeReadout");
  const dock = document.querySelector("#robotDock");
  const toTopBtn = document.querySelector("#dockToTop");

  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

  const normMod = (val, mod) => ((val % mod) + mod) % mod;

  // 18 种丰富且经典的嵌入式/电子工程示波器波形库
  const WAVEFORMS = [
    {
      id: "sine",
      name: "正弦波",
      spec: "50Hz · 1.0V/div",
      cycles: 3.0,
      comment: "背后正在采样【正弦波】：纯基准信号，THD < 0.05%，谐波干干净净 ~",
      sample(theta) {
        return Math.sin(theta);
      },
    },
    {
      id: "saddle",
      name: "马鞍波",
      spec: "SVPWM · +1/6·3rd",
      cycles: 2.5,
      comment: "背后正在采样【马鞍波】：三次谐波注入 SVPWM，母线电压利用率拉满 ⚡",
      sample(theta) {
        // 经典 SVPWM 三次谐波注入马鞍波：sin(θ) + (1/6)sin(3θ)，归一化到 ±1
        return (Math.sin(theta) + (1 / 6) * Math.sin(3 * theta)) * 1.1547;
      },
    },
    {
      id: "square",
      name: "方波",
      spec: "CLK · 3.3V CMOS",
      cycles: 3.0,
      comment: "背后正在采样【方波】：3.3V 时钟信号，上升沿还带一点点吉布斯振铃 ~",
      sample(theta) {
        // 有限谐波合成方波，保留真实示波器微弱边沿过冲感
        const s =
          Math.sin(theta) +
          Math.sin(3 * theta) / 3 +
          Math.sin(5 * theta) / 5 +
          Math.sin(7 * theta) / 7 +
          Math.sin(9 * theta) / 9;
        return Math.max(-1.05, Math.min(1.05, s * (4 / Math.PI) * 0.88));
      },
    },
    {
      id: "triangle",
      name: "三角波",
      spec: "CARRIER · 20kHz",
      cycles: 3.5,
      comment: "背后正在采样【三角波】：线性对称载波，PWM 比较器最忠实的搭档！",
      sample(theta) {
        return (2 / Math.PI) * Math.asin(Math.sin(theta));
      },
    },
    {
      id: "sawtooth",
      name: "锯齿波",
      spec: "TIM_CNT · 0→ARR",
      cycles: 3.5,
      comment: "背后正在采样【锯齿波】：定时器向上计数斜坡，到 ARR 准时触发更新中断！",
      sample(theta) {
        const u = theta / (Math.PI * 2);
        const frac = u - Math.floor(u);
        const raw = frac * 2 - 1;
        return raw * (1 - Math.pow(frac, 18));
      },
    },
    {
      id: "spwm",
      name: "SPWM波",
      spec: "TIM1_CH1 · 互补",
      cycles: 2.0,
      comment: "背后正在采样【SPWM 波】：正弦包络调制脉冲，准备驱动 H 桥逆变器！",
      sample(theta) {
        const mod = Math.sin(theta);
        const carrier = (2 / Math.PI) * Math.asin(Math.sin(theta * 9));
        const pulse = Math.tanh((mod - carrier) * 6);
        return pulse * 0.55 + mod * 0.45;
      },
    },
    {
      id: "ecg",
      name: "心电波",
      spec: "ECG · Lead II · 60BPM",
      cycles: 2.0,
      comment: "背后正在采样【心电波】：P-Q-R-S-T 窦性心律，单片机和你的心脏都在有力跳动！",
      sample(theta) {
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        const g = (c, w, a) => a * Math.exp(-Math.pow((u - c) / w, 2));
        return (
          g(0.18, 0.045, 0.28) +
          g(0.35, 0.015, -0.18) +
          g(0.39, 0.018, 1.05) +
          g(0.43, 0.016, -0.38) +
          g(0.64, 0.08, 0.35) -
          0.05
        );
      },
    },
    {
      id: "damped",
      name: "欠阻尼振荡",
      spec: "RLC · Ringing · 10MHz",
      cycles: 2.0,
      comment: "背后正在采样【欠阻尼振荡波】：走线寄生 LC 触发的边沿振铃，快加上磁珠和端接电阻！",
      sample(theta) {
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        if (u < 0.5) {
          const x = u / 0.5;
          return (1 - Math.exp(-4.2 * x) * Math.cos(x * Math.PI * 8)) * 0.7 - 0.7;
        } else {
          const x = (u - 0.5) / 0.5;
          return -(1 - Math.exp(-4.2 * x) * Math.cos(x * Math.PI * 8)) * 0.7 + 0.7;
        }
      },
    },
    {
      id: "am",
      name: "AM调幅波",
      spec: "AM · 1000kHz · m=65%",
      cycles: 2.0,
      comment: "背后正在采样【AM 调幅波】：高频载波带上音频包络，无线电矿石收音机的复古浪漫 📻",
      sample(theta) {
        return ((1 + 0.65 * Math.cos(theta)) * Math.sin(theta * 8)) / 1.65;
      },
    },
    {
      id: "fm",
      name: "FM调频波",
      spec: "FM · 10.7MHz IF · Δf=75k",
      cycles: 2.0,
      comment: "背后正在采样【FM 调频波】：载波疏密变化传递音频信息，抗干扰能力比 AM 强悍得多！",
      sample(theta) {
        return Math.sin(theta * 6 + 2.5 * Math.sin(theta));
      },
    },
    {
      id: "chirp",
      name: "线性调频Chirp",
      spec: "CHIRP · 1M→20MHz",
      cycles: 2.0,
      comment: "背后正在采样【线性调频 Chirp 波】：频率随时间线性攀升，LoRa 扩频通信与雷达测距的绝技！",
      sample(theta) {
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        const env = Math.sin(Math.PI * u);
        return env * Math.sin(Math.PI * 2 * (1.5 * u + 4.5 * u * u));
      },
    },
    {
      id: "rc_step",
      name: "RC充放电波",
      spec: "RC · τ=100μs · 一阶",
      cycles: 2.5,
      comment: "背后正在采样【RC 充放电波】：一阶惯性滤波电路，τ = RC，3 个时间常数充到 95%！",
      sample(theta) {
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        if (u < 0.5) {
          const x = u / 0.5;
          return 1 - 2 * Math.exp(-4 * x);
        } else {
          const x = (u - 0.5) / 0.5;
          return -1 + 2 * Math.exp(-4 * x);
        }
      },
    },
    {
      id: "rectified",
      name: "全波整流波",
      spec: "RECT · 100Hz · 12Vpk",
      cycles: 3.0,
      comment: "背后正在采样【全波整流波】：桥式整流二极管输出的馒头波，后面滤波电容正全力蓄能！",
      sample(theta) {
        return Math.abs(Math.sin(theta)) * 1.7 - 0.85;
      },
    },
    {
      id: "uart",
      name: "UART串口波",
      spec: "UART · 115200 · 8-N-1",
      cycles: 1.5,
      comment: "背后正在采样【UART 串口波】：波特率 115200 8-N-1，正在向控制台吐出调试日志！",
      sample(theta) {
        const UART_BITS = [0.8, -0.8, -0.8, 0.8, -0.8, 0.8, 0.8, -0.8, 0.8, -0.8, 0.8, 0.8];
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        const bitPos = u * UART_BITS.length;
        const idx = Math.floor(bitPos);
        const frac = bitPos - idx;
        const curr = UART_BITS[idx];
        const prev = UART_BITS[(idx - 1 + UART_BITS.length) % UART_BITS.length];
        const t = Math.min(1, frac / 0.18);
        return prev + (curr - prev) * (1 - Math.exp(-5 * t));
      },
    },
    {
      id: "i2c",
      name: "I2C总线波",
      spec: "I2C · 400kHz · Fast",
      cycles: 1.5,
      comment: "背后正在采样【I2C 总线波】：SCL 时钟与 SDA 数据线正在打配合，检测到了设备 ACK 应答！",
      sample(theta) {
        const I2C_BITS = [0.8, -0.8, -0.8, 0.8, -0.8, 0.8, -0.8, 0.8, -0.8, -0.8, 0.8, 0.8];
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        const bitPos = u * I2C_BITS.length;
        const idx = Math.floor(bitPos);
        const frac = bitPos - idx;
        const curr = I2C_BITS[idx];
        const prev = I2C_BITS[(idx - 1 + I2C_BITS.length) % I2C_BITS.length];
        const t = Math.min(1, frac / 0.16);
        return curr > prev
          ? prev + (curr - prev) * (1 - Math.exp(-4.5 * t))
          : prev + (curr - prev) * (1 - Math.exp(-9.0 * t));
      },
    },
    {
      id: "can",
      name: "CAN总线波",
      spec: "CAN-FD · 500k · DIFF",
      cycles: 1.5,
      comment: "背后正在采样【CAN 总线波】：500kbps 差分仲裁段，显性电平覆盖隐性，车载通信稳如磐石！",
      sample(theta) {
        const CAN_BITS = [0.85, -0.25, -0.25, -0.25, -0.25, 0.85, -0.25, -0.25, 0.85, 0.85, 0.85, -0.25, 0.85, -0.25];
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        const pos = u * CAN_BITS.length;
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const curr = CAN_BITS[idx];
        const prev = CAN_BITS[(idx - 1 + CAN_BITS.length) % CAN_BITS.length];
        const t = Math.min(1, frac / 0.14);
        return prev + (curr - prev) * (1 - Math.exp(-6 * t));
      },
    },
    {
      id: "video",
      name: "视频行同步波",
      spec: "VIDEO · 1Vp-p · PAL",
      cycles: 1.5,
      comment: "背后正在采样【模拟视频复合波】：行同步头 + 4.43MHz 色副载波群，复古阴极射线管 CRT 的灵魂！",
      sample(theta) {
        const u = normMod(theta, Math.PI * 2) / (Math.PI * 2);
        if (u < 0.12) return -0.85;
        if (u < 0.18) return -0.2;
        if (u < 0.32) {
          const burstFrac = (u - 0.18) / 0.14;
          return -0.2 + Math.sin(burstFrac * Math.PI * 6) * 0.35 * Math.sin(burstFrac * Math.PI);
        }
        if (u < 0.9) {
          const activeFrac = (u - 0.32) / 0.58;
          return -0.15 + 0.95 * activeFrac + Math.sin(activeFrac * Math.PI * 14) * 0.18;
        }
        return -0.2;
      },
    },
    {
      id: "noise",
      name: "ADC底噪采样",
      spec: "NOISE · 100μVrms · 24b",
      cycles: 2.5,
      comment: "背后正在采样【ADC 采样底噪】：24位 Σ-Δ 高精度 ADC 测得的白噪声基底，有效位数 ENOB 在线巡检！",
      sample(theta) {
        return (
          Math.sin(theta * 19) * 0.38 +
          Math.sin(theta * 37 + 1.2) * 0.32 +
          Math.sin(theta * 61 + 2.4) * 0.22 +
          Math.sin(theta * 97 + 0.5) * 0.15
        );
      },
    },
  ];

  // 主题自适应示波器轨迹配色
  const THEME_SCOPE_COLORS = {
    light: {
      trace: "#0f818d",
      subTrace: "rgba(164, 105, 46, 0.28)",
      axis: "rgba(30, 37, 43, 0.14)",
      terminal: "#09686a",
      glow: 0,
    },
    dark: {
      trace: "#58c4ce",
      subTrace: "rgba(241, 166, 90, 0.26)",
      axis: "rgba(168, 180, 187, 0.14)",
      terminal: "#78d5dc",
      glow: 3,
    },
    swiss: {
      trace: "#e63329",
      subTrace: "rgba(17, 17, 17, 0.2)",
      axis: "rgba(17, 17, 17, 0.15)",
      terminal: "#cc251b",
      glow: 0,
    },
    hud: {
      trace: "#52d8e8",
      subTrace: "rgba(255, 209, 102, 0.28)",
      axis: "rgba(82, 216, 232, 0.18)",
      terminal: "#7be4f0",
      glow: 5,
    },
    mono: {
      trace: "#262626",
      subTrace: "rgba(115, 115, 115, 0.24)",
      axis: "rgba(20, 20, 20, 0.14)",
      terminal: "#141414",
      glow: 0,
    },
  };

  const isArticlePage = Boolean(document.querySelector("#articleRobotCard"));
  let isFloating = false;

  // 有条理的三层对话系统（告别杂乱报文）
  const NORMAL_DIALOGUES = [
    () => WAVEFORMS[currentWaveIndex].comment,
    () =>
      isArticlePage
        ? "正在侧边栏陪你精读文章，目录随时可快速跳转 ↘"
        : "戳我干嘛，正在跑 while(1) 主循环呢 (*/ω＼*)",
    () => "刚帮你喂过看门狗（IWDG）啦，0 Warning 0 Error，放心看笔记！",
    () =>
      isFloating
        ? "悬浮常驻伴读模式中，点右上角 ↑ 可一键返回顶部哦 ~"
        : isArticlePage
        ? "提示：点左上角 CH1 可切换波形，滑动文章我一直都在侧栏！"
        : "提示：点下方色卡可按专题筛文章，点左侧 CH1 可切换示波器波形 ↗",
    () => "汇报：栈水位安全，DMA 双缓冲就绪，无野指针出没！",
  ];

  const COMBO_DIALOGUES = [
    "⚠️ EXTI 外部中断触发太快，按键消抖状态机要冒烟啦！",
    "⚡ 进 HardFault_Handler 啦……骗你的，已自动软复位 😄",
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;

  // 随机选一个非正弦或全部波形作为初始展示，让每次进入都有新鲜感
  let currentWaveIndex = Math.floor(Math.random() * WAVEFORMS.length);
  let prevWaveIndex = currentWaveIndex;
  let morphProgress = 1;

  let phase = 0;
  let amplitudeBoost = 0;
  let isStageHovered = false;
  let stagePointerRatioX = 0.5;

  // 视线与头部弹簧状态（范围大幅增强，清晰灵动）
  let pupilX = 0;
  let pupilY = 0;
  let targetPupilX = 0;
  let targetPupilY = 0;

  let headX = 0;
  let headY = 0;
  let headRot = 0;
  let targetHeadX = 0;
  let targetHeadY = 0;
  let targetHeadRot = 0;

  // 胸前微安表指针物理角度（度）
  let needleAngle = 0;
  let needleVel = 0;
  let targetNeedleAngle = 0;

  // 对话状态机
  let hasGreeted = false;
  let dialogueCursor = 0;
  let comboCursor = 0;
  let clickTimestamps = [];
  let speechTimer = null;
  let boopTimer = null;
  let inView = true;
  let rafId = null;
  let autoSwitchTimer = null;

  const getScopePalette = () => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr && THEME_SCOPE_COLORS[attr]) return THEME_SCOPE_COLORS[attr];
    return darkMedia.matches ? THEME_SCOPE_COLORS.dark : THEME_SCOPE_COLORS.light;
  };

  const syncWaveLabels = () => {
    const wave = WAVEFORMS[currentWaveIndex];
    if (channelNameEl) channelNameEl.textContent = wave.name;
    if (readoutEl) readoutEl.textContent = wave.spec;
  };

  const switchWaveform = (nextIndex, announce = false) => {
    prevWaveIndex = currentWaveIndex;
    currentWaveIndex = (nextIndex + WAVEFORMS.length) % WAVEFORMS.length;
    morphProgress = 0;
    amplitudeBoost = 0.22;
    needleVel -= 9;
    syncWaveLabels();

    if (announce) {
      showSpeech(`CH1 已切换至【${WAVEFORMS[currentWaveIndex].name}】(${WAVEFORMS[currentWaveIndex].spec})`);
    }
    if (reducedMotion.matches) {
      morphProgress = 1;
      drawScope();
    }
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    width = Math.max(280, Math.floor(rect.width));
    height = Math.max(96, Math.floor(rect.height || 114));
    dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    drawScope();
  };

  const sampleBlended = (theta) => {
    const curr = WAVEFORMS[currentWaveIndex].sample(theta);
    if (morphProgress >= 1) return curr;
    const prev = WAVEFORMS[prevWaveIndex].sample(theta);
    const t = morphProgress * morphProgress * (3 - 2 * morphProgress);
    return prev + (curr - prev) * t;
  };

  const drawScope = () => {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    const palette = getScopePalette();
    const padX = Math.min(24, Math.max(10, width * 0.02));
    const spanW = Math.max(180, width - padX * 2);
    const centerY = Math.round(height * 0.48);
    const baseAmp = Math.min(26, height * 0.23) * (1 + amplitudeBoost);

    // 机器人中间遮挡柔化区（让机器人背后的波形略微淡化，突出主体层次）
    const robotHalfW = 54;
    const midX = width * 0.5;

    // 1. 0V 基准虚线与刻度十字
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.axis;
    ctx.beginPath();
    ctx.moveTo(padX, centerY);
    ctx.lineTo(width - padX, centerY);
    ctx.stroke();
    ctx.restore();

    const wave = WAVEFORMS[currentWaveIndex];
    const prevWave = WAVEFORMS[prevWaveIndex];
    const cycles =
      morphProgress >= 1
        ? wave.cycles
        : prevWave.cycles + (wave.cycles - prevWave.cycles) * morphProgress;

    const steps = Math.min(260, Math.max(120, Math.floor(spanW / 3)));

    // 2. 辅助包络/谐波副通道轨迹 (CH2)
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 1.15;
    ctx.strokeStyle = palette.subTrace;
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const x = padX + u * spanW;
      const theta = u * Math.PI * 2 * cycles - phase * 0.65;
      const y = centerY - Math.sin(theta) * (baseAmp * 0.72);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 3. 主通道示波器波形 (CH1)
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = palette.trace;
    if (palette.glow > 0) {
      ctx.shadowColor = palette.trace;
      ctx.shadowBlur = palette.glow;
    }

    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const x = padX + u * spanW;

      // 当鼠标在舞台上方移动时，光标附近产生轻微探头包络增益
      let localGain = 1;
      if (isStageHovered) {
        const distRatio = Math.abs(u - stagePointerRatioX);
        if (distRatio < 0.18) {
          localGain = 1 + (1 - distRatio / 0.18) * 0.22;
        }
      }

      // 机器人正后方略微收敛振幅，使画面更干净
      const distFromCenter = Math.abs(x - midX);
      const centerAtten =
        distFromCenter < robotHalfW
          ? 0.65 + 0.35 * (distFromCenter / robotHalfW)
          : 1;

      const theta = u * Math.PI * 2 * cycles - phase;
      const val = sampleBlended(theta);
      const y = centerY - val * baseAmp * localGain * centerAtten;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 4. 两端图纸测试焊盘圆环
    const startY = centerY - sampleBlended(-phase) * baseAmp;
    const endY = centerY - sampleBlended(Math.PI * 2 * cycles - phase) * baseAmp;
    const paperColor =
      getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#11191d";

    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = palette.terminal;
    ctx.fillStyle = paperColor;
    for (const pt of [
      { x: padX, y: startY },
      { x: width - padX, y: endY },
    ]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  };

  const applyRobotTransforms = () => {
    if (robotPupils) {
      robotPupils.setAttribute(
        "transform",
        `translate(${pupilX.toFixed(2)}, ${pupilY.toFixed(2)})`
      );
    }
    if (robotHead) {
      robotHead.setAttribute(
        "transform",
        `translate(${headX.toFixed(2)}, ${headY.toFixed(2)}) rotate(${headRot.toFixed(2)}, 80, 62)`
      );
    }
    if (robotNeedle) {
      robotNeedle.setAttribute("transform", `rotate(${needleAngle.toFixed(2)}, 67, 111)`);
    }
  };

  const tick = () => {
    if (!inView || reducedMotion.matches) {
      rafId = null;
      return;
    }

    // 1. 示波器相位推进与波形平滑过渡
    phase += isStageHovered ? 0.052 : 0.032;
    if (phase > Math.PI * 200) phase -= Math.PI * 200;

    if (morphProgress < 1) {
      morphProgress = Math.min(1, morphProgress + 0.045);
    }
    amplitudeBoost *= 0.92;

    // 2. 瞳孔与头部平滑跟随（行程放大，目光清晰灵动）
    pupilX += (targetPupilX - pupilX) * 0.22;
    pupilY += (targetPupilY - pupilY) * 0.22;

    headX += (targetHeadX - headX) * 0.14;
    headY += (targetHeadY - headY) * 0.14;
    headRot += (targetHeadRot - headRot) * 0.14;

    // 3. 胸前微安表针弹簧阻尼摆动
    const needleForce = (targetNeedleAngle - needleAngle) * 0.12;
    needleVel = (needleVel + needleForce) * 0.82;
    needleAngle += needleVel;

    applyRobotTransforms();
    drawScope();

    rafId = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (reducedMotion.matches) {
      drawScope();
      return;
    }
    if (!rafId && inView) {
      rafId = requestAnimationFrame(tick);
    }
  };

  // 全页面鼠标移动监听：无论鼠标在哪里划过，机器人眼睛与头颅都灵动跟随
  const onWindowPointerMove = (e) => {
    if (reducedMotion.matches || !robot) return;

    const rect = robot.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.38;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    // 归一化方向向量，近处平滑过渡，远处饱和
    const normFactor = Math.min(1, dist / 260);
    const angle = Math.atan2(dy, dx);
    const nx = Math.cos(angle) * normFactor;
    const ny = Math.sin(angle) * normFactor;

    // 瞳孔在固定 CRT 眼眶内大幅度游走（水平 ±6.5px，垂直 ±4.0px）
    targetPupilX = nx * 6.5;
    targetPupilY = ny * 4.0;

    // 头部与天线跟随产生 3D 微倾角（水平 ±2.6px，垂直 ±1.5px，旋转 ±4°）
    targetHeadX = nx * 2.6;
    targetHeadY = ny * 1.5;
    targetHeadRot = nx * 4.0;

    // 判断是否在舞台上方以联动波形与表针
    const stageRect = stage.getBoundingClientRect();
    if (
      e.clientX >= stageRect.left &&
      e.clientX <= stageRect.right &&
      e.clientY >= stageRect.top - 20 &&
      e.clientY <= stageRect.bottom + 20
    ) {
      isStageHovered = true;
      stagePointerRatioX = Math.max(
        0,
        Math.min(1, (e.clientX - stageRect.left) / Math.max(1, stageRect.width))
      );
      targetNeedleAngle = -10 + stagePointerRatioX * 26;
    } else {
      isStageHovered = false;
      targetNeedleAngle = 0;
    }
  };

  window.addEventListener("pointermove", onWindowPointerMove, { passive: true });

  document.addEventListener(
    "pointerleave",
    () => {
      isStageHovered = false;
      targetPupilX = 0;
      targetPupilY = 0;
      targetHeadX = 0;
      targetHeadY = 0;
      targetHeadRot = 0;
      targetNeedleAngle = 0;
    },
    { passive: true }
  );

  // 弹出清晰受控的对话气泡
  const showSpeech = (message, duration = 3800) => {
    if (!speech || !speechText) return;
    speechText.textContent = message;
    speech.classList.add("is-active");
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => {
      speech.classList.remove("is-active");
    }, duration);
  };

  // 点击小机器人：开心眨眼 + 表针跳动 + 切换/应答
  const handleRobotClick = () => {
    const now = performance.now();
    clickTimestamps = clickTimestamps.filter((t) => now - t < 2200);
    clickTimestamps.push(now);

    // 动作反馈 1：开心弯眼 ^ ^ + 天线高亮
    if (robot) {
      robot.classList.add("is-booped");
      clearTimeout(boopTimer);
      boopTimer = setTimeout(() => {
        robot.classList.remove("is-booped");
      }, 780);
    }

    // 动作反馈 2：胸前电流表针大幅跳动 + 背后波形随机切换为新波形
    needleVel = -16;
    amplitudeBoost = 0.28;

    const pickOffset = 1 + Math.floor(Math.random() * (WAVEFORMS.length - 1));
    switchWaveform(currentWaveIndex + pickOffset, false);

    // 动作反馈 3：三层清晰情境对话
    let text;
    if (!hasGreeted) {
      hasGreeted = true;
      text = `嘀！工作台已就绪，背后正在采样【${WAVEFORMS[currentWaveIndex].name}】~`;
    } else if (clickTimestamps.length >= 4) {
      text = COMBO_DIALOGUES[comboCursor % COMBO_DIALOGUES.length];
      comboCursor += 1;
      clickTimestamps = [];
    } else {
      const fn = NORMAL_DIALOGUES[dialogueCursor % NORMAL_DIALOGUES.length];
      text = fn();
      dialogueCursor += 1;
    }

    showSpeech(text, 4000);
  };

  if (robot) {
    robot.addEventListener("click", handleRobotClick);
  }

  if (channelBtn) {
    channelBtn.addEventListener("click", () => {
      switchWaveform(currentWaveIndex + 1, true);
    });
  }

  // 悬停下方专题色卡时：小机器人低头注视对应色卡，表针响应
  const spectrumItems = document.querySelectorAll(".spectrum-item");
  spectrumItems.forEach((item, index) => {
    item.addEventListener("mouseenter", () => {
      const ratio = (index + 0.5) / Math.max(1, spectrumItems.length) - 0.5;
      targetPupilX = ratio * 10;
      targetPupilY = 4.2;
      targetHeadX = ratio * 3.5;
      targetHeadY = 1.8;
      targetHeadRot = ratio * 5;
      needleVel -= 6;
      amplitudeBoost = 0.16;
    });
  });

  // 定时自动轮换背景示波器波形（每 10 秒平滑 morph 到随机波形）
  const startAutoSwitch = () => {
    clearInterval(autoSwitchTimer);
    autoSwitchTimer = setInterval(() => {
      if (!inView || document.hidden || isStageHovered) return;
      const step = 1 + Math.floor(Math.random() * (WAVEFORMS.length - 1));
      switchWaveform(currentWaveIndex + step, false);
    }, 10000);
  };

  const updateFloatingDock = () => {
    if (!dock || !stage) return;

    // 桌面端文章页：侧边栏本身已是 sticky 贴顶跟随，目录上方的小机器人一直可见，不脱离为右下角悬浮
    const isDesktopArticleSidebar =
      document.querySelector("#reading-sidebar") && window.innerWidth > 1000;

    if (isDesktopArticleSidebar) {
      if (isFloating) {
        isFloating = false;
        dock.classList.remove("is-docked-float");
      }
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    // 当舞台滑出屏幕顶部（bottom < 15），平滑进入右下角悬浮工作台（固定常驻）
    const shouldFloat = stageRect.bottom < 15;

    if (shouldFloat !== isFloating) {
      isFloating = shouldFloat;
      if (isFloating) {
        dock.classList.add("is-docked-float");
        inView = true;
        startLoop();
      } else {
        dock.classList.remove("is-docked-float");
      }
    }
  };

  if (toTopBtn) {
    toTopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  window.addEventListener("scroll", updateFloatingDock, { passive: true });
  window.addEventListener("resize", updateFloatingDock, { passive: true });

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stage);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        inView = Boolean(entries[0] && entries[0].isIntersecting) || isFloating;
        if (inView) startLoop();
      },
      { threshold: 0.05 }
    );
    observer.observe(stage);
  }

  const themeObserver = new MutationObserver(() => {
    drawScope();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-skin"],
  });

  darkMedia.addEventListener("change", () => drawScope());

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      drawScope();
    } else {
      startLoop();
    }
  });

  syncWaveLabels();
  resize();
  updateFloatingDock();
  startLoop();
  startAutoSwitch();
})();
