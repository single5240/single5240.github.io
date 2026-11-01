(() => {
  const container = document.getElementById('guestbook-comments');
  const status = document.getElementById('guestbook-status');
  if (!container || !status) return;
  status.hidden = false;
  status.textContent = '正在加载留言板…';

  const origin = 'https://utteranc.es';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = () => {
    const selected = document.documentElement.dataset.theme;
    const dark = selected === 'dark' || selected === 'hud' || (!selected && systemTheme.matches);
    return dark ? 'github-dark' : 'github-light';
  };
  const syncTheme = () => {
    container.querySelector('iframe')?.contentWindow.postMessage({
      type: 'set-theme', theme: theme(),
    }, origin);
  };
  const fail = () => {
    status.hidden = false;
    status.textContent = '留言板暂时无法加载，请使用上方 GitHub 链接查看留言，或刷新页面重试。';
  };
  const timeout = window.setTimeout(fail, 20000);

  // Observe before inserting the script so even a cached iframe is detected.
  const frames = new MutationObserver(() => {
    const frame = container.querySelector('iframe');
    if (!frame) return;
    frame.title = '留言板（GitHub 登录）';
    frame.loading = 'eager';
    frame.addEventListener('load', () => {
      window.clearTimeout(timeout);
      status.hidden = true;
      syncTheme();
    });
    frames.disconnect();
  });
  frames.observe(container, { childList: true, subtree: true });

  const script = document.createElement('script');
  script.src = `${origin}/client.js`;
  script.setAttribute('repo', 'single5240/single5240.github.io');
  // A fixed term shares the same conversation across GitHub Pages and mirrors.
  script.setAttribute('issue-term', 'about-guestbook');
  script.setAttribute('theme', theme());
  script.crossOrigin = 'anonymous';
  script.async = true;
  script.addEventListener('error', () => {
    window.clearTimeout(timeout);
    fail();
  });
  container.append(script);

  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
  systemTheme.addEventListener('change', syncTheme);
})();
