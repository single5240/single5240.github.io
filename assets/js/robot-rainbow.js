(() => {
  const stage = document.querySelector("#rainbowMascotStage");
  const canvas = document.querySelector("#rainbowCanvas");
  const robot = document.querySelector("#retroRobot");
  const speech = document.querySelector("#robotSpeech");
  const speechText = document.querySelector("#robotSpeechText");

  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // 专题色彩与复古物理光谱带配置
  const STRIPES = [
    { color: "#00f0ff", offset: -16, width: 4.5 }, // MCU / 外设
    { color: "#38bdf8", offset: -10, width: 4.5 }, // 驱动与时钟
    { color: "#10b981", offset: -4,  width: 4.5 }, // Qt / 声明式
    { color: "#f59e0b", offset: 2,   width: 4.5 }, // Linux 内核
    { color: "#f43f5e", offset: 8,   width: 4.5 }, // 工业现场总线
    { color: "#a855f7", offset: 14,  width: 4.5 }, // 逻辑与固件
  ];

  const SPEECH_MESSAGES = [
    "SYSTEM ONLINE ⚡",
    "SPECTRUM RESONANCE 🌈",
    "PING 0x5240 -> ACK",
    "MCU CLOCK: 144MHz",
    "BAUD: 115200 8-N-1",
    "I2C / SPI DMA OK",
    "FIRMWARE READY 🚀",
  ];
  let speechIndex = 0;
  let speechTimer = null;

  // 质点弹簧链配置
  const NODE_COUNT = 34;
  const SPRING_K = 0.046;
  const DAMPING = 0.88;
  const NEIGHBOR_COUPLING_Y = 0.14;
  const NEIGHBOR_COUPLING_X = 0.07;
  const MAGNETIC_RADIUS = 190;
  const MAGNETIC_FORCE = 3.8;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let nodes = [];
  let isPointerActive = false;
  let pointerX = -9999;
  let pointerY = -9999;
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

    updateBase(w, h) {
      this.ox = this.t * w;
      // 倒悬链平滑拱形彩虹曲线，拱顶位于机器人头顶上方
      const arch = Math.pow(Math.sin(Math.PI * this.t), 0.82);
      this.oy = (h - 16) - (h - 48) * arch;

      if (!isAnimating) {
        this.x = this.ox;
        this.y = this.oy;
      }
    }
  }

  const initNodes = () => {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i += 1) {
      const t = i / (NODE_COUNT - 1);
      const node = new Node(t);
      node.updateBase(width, height);
      node.x = node.ox;
      node.y = node.oy;
      nodes.push(node);
    }
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    width = Math.max(300, Math.floor(rect.width));
    height = Math.max(120, Math.floor(rect.height || 160));
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
        node.updateBase(width, height);
      }
    }

    renderStatic();
    wakeUp();
  };

  const isDarkMode = () => {
    return document.documentElement.getAttribute("data-theme") !== "light";
  };

  const drawStripes = () => {
    ctx.clearRect(0, 0, width, height);

    const dark = isDarkMode();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stripe of STRIPES) {
      ctx.beginPath();
      ctx.lineWidth = stripe.width;
      ctx.strokeStyle = stripe.color;

      if (dark) {
        ctx.shadowColor = stripe.color;
        ctx.shadowBlur = 7;
        ctx.globalAlpha = 0.94;
      } else {
        ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
        ctx.shadowBlur = 2;
        ctx.globalAlpha = 0.9;
      }

      // 通过相邻节点间中点平滑二次贝塞尔曲线连接
      const firstY = nodes[0].y + stripe.offset;
      ctx.moveTo(nodes[0].x, firstY);

      for (let i = 1; i < nodes.length - 1; i += 1) {
        const xc = (nodes[i].x + nodes[i + 1].x) * 0.5;
        const yc = (nodes[i].y + nodes[i + 1].y + stripe.offset * 2) * 0.5;
        ctx.quadraticCurveTo(nodes[i].x, nodes[i].y + stripe.offset, xc, yc);
      }

      const last = nodes[nodes.length - 1];
      ctx.quadraticCurveTo(last.x, last.y + stripe.offset, last.x, last.y + stripe.offset);
      ctx.stroke();
    }

    // 重置 shadow 避免污染后续绘制
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  const renderStatic = () => {
    drawStripes();
  };

  const wakeUp = () => {
    if (reducedMotion.matches) {
      renderStatic();
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

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];

      // 两端锚点固定
      if (i === 0 || i === nodes.length - 1) {
        node.x = node.ox;
        node.y = node.oy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      // 1. 恢复到基准静止形态的胡克弹力
      const fx = (node.ox - node.x) * SPRING_K;
      const fy = (node.oy - node.y) * SPRING_K;
      node.vx += fx;
      node.vy += fy;

      // 2. 相邻质点张力耦合，保持缎带连续平滑
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      const avgY = (prev.y + next.y) * 0.5;
      const avgX = (prev.x + next.x) * 0.5;
      node.vy += (avgY - node.y) * NEIGHBOR_COUPLING_Y;
      node.vx += (avgX - node.x) * NEIGHBOR_COUPLING_X;

      // 3. 鼠标/触控指针磁力吸附与拉扯
      if (isPointerActive) {
        const dx = pointerX - node.x;
        const dy = pointerY - node.y;
        const dist = Math.hypot(dx, dy);

        if (dist < MAGNETIC_RADIUS && dist > 1) {
          const ratio = (1 - dist / MAGNETIC_RADIUS);
          const pull = ratio * ratio * MAGNETIC_FORCE;
          node.vx += (dx / dist) * pull;
          node.vy += (dy / dist) * pull;
        }
      }

      // 4. 阻尼衰减
      node.vx *= DAMPING;
      node.vy *= DAMPING;

      // 5. 位置积分
      node.x += node.vx;
      node.y += node.vy;

      const v = Math.hypot(node.vx, node.vy);
      if (v > maxVel) maxVel = v;
    }

    drawStripes();

    // 当能量耗散至微弱且无外部指针交互时休眠，节约 CPU/电池
    if (maxVel < 0.008 && !isPointerActive) {
      for (const node of nodes) {
        node.x = node.ox;
        node.y = node.oy;
        node.vx = 0;
        node.vy = 0;
      }
      drawStripes();
      isAnimating = false;
    } else {
      requestAnimationFrame(tick);
    }
  };

  // 激起波纹脉冲（供点击机器人或悬浮专题色卡调用）
  const triggerRipple = (sourceIndex = Math.floor(NODE_COUNT * 0.5), force = -22) => {
    if (reducedMotion.matches) return;
    if (sourceIndex >= 0 && sourceIndex < nodes.length) {
      nodes[sourceIndex].vy += force;
      if (sourceIndex > 0) nodes[sourceIndex - 1].vy += force * 0.65;
      if (sourceIndex < nodes.length - 1) nodes[sourceIndex + 1].vy += force * 0.65;
      wakeUp();
    }
  };

  // 指针事件监听
  const updatePointer = (e) => {
    const rect = stage.getBoundingClientRect();
    pointerX = e.clientX - rect.left;
    pointerY = e.clientY - rect.top;
    isPointerActive = true;
    wakeUp();
  };

  stage.addEventListener("pointermove", updatePointer, { passive: true });
  stage.addEventListener("pointerdown", updatePointer, { passive: true });

  const releasePointer = () => {
    isPointerActive = false;
    pointerX = -9999;
    pointerY = -9999;
  };

  stage.addEventListener("pointerleave", releasePointer, { passive: true });
  stage.addEventListener("pointerup", releasePointer, { passive: true });
  stage.addEventListener("pointercancel", releasePointer, { passive: true });

  // 机器人交互与对话气泡
  const showNextSpeech = () => {
    speechIndex = (speechIndex + 1) % SPEECH_MESSAGES.length;
    if (speechText) {
      speechText.textContent = SPEECH_MESSAGES[speechIndex];
    }
    if (speech) {
      speech.classList.add("is-active");
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => {
        speech.classList.remove("is-active");
      }, 3500);
    }
  };

  if (robot) {
    robot.addEventListener("click", () => {
      showNextSpeech();
      triggerRipple(Math.floor(NODE_COUNT * 0.5), -24);
    });

    robot.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showNextSpeech();
        triggerRipple(Math.floor(NODE_COUNT * 0.5), -24);
      }
    });
  }

  // 与下方的专题色卡悬浮联动共振
  const spectrumItems = document.querySelectorAll(".spectrum-item");
  spectrumItems.forEach((item, index) => {
    item.addEventListener("mouseenter", () => {
      const targetNode = Math.floor(((index + 0.5) / Math.max(1, spectrumItems.length)) * NODE_COUNT);
      triggerRipple(targetNode, -14);
    });
  });

  // 窗口尺寸自适应与视口监听
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
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

  // 主题切换后重绘
  const themeObserver = new MutationObserver(() => {
    renderStatic();
    wakeUp();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // 减弱动态偏好变更
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      isAnimating = false;
      renderStatic();
    } else {
      wakeUp();
    }
  });

  resize();
})();
