(() => {
  const root = document.querySelector('[data-search]');
  if (!root) return;
  const input = root.querySelector('input');
  const status = root.querySelector('[role="status"]');
  const buttons = [...root.querySelectorAll('[data-topic-filter]')];
  const items = [...document.querySelectorAll('[data-search-item]')];
  const empty = document.querySelector('.search-empty');
  const params = new URLSearchParams(location.search);
  let topic = buttons.some(button => button.dataset.topicFilter === params.get('topic')) ? params.get('topic') : '';
  // Server-rendered text is the fallback if the optional index is unavailable.
  const normalize = text => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  let texts = items.map(item => normalize(item.querySelector('.item-body').textContent));
  input.value = params.get('q') || '';
  const render = () => {
    const words = normalize(input.value).split(' ').filter(Boolean);
    let count = 0;
    items.forEach((item, i) => {
      const matches = (!topic || item.dataset.topic.split(' ').includes(topic)) && words.every(word => texts[i].includes(word));
      item.hidden = !matches;
      if (matches) count += 1;
    });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topicFilter === topic)));
    status.textContent = `显示 ${count} / ${items.length} 篇笔记${input.value.trim() ? ` · 搜索“${input.value.trim()}”` : ''}`;
    empty.hidden = count !== 0;
    const url = new URL(location.href);
    if (input.value.trim()) url.searchParams.set('q', input.value.trim()); else url.searchParams.delete('q');
    if (topic) url.searchParams.set('topic', topic); else url.searchParams.delete('topic');
    history.replaceState(null, '', url);
  };
  root.querySelector('.search-controls').hidden = false;
  root.querySelector('.filter-controls').hidden = false;
  input.addEventListener('input', render);
  root.querySelector('.clear-search').addEventListener('click', () => { input.value = ''; topic = ''; render(); input.focus(); });
  buttons.forEach(button => button.addEventListener('click', () => { topic = button.dataset.topicFilter; render(); }));
  render();
  fetch(root.dataset.indexUrl).then(response => {
    if (!response.ok) throw new Error('Search index unavailable');
    return response.json();
  }).then(entries => {
    if (!Array.isArray(entries)) return;
    const byUrl = new Map(entries.map(entry => [entry.url, normalize([entry.title, entry.description, ...(entry.tags || [])].join(' '))]));
    texts = items.map((item, i) => byUrl.get(item.querySelector('h3 a').getAttribute('href')) || texts[i]);
    render();
  }).catch(() => { /* Keep local filtering usable offline or on a failed request. */ });
})();
