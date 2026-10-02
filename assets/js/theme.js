(() => {
  const storageKey = "single5240-theme";
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  let preference = "system";
  let select;

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") preference = stored;
  } catch {
    // Storage can be unavailable in privacy modes; system mode still works.
  }

  const resolvedTheme = () => (
    preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference
  );

  const applyTheme = () => {
    if (preference === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = preference;
    }

    root.dataset.themePreference = preference;
    if (select) select.value = preference;
    if (themeColor) themeColor.content = resolvedTheme() === "dark" ? "#11191d" : "#f8faf7";
  };

  const savePreference = (value) => {
    preference = value;
    try {
      if (value === "system") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, value);
    } catch {
      // Keep the current page usable even when storage is blocked.
    }
    applyTheme();
  };

  applyTheme();

  document.addEventListener("DOMContentLoaded", () => {
    const navLinks = document.querySelector(".nav-links");
    const topbar = document.querySelector(".topbar");
    if (!navLinks && !topbar) return;

    const control = document.createElement("label");
    control.className = "theme-control";
    control.innerHTML = `
      <span class="visually-hidden">颜色模式</span>
      <select class="theme-select" aria-label="颜色模式">
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    `;
    select = control.querySelector("select");
    select.value = preference;
    select.addEventListener("change", () => savePreference(select.value));

    if (navLinks) {
      const actions = document.createElement("div");
      actions.className = "nav-actions";
      navLinks.before(actions);
      actions.append(navLinks, control);
    } else {
      const actions = document.createElement("div");
      actions.className = "topbar-actions";
      const back = topbar.querySelector(".back");
      if (back) actions.append(back);
      actions.append(control);
      topbar.append(actions);
    }
  });

  const handleSystemChange = () => {
    if (preference === "system") applyTheme();
  };

  if (systemTheme.addEventListener) systemTheme.addEventListener("change", handleSystemChange);
  else systemTheme.addListener(handleSystemChange);

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    preference = event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system";
    applyTheme();
  });
})();
