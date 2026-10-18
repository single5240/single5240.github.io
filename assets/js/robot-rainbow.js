(() => {
  const stage = document.querySelector("#rainbowMascotStage");
  const canvas = document.querySelector("#rainbowCanvas");
  const robot = document.querySelector("#retroRobot");
  const eyesTrack = document.querySelector("#robotEyesTrack");
  const speech = document.querySelector("#robotSpeech");
  const speechText = document.querySelector("#robotSpeechText");
  const stageReadout = document.querySelector("#stageReadout");

  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

  // 契合全站 5 套主题的复古实体油墨与仪器光谱色板（对应 MCU / 系统 / Qt / Linux / 工业通信）
  const THEME_PALETTES = {
    light: {
      bands: ["#2c4554", "#0f818d", "#3f5442", "#a4692e", "#742d38"],
      guide: "rgba(30, 37, 43, 0.14)",
      terminal: "#63707a",
      alpha: 0.9,
      glow: 0,
    },
    dark: {
      bands: ["#466f87", "#249eab", "#58825e", "#cc853d", "#a34654"],
      guide: "rgba(168, 180, 187, 0.14)",
      terminal: "#78d5dc",
      alpha: 0.92,
      glow: 2,
    },
    swiss: {
      bands: ["#111111", "#4a4946", "#87837b", "#d84333", "#e63329"],
      guide: "rgba(17, 17, 17, 0.14)",
      terminal: "#e63329",
      alpha: 0.92,
      glow: 0,
    },
    hud: {
      bands: ["#1d5670", "#2899bd", "#52d8e8", "#80c7a7", "#ffd166"],
      guide: "rgba(82, 216, 232, 0.18)",
      terminal: "#52d8e8",
      alpha: 0.94,
      glow: 4,
    },
    mono: {
      bands: ["#141414", "#3b3b3b", "#636363", "#8c8982", "#b5b0a6"],
      guide: "rgba(20, 20, 20, 0.12)",
      terminal: "#141414",
      alpha: 0.9,
      glow: 0,
    },
  };

  const BAND_OFFSETS = [-12, -6, 0, 6, 12];
  const BAND_WIDTH = 3.8;

  const SPEECH_MESSAGES = [
    "READY · 115200bps",
    "ADC 24-BIT · LOCKED",
    "SPI DMA · ZERO-DROP",
    "ETH-CAT · OP_MODE",
    "N32G455 · 144MHz",
    "IMX6ULL · QT5 UI",
    "CRC16 · VERIFIED",
  ];
  let speechIndex = 0;
  let speechTimer = null;
  let boopTimer = null;

  // 质点弹簧链参数
  const NODE_COUNT = 32;
  const SPRING_K = 0.048;
  const DAMPING = 0.87;
  const NEIGHBOR_COUPLING_Y = 0.14;
  const NEIGHBOR_COUPLING_X = 0.07;
  const MAGNETIC_RADIUS = 175;
  const MAGNETIC_FORCE = 3.4;

  // 画布向上/向下出血留白（避免彩虹大幅度向上拉扯或脉冲弹跳时被画布顶边截断）
  const CANVAS_BLEED_TOP = 72;
  const CANVAS_BLEED_BOTTOM = 12;

  let stageWidth = 0;
  let stageHeight = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let nodes = [];
  let isPointerActive = false;
  let pointerX = -9999;
  let pointerY = -9999;
  let eyeOffsetX = 0;
  let eyeOffsetY = 0;
  let targetEyeX = 0;
  let targetEyeY = 0;
  let activeBandIndex = -1;
  let isAnimating = false;
  let inView = true;

  class Node {
    constructor(t) {
      this.t = t;
      this.x = 0;
      this.y = 0;
      this.ox = 0;
      this.oy = 0;
      this.vx = 0;
      this.vy = 0;
    }

    updateBase(stageW, stageH) {
      const padX = Math.min(28, Math.max(12, stageW * 0.025));
      const spanW = Math.max(200, stageW - padX * 2);
      this.ox = padX + this.t * spanW;
      // 跨过小机器人头顶的平滑仪器拱弧（叠加顶部出血偏移量）
      const arch = Math.pow(Math.sin(Math.PI * this.t), 0.84);
      this.oy = CANVAS_BLEED_TOP + (stageH - 14) - (stageH - 40) * arch;

      if (!isAnimating) {
        this.x = this.ox;
        this.y = this.oy;
      }
    }
  }

  const currentPalette = () => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr && THEME_PALETTES[attr]) return THEME_PALETTES[attr];
    return darkMedia.matches ? THEME_PALETTES.dark : THEME_PALETTES.light;
  };

  const initNodes = () => {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i += 1) {
      const t = i / (NODE_COUNT - 1);
      const node = new Node(t);
      node.updateBase(stageWidth, stageHeight);
      node.x = node.ox;
      node.y = node.oy;
      nodes.push(node);
    }
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    stageWidth = Math.max(280, Math.floor(rect.width));
    stageHeight = Math.max(116, Math.floor(rect.height || 142));
    width = stageWidth;
    height = stageHeight + CANVAS_BLEED_TOP + CANVAS_BLEED_BOTTOM;
    dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (nodes.length !== NODE_COUNT) {
      initNodes();
    } else {
      for (const node of nodes) {
        node.updateBase(stageWidth, stageHeight);
      }
    }

    drawStripes();
    wakeUp();
  };

  const drawCurve = (offsetY) => {
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y + offsetY);

    for (let i = 1; i < nodes.length - 1; i += 1) {
      const xc = (nodes[i].x + nodes[i + 1].x) * 0.5;
      const yc = (nodes[i].y + nodes[i + 1].y + offsetY * 2) * 0.5;
      ctx.quadraticCurveTo(nodes[i].x, nodes[i].y + offsetY, xc, yc);
    }

    const last = nodes[nodes.length - 1];
    ctx.quadraticCurveTo(last.x, last.y + offsetY, last.x, last.y + offsetY);
    ctx.stroke();
  };

  const drawStripes = () => {
    if (nodes.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    const palette = currentPalette();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. 绘制底层示波器静态参考虚线弧
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.guide;
    ctx.beginPath();
    ctx.moveTo(nodes[0].ox, nodes[0].oy - 19);
    for (let i = 1; i < nodes.length; i += 1) {
      ctx.lineTo(nodes[i].ox, nodes[i].oy - 19);
    }
    ctx.stroke();
    ctx.restore();

    // 2. 绘制 5 条复古油墨光谱色带
    for (let b = 0; b < BAND_OFFSETS.length; b += 1) {
      const offset = BAND_OFFSETS[b];
      const color = palette.bands[b % palette.bands.length];
      const isHighlighted = activeBandIndex === b;

      ctx.lineWidth = isHighlighted ? BAND_WIDTH + 1.4 : BAND_WIDTH;
      ctx.strokeStyle = color;
      ctx.globalAlpha = isHighlighted ? 1 : palette.alpha;

      if (palette.glow > 0 || isHighlighted) {
        ctx.shadowColor = color;
        ctx.shadowBlur = isHighlighted ? 5 : palette.glow;
      } else {
        ctx.shadowBlur = 0;
      }

      drawCurve(offset);
    }

    // 3. 绘制两端工程图纸焊盘端子圆环（与全站 SVG 插画风格统一）
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = palette.terminal;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#11191d";

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    for (const anchor of [first, last]) {
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  };

  const wakeUp = () => {
    if (reducedMotion.matches) {
      drawStripes();
      return;
    }
    if (!isAnimating && inView) {
      isAnimating = true;
      requestAnimationFrame(tick);
    }
  };

  const tick = () => {
    if (!inView || reducedMotion.matches) {
      isAnimating = false;
      return;
    }

    let maxVel = 0;
    let totalEnergy = 0;
    const minY = Math.abs(BAND_OFFSETS[0]) + 8;
    const maxY = height - BAND_OFFSETS[BAND_OFFSETS.length - 1] - 6;
    const minX = 8;
    const maxX = width - 8;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];

      if (i === 0 || i === nodes.length - 1) {
        node.x = node.ox;
        node.y = node.oy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      // 1. 胡克定律复位弹力
      node.vx += (node.ox - node.x) * SPRING_K;
      node.vy += (node.oy - node.y) * SPRING_K;

      // 2. 邻近节点张力耦合
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      node.vy += ((prev.y + next.y) * 0.5 - node.y) * NEIGHBOR_COUPLING_Y;
      node.vx += ((prev.x + next.x) * 0.5 - node.x) * NEIGHBOR_COUPLING_X;

      // 3. 光标磁力牵引
      if (isPointerActive) {
        const dx = pointerX - node.x;
        const dy = pointerY - node.y;
        const dist = Math.hypot(dx, dy);

        if (dist < MAGNETIC_RADIUS && dist > 1) {
          const ratio = 1 - dist / MAGNETIC_RADIUS;
          const pull = ratio * ratio * MAGNETIC_FORCE;
          node.vx += (dx / dist) * pull;
          node.vy += (dy / dist) * pull;
        }
      }

      // 4. 顶部/底部柔性缓冲边界（防止大幅拉扯时触碰画布边缘被裁切）
      if (node.y < minY + 18) {
        node.vy += (minY + 18 - node.y) * 0.15;
      } else if (node.y > maxY - 14) {
        node.vy -= (node.y - (maxY - 14)) * 0.15;
      }

      // 5. 阻尼衰减与积分
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;

      // 硬限幅保护
      if (node.y < minY) {
        node.y = minY;
        if (node.vy < 0) node.vy *= 0.25;
      } else if (node.y > maxY) {
        node.y = maxY;
        if (node.vy > 0) node.vy *= 0.25;
      }
      if (node.x < minX) node.x = minX;
      if (node.x > maxX) node.x = maxX;

      const v = Math.hypot(node.vx, node.vy);
      if (v > maxVel) maxVel = v;
      totalEnergy += Math.hypot(node.x - node.ox, node.y - node.oy);
    }

    // 平滑更新机器人电子眼视线跟随
    eyeOffsetX += (targetEyeX - eyeOffsetX) * 0.18;
    eyeOffsetY += (targetEyeY - eyeOffsetY) * 0.18;
    if (eyesTrack) {
      eyesTrack.setAttribute("transform", `translate(${eyeOffsetX.toFixed(2)}, ${eyeOffsetY.toFixed(2)})`);
    }

    // 更新右上角复古仪器遥测读数
    if (stageReadout) {
      const db = Math.min(18.0, totalEnergy * 0.035);
      if (db > 0.15) {
        stageReadout.textContent = `SYNC · +${db.toFixed(1)}dB`;
      } else {
        stageReadout.textContent = "IDLE · 0.0dB";
      }
    }

    drawStripes();

    const eyeSettled = Math.hypot(targetEyeX - eyeOffsetX, targetEyeY - eyeOffsetY) < 0.04;
    if (maxVel < 0.008 && !isPointerActive && eyeSettled) {
      for (const node of nodes) {
        node.x = node.ox;
        node.y = node.oy;
        node.vx = 0;
        node.vy = 0;
      }
      if (eyesTrack) {
        eyesTrack.removeAttribute("transform");
      }
      if (stageReadout) {
        stageReadout.textContent = "IDLE · 0.0dB";
      }
      drawStripes();
      isAnimating = false;
    } else {
      requestAnimationFrame(tick);
    }
  };

  // 触发脉冲波纹
  const triggerRipple = (sourceIndex = Math.floor(NODE_COUNT * 0.5), force = -20) => {
    if (reducedMotion.matches) return;
    if (sourceIndex > 0 && sourceIndex < nodes.length - 1) {
      nodes[sourceIndex].vy += force;
      if (sourceIndex > 1) nodes[sourceIndex - 1].vy += force * 0.65;
      if (sourceIndex < nodes.length - 2) nodes[sourceIndex + 1].vy += force * 0.65;
      wakeUp();
    }
  };

  // 光标移动与视线追踪（将舞台坐标映射到带顶部出血的画布坐标系）
  const updatePointer = (e) => {
    const rect = stage.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    pointerX = localX;
    pointerY = localY + CANVAS_BLEED_TOP;
    isPointerActive = true;

    const centerX = rect.width * 0.5;
    const centerY = rect.height * 0.55;
    const normX = Math.max(-1, Math.min(1, (localX - centerX) / (rect.width * 0.45)));
    const normY = Math.max(-1, Math.min(1, (localY - centerY) / (rect.height * 0.6)));
    targetEyeX = normX * 3.2;
    targetEyeY = normY * 2.0;

    wakeUp();
  };

  const releasePointer = () => {
    isPointerActive = false;
    pointerX = -9999;
    pointerY = -9999;
    targetEyeX = 0;
    targetEyeY = 0;
    wakeUp();
  };

  stage.addEventListener("pointermove", updatePointer, { passive: true });
  stage.addEventListener("pointerdown", updatePointer, { passive: true });
  stage.addEventListener("pointerleave", releasePointer, { passive: true });
  stage.addEventListener("pointerup", releasePointer, { passive: true });
  stage.addEventListener("pointercancel", releasePointer, { passive: true });

  // 机器人点击交互与终端状态汇报
  const boopRobot = () => {
    speechIndex = (speechIndex + 1) % SPEECH_MESSAGES.length;
    if (speechText) {
      speechText.textContent = SPEECH_MESSAGES[speechIndex];
    }
    if (speech) {
      speech.classList.add("is-active");
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => {
        speech.classList.remove("is-active");
      }, 3200);
    }
    if (robot) {
      robot.classList.add("is-booped");
      clearTimeout(boopTimer);
      boopTimer = setTimeout(() => {
        robot.classList.remove("is-booped");
      }, 680);
    }
    triggerRipple(Math.floor(NODE_COUNT * 0.5), -22);
  };

  if (robot) {
    robot.addEventListener("click", boopRobot);
  }

  // 与下方专题色卡悬停联动谐振
  const spectrumItems = document.querySelectorAll(".spectrum-item");
  const bandMap = [0, 3, 2, 4]; // 对应 MCU(黛蓝)、Linux(古铜)、Qt(苔绿)、工业通信(枣红)
  spectrumItems.forEach((item, index) => {
    item.addEventListener("mouseenter", () => {
      activeBandIndex = bandMap[index % bandMap.length];
      const targetNode = Math.floor(((index + 0.5) / Math.max(1, spectrumItems.length)) * (NODE_COUNT - 4)) + 2;
      triggerRipple(targetNode, -13);
      drawStripes();
    });
    item.addEventListener("mouseleave", () => {
      activeBandIndex = -1;
      drawStripes();
    });
    item.addEventListener("focus", () => {
      activeBandIndex = bandMap[index % bandMap.length];
      drawStripes();
    });
    item.addEventListener("blur", () => {
      activeBandIndex = -1;
      drawStripes();
    });
  });

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stage);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      inView = Boolean(entries[0] && entries[0].isIntersecting);
      if (inView) wakeUp();
    }, { threshold: 0.05 });
    observer.observe(stage);
  }

  const themeObserver = new MutationObserver(() => {
    drawStripes();
    wakeUp();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-skin"],
  });

  darkMedia.addEventListener("change", () => {
    drawStripes();
  });

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      isAnimating = false;
      drawStripes();
    } else {
      wakeUp();
    }
  });

  resize();
})();
