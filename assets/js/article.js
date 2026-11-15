(() => {
  const content = document.querySelector('.content');
  if (!content) return;
  try {
    const saved = sessionStorage.getItem('article-archive-return');
    const referrer = document.referrer ? new URL(document.referrer) : null;
    if (saved && referrer?.origin === location.origin && referrer.pathname.endsWith('/articles/index.html')) {
      const target = new URL(saved, location.origin);
      if (target.origin === location.origin && target.pathname === referrer.pathname) {
        document.querySelectorAll('.article-header > a, .reading-main > .back').forEach((link) => {
          link.href = target.href;
          link.textContent = '← 返回搜索结果';
        });
      }
    }
  } catch { /* Archive links retain their static fallback. */ }

  const toc = document.querySelector('#article-toc');
  const list = toc ? toc.querySelector('ol') : null;
  const headings = [...content.querySelectorAll('h2,h3')];
  const links = new Map();

  // Keep existing Markdown anchors stable; generate only missing IDs.
  if (toc && list) {
    headings.forEach((heading, index) => {
      if (!heading.id) {
        const base = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `section-${index + 1}`;
        let id = base;
        for (let n = 2; document.getElementById(id); n += 1) id = `${base}-${n}`;
        heading.id = id;
      }
      const item = document.createElement('li');
      if (heading.tagName === 'H3') item.className = 'toc-sub';
      const link = document.createElement('a');
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = heading.textContent;
      item.append(link);
      list.append(item);
      links.set(heading, link);
    });
    toc.hidden = headings.length < 2;
    list.addEventListener('click', (event) => {
      if (event.target.closest('a') && matchMedia('(max-width: 1000px)').matches) {
        toc.open = false;
      }
    });
  }

  content.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '可横向滚动的表格');
    table.replaceWith(wrap);
    wrap.append(table);
  });

  if (window.S5CodeBlocks) {
    window.S5CodeBlocks.enhance(content, {
      excludeSelector: '.font-c-export, .article-interactive-widget',
      idPrefix: 'code-block-',
    });
  }

  const progress = document.querySelector('#reading-progress');
  let ticking = false;
  const update = () => {
    const height = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0})`;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > 150) break;
      current = heading;
    }
    links.forEach((link, heading) => {
      if (heading === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    ticking = false;
  };
  const schedule = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  update();

  // 专题/系列阅读导航与目录交互
  function initSeriesNav() {
    const dropdown = document.querySelector('#series-toc-dropdown');
    if (!dropdown) return;

    document.addEventListener('click', (e) => {
      if (dropdown.open && !dropdown.contains(e.target)) {
        dropdown.open = false;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.open) {
        dropdown.open = false;
        dropdown.querySelector('summary')?.focus();
      }
    });
  }

  try {
    initSeriesNav();
  } catch (err) {
    console.warn('[Article] Failed to initialize series navigation:', err);
  }
})();
