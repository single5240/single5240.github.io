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
})();
