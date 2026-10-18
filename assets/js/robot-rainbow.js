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

  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

  // 6 种常见嵌入式/电力电子示波器波形定义
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
        // 平滑陡降沿避免混叠锯齿
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

  // 有条理的三层对话系统（告别杂乱报文）
  const NORMAL_DIALOGUES = [
    () => WAVEFORMS[currentWaveIndex].comment,
    () => "戳我干嘛，正在跑 while(1) 主循环呢 (*/ω＼*)",
    () => "刚帮你喂过看门狗（IWDG）啦，0 Warning 0 Error，放心看笔记！",
    () => "提示：点下方色卡可按专题筛文章，点左侧 CH1 可切换示波器波形 ↗",
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

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stage);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        inView = Boolean(entries[0] && entries[0].isIntersecting);
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
  startLoop();
  startAutoSwitch();
})();
