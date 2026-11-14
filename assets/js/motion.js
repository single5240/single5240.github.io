(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");

  // 手机端先展示项目本身，长笔记列表由读者按需展开。
  if (window.matchMedia("(max-width: 620px)").matches) {
    document.querySelectorAll(".project-notes").forEach((notes) => { notes.open = false; });
  }

  // 1. iOS 18 级联弹簧入场动画 (Staggered Spring Reveal)
  const revealSelector = [
    ".workbench-console",
    ".project-mini-card",
    ".article-card",
    ".panel",
    ".article-item",
    ".project-feature",
    ".aside-card",
    ".explore-links a",
    ".skills-arch-card",
    ".tool-card",
    ".daily-links a",
    ".daily-archive-grid section",
    ".article-interactive-widget"
  ].join(", ");

  const revealItems = [...document.querySelectorAll(revealSelector)];
  const parentCounts = new Map();

  revealItems.forEach((item) => {
    item.classList.add("motion-reveal");
    const parent = item.parentElement;
    if (parent) {
      const idx = parentCounts.get(parent) || 0;
      item.style.setProperty("--stagger-idx", String(Math.min(idx, 6)));
      parentCounts.set(parent, idx + 1);
    }
    item.addEventListener("transitionend", (e) => {
      if (e.target === item && item.classList.contains("is-visible")) {
        item.classList.add("is-settled");
      }
    }, { passive: true });
  });

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealItems.forEach((item) => {
      item.classList.add("is-visible", "is-settled");
    });
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6%", threshold: 0.08 });

    revealItems.forEach((item) => observer.observe(item));
  }

  // 1.5 iOS 18 导航栏分段胶囊流体滑块 (Segmented Control Fluid Glider)
  const initNavGlider = () => {
    const navLinks = document.querySelector(".nav-links");
    if (!navLinks || navLinks.querySelector(".nav-pill-glider")) return;

    const links = [...navLinks.querySelectorAll("a")];
    if (!links.length) return;

    const glider = document.createElement("span");
    glider.className = "nav-pill-glider";
    glider.setAttribute("aria-hidden", "true");
    navLinks.prepend(glider);
    navLinks.classList.add("has-glider");

    const currentLink = () => navLinks.querySelector('a[aria-current="page"]');
    let activeTarget = currentLink();
    let glideTimer = null;

    const moveGliderTo = (target, animateStretch = true) => {
      if (!target) {
        glider.style.opacity = "0";
        return;
      }
      const x = target.offsetLeft;
      const y = target.offsetTop;
      const w = target.offsetWidth;
      const h = target.offsetHeight;

      glider.style.width = `${w}px`;
      glider.style.height = `${h}px`;
      glider.style.setProperty("--glider-x", `${x}px`);
      glider.style.setProperty("--glider-y", `${y}px`);
      glider.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      glider.style.opacity = "1";

      if (animateStretch && !reducedMotion.matches) {
        glider.classList.add("is-gliding");
        if (glideTimer) clearTimeout(glideTimer);
        glideTimer = setTimeout(() => {
          glider.classList.remove("is-gliding");
        }, 210);
      }
    };

    // 初次定位无拉伸
    moveGliderTo(activeTarget, false);

    links.forEach((link) => {
      link.addEventListener("mouseenter", () => {
        if (!finePointer.matches) return;
        activeTarget = link;
        moveGliderTo(link, true);
      });
      link.addEventListener("focus", () => {
        activeTarget = link;
        moveGliderTo(link, true);
      });
      link.addEventListener("click", () => {
        activeTarget = link;
        moveGliderTo(link, true);
      });
    });

    navLinks.addEventListener("mouseleave", () => {
      if (!finePointer.matches) return;
      activeTarget = currentLink();
      moveGliderTo(activeTarget, true);
    });

    const syncGlider = () => {
      moveGliderTo(activeTarget || currentLink(), false);
    };

    addEventListener("resize", syncGlider, { passive: true });
    addEventListener("load", syncGlider, { once: true });
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(syncGlider);
      ro.observe(navLinks);
    }
  };

  initNavGlider();

  // 1.8 iOS 18 全局触控弹簧按压引擎 (兼顾移动端 UIScrollView 防误触滚动延迟)
  if (!reducedMotion.matches) {
    const immediateSelector = [
      ".button",
      ".nav-links a",
      ".brand",
      ".search-link",
      ".theme-toggle",
      ".theme-option",
      ".home-topic-links a",
      ".filter-list button",
      ".tools-tab-btn",
      ".tool-btn",
      ".load-more-btn",
      ".back-to-top",
      ".scope-pause",
      ".copy-button",
      ".kb-btn"
    ].join(", ");

    const pressSelector = [
      immediateSelector,
      ".project-mini-card",
      ".article-item",
      ".feed-item",
      ".aside-tools-list a",
      ".explore-links a",
      ".daily-links a",
      ".skills-arch-card",
      ".toc a",
      ".article-navigation a",
      ".kb-card"
    ].join(", ");

    const pressTimestamps = new WeakMap();
    let touchTimer = null;
    let pendingTarget = null;
    let hasPressing = false;
    let startX = 0;
    let startY = 0;

    const clearPendingTouch = () => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      pendingTarget = null;
    };

    const clearAllPressing = () => {
      if (!hasPressing) return;
      hasPressing = false;
      document.querySelectorAll(".is-pressing").forEach((el) => {
        el.classList.remove("is-pressing");
      });
    };

    document.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const target = e.target.closest(pressSelector);
      if (!target) return;

      clearPendingTouch();
      startX = e.clientX;
      startY = e.clientY;

      // 移动端触摸大面积可滚动卡片时，延迟 70ms 确认非滑动手势再下压（还原 iOS UIScrollView.delaysContentTouches）
      if (e.pointerType === "touch" && !target.matches(immediateSelector)) {
        pendingTarget = target;
        touchTimer = setTimeout(() => {
          if (pendingTarget) {
            pendingTarget.classList.add("is-pressing");
            hasPressing = true;
            pressTimestamps.set(pendingTarget, performance.now());
            pendingTarget = null;
          }
          touchTimer = null;
        }, 70);
      } else {
        target.classList.add("is-pressing");
        hasPressing = true;
        pressTimestamps.set(target, performance.now());
      }
    }, { passive: true });

    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") return;
      if (!pendingTarget && !hasPressing) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 7) {
        clearPendingTouch();
        clearAllPressing();
      }
    }, { passive: true });

    const releasePress = (e) => {
      // 如果手指在 70ms 内快速轻点抬起（Tap），立即补发一次完整的 iOS 弹簧下压与回弹
      if (pendingTarget && e && e.type === "pointerup") {
        const tapped = pendingTarget;
        clearPendingTouch();
        tapped.classList.add("is-pressing");
        hasPressing = true;
        setTimeout(() => {
          tapped.classList.remove("is-pressing");
        }, 105);
        return;
      }
      clearPendingTouch();
      if (!hasPressing) return;

      const target = e && e.target && e.target.closest ? e.target.closest(pressSelector) : null;
      const candidates = target ? [target] : [...document.querySelectorAll(".is-pressing")];
      candidates.forEach((el) => {
        if (!el.classList.contains("is-pressing")) return;
        const start = pressTimestamps.get(el) || 0;
        const elapsed = performance.now() - start;
        const remain = Math.max(0, 105 - elapsed);
        setTimeout(() => {
          el.classList.remove("is-pressing");
        }, remain);
      });
      if (!target) hasPressing = false;
    };

    document.addEventListener("pointerup", releasePress, { passive: true });
    document.addEventListener("pointercancel", () => {
      clearPendingTouch();
      clearAllPressing();
    }, { passive: true });
    document.addEventListener("dragstart", releasePress, { passive: true });
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

  // 4. 嵌入式心跳时钟（严格北京时间 BJT）
  let clockTimer = null;
  const initClock = () => {
    const clockEl = document.querySelector("#statusClock");
    if (!clockEl) return;

    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      formatter = null;
    }

    const updateClock = () => {
      if (formatter) {
        try {
          clockEl.textContent = formatter.format(new Date());
          return;
        } catch {
          // fallback to local time
        }
      }
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      clockEl.textContent = `${hours}:${minutes}`;
    };

    updateClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 5000);
  };

  initClock();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initClock);
  }

  // 5. 全局键盘快捷键：按 / 键直接唤起搜索
  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const tag = active ? active.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (active && active.isContentEditable)) {
      return;
    }

    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const searchInput = document.querySelector("#article-search");
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else {
        const searchLink = document.querySelector(".search-link");
        if (searchLink) {
          e.preventDefault();
          window.location.href = searchLink.href;
        }
      }
    }
  });

  // 6. iOS 18 毛玻璃动态追光 (Specular Spotlight) 与 3D 视差微倾斜
  if (finePointer.matches && !reducedMotion.matches) {
    const spotlightSelector = [
      ".workbench-console",
      ".project-mini-card",
      ".project-feature",
      ".aside-card",
      ".skills-arch-card",
      ".explore-links a",
      ".tool-card",
      ".daily-links a"
    ].join(", ");

    const tiltSet = new Set([".project-feature", ".project-mini-card", ".explore-links a", ".skills-arch-card"]);

    const bindInteractiveCards = () => {
      const cards = document.querySelectorAll(spotlightSelector);
      cards.forEach((card) => {
        if (card.dataset.tiltBound) return;
        card.dataset.tiltBound = "true";

        let specular = card.querySelector(":scope > .ios-specular");
        if (!specular) {
          specular = document.createElement("span");
          specular.className = "ios-specular";
          specular.setAttribute("aria-hidden", "true");
          card.append(specular);
        }

        const canTilt = [...tiltSet].some((sel) => card.matches(sel));
        const maxDeg = card.matches(".project-feature") ? 7 : 4.5;

        let rafId = null;
        let cardRect = null;
        let spotX = 0;
        let spotY = 0;
        let targetX = 0;
        let targetY = 0;

        const updateCard = () => {
          specular.style.setProperty("--spot-x", `${spotX.toFixed(0)}px`);
          specular.style.setProperty("--spot-y", `${spotY.toFixed(0)}px`);

          if (canTilt && !card.classList.contains("is-pressing")) {
            const rotateX = (-targetY * maxDeg).toFixed(2);
            const rotateY = (targetX * maxDeg).toFixed(2);
            card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
          }
          rafId = null;
        };

        card.addEventListener("mouseenter", () => {
          cardRect = card.getBoundingClientRect();
          if (canTilt) {
            card.style.transition = "transform 0.16s ease-out, box-shadow 0.24s ease, border-color 0.2s ease";
          }
        }, { passive: true });

        card.addEventListener("mousemove", (e) => {
          const rect = cardRect || card.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          spotX = e.clientX - rect.left;
          spotY = e.clientY - rect.top;
          targetX = spotX / rect.width - 0.5;
          targetY = spotY / rect.height - 0.5;

          if (!rafId) {
            rafId = requestAnimationFrame(updateCard);
          }
        }, { passive: true });

        card.addEventListener("mouseleave", () => {
          cardRect = null;
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          if (canTilt) {
            card.style.transition = "transform 0.52s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.38s ease, border-color 0.24s ease";
            card.style.transform = "";
          }
        }, { passive: true });
      });
    };

    bindInteractiveCards();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindInteractiveCards);
    }
  }
})();
