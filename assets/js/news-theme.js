// Imported reports own data-theme (blueprint/paper), while the blog owns
// light/dark preference. Bridge only data-mode to preserve report layouts.
(() => {
  const key = 'single5240-theme';
  const root = document.documentElement;
  const apply = () => {
    try {
      const value = localStorage.getItem(key);
      root.dataset.mode = value === 'light' || value === 'dark' ? value : 'auto';
      const select = document.querySelector('select[data-am="mode"]');
      if (select) select.value = root.dataset.mode;
    } catch { /* The report remains usable without browser storage. */ }
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelector('select[data-am="mode"]')?.addEventListener('change', event => {
      try {
        if (event.target.value === 'auto') localStorage.removeItem(key);
        else localStorage.setItem(key, event.target.value);
      } catch { /* Keep the selected report mode for this page. */ }
    });
  });
  addEventListener('storage', event => { if (event.key === key) apply(); });
})();
