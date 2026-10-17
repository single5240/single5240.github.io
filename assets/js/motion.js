(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");

  // 1. 内容淡入动画
  const revealItems = [...document.querySelectorAll(".article-card, .panel, .article-item, .project-feature")];
  revealItems.forEach((item) => {
    item.classList.add("motion-reveal");
  });

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

    revealItems.forEach((item) => observer.observe(item));
  }

  // 2. 回到顶部按钮
  const backToTop = document.createElement("button");
  backToTop.type = "button";
  backToTop.className = "back-to-top";
  backToTop.setAttribute("aria-label", "回到页面顶部");
  backToTop.setAttribute("title", "回到顶部");
  backToTop.setAttribute("aria-hidden", "true");
  backToTop.tabIndex = -1;
  backToTop.textContent = "↑";
  document.body.append(backToTop);

  // 3. 全站顶部微型阅读进度条
  let progressBar = document.querySelector("#reading-progress");
  const isArticlePage = Boolean(document.querySelector(".reading-layout"));
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.id = "reading-progress";
    progressBar.className = "reading-progress";
    progressBar.setAttribute("aria-hidden", "true");
    document.body.prepend(progressBar);
  }

  let ticking = false;
  const updateScrollState = () => {
    // 更新回到顶部
    const visible = window.scrollY > 560;
    backToTop.classList.toggle("is-visible", visible);
    backToTop.setAttribute("aria-hidden", String(!visible));
    backToTop.tabIndex = visible ? 0 : -1;

    // 如果是非文章页，由 motion.js 负责更新顶部进度条
    if (!isArticlePage && progressBar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progressValue = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progressBar.style.transform = `scaleX(${progressValue})`;
    }

    ticking = false;
  };

  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateScrollState);
  }, { passive: true });

  addEventListener("resize", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateScrollState);
  }, { passive: true });

  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  });

  updateScrollState();

  // 4. 自定义双层微光光标（非触屏且未开启减弱动效时生效）
  if (finePointer.matches && !reducedMotion.matches) {
    const dot = document.createElement("div");
    dot.className = "cursor-dot";
    dot.id = "cursorDot";
    dot.setAttribute("aria-hidden", "true");

    const ring = document.createElement("div");
    ring.className = "cursor-ring";
    ring.id = "cursorRing";
    ring.setAttribute("aria-hidden", "true");

    document.body.append(dot, ring);

    let mx = -100, my = -100;
    let rx = -100, ry = -100;
    let visible = false;
    let isHover = false;
    let isPressed = false;

    const interactiveSelector = "a, button, input, textarea, summary, select, [role='button'], .article-item, .project-feature, .daily-links a, .theme-spectrum .spectrum-item, .filter-list button";

    document.addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;

      if (!visible) {
        visible = true;
        rx = mx;
        ry = my;
        dot.style.opacity = "1";
        ring.style.opacity = "1";
      }

      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;

      const target = e.target.closest(interactiveSelector);
      const nowHover = Boolean(target);
      if (nowHover !== isHover) {
        isHover = nowHover;
        ring.classList.toggle("is-hover", isHover);
      }
    }, { passive: true });

    document.addEventListener("mousedown", () => {
      isPressed = true;
      ring.classList.add("is-pressed");
    });

    document.addEventListener("mouseup", () => {
      isPressed = false;
      ring.classList.remove("is-pressed");
    });

    document.addEventListener("mouseleave", () => {
      visible = false;
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    });

    const renderCursor = () => {
      if (visible) {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        const scale = isPressed ? " scale(0.82)" : "";
        ring.style.transform = `translate(${rx.toFixed(2)}px, ${ry.toFixed(2)}px) translate(-50%, -50%)${scale}`;
      }
      requestAnimationFrame(renderCursor);
    };
    requestAnimationFrame(renderCursor);
  }

  // 5. 卡片 3D 视差微倾斜（CSS perspective + 鼠标坐标计算）
  if (finePointer.matches && !reducedMotion.matches) {
    const tiltSelector = ".article-item, .project-feature, .daily-links a, .daily-quote";
    const cards = document.querySelectorAll(tiltSelector);
    cards.forEach((card) => card.classList.add("tilt-card"));

    document.addEventListener("pointermove", (e) => {
      const card = e.target.closest(tiltSelector);
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;

      const rotateX = (-y * 6.5).toFixed(2);
      const rotateY = (x * 6.5).toFixed(2);

      card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
      card.style.transition = "transform 120ms ease-out";
    }, { passive: true });

    document.addEventListener("pointerout", (e) => {
      const card = e.target.closest(tiltSelector);
      if (!card) return;
      if (!card.contains(e.relatedTarget)) {
        card.style.transform = "";
        card.style.transition = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)";
      }
    });
  }
})();
