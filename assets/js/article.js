(() => {
  const content = document.querySelector('.content');
  if (!content) return;
  const toc = document.querySelector('#article-toc');
  const list = toc.querySelector('ol');
  const headings = [...content.querySelectorAll('h2,h3')];
  const links = new Map();
  // Keep existing Markdown anchors stable; generate only missing IDs.
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
  if (matchMedia('(max-width: 1000px)').matches) toc.open = false;

  content.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '可横向滚动的表格');
    table.replaceWith(wrap);
    wrap.append(table);
  });
  content.querySelectorAll('pre').forEach((pre) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const language = document.createElement('span');
    language.textContent = pre.closest('[class*="language-"]')?.className.match(/language-([\w+-]+)/)?.[1] || 'text';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    button.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);
        button.textContent = '已复制';
      } catch { button.textContent = '复制失败'; }
      setTimeout(() => { button.textContent = '复制'; }, 1800);
    });
    toolbar.append(language, button);
    pre.replaceWith(wrapper);
    wrapper.append(toolbar, pre);
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', `${language.textContent} 代码，可横向滚动`);
  });
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
  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', schedule);
  update();
})();
