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

  // 4. 嵌入式心跳时钟（严格北京时间 BJT）
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
    setInterval(updateClock, 5000);
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
})();
