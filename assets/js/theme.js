(() => {
  const storageKey = "single5240-theme";
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const validThemes = ["system", "light", "dark", "swiss", "hud", "mono"];

  const labels = {
    system: "跟随系统",
    light: "默认浅色",
    dark: "默认深色",
    swiss: "瑞士网格",
    hud: "深空终端",
    mono: "极简单色",
  };

  const icons = {
    system: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>',
    light: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>',
    dark: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z"></path></svg>',
    swiss: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>',
    hud: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"></path></svg>',
    mono: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"></path></svg>',
  };

  const themeColors = {
    light: "#f8faf7",
    dark: "#11191d",
    swiss: "#f5f5f2",
    hud: "#040b15",
    mono: "#faf9f6",
  };

  const pickers = [];
  let preference = "system";

  try {
    const stored = localStorage.getItem(storageKey);
    if (validThemes.includes(stored)) preference = stored;
  } catch {
    // Storage can be unavailable in privacy modes; system mode still works.
  }

  const resolvedTheme = () => (
    preference === "system" ? (systemTheme.matches ? "dark" : "light") : preference
  );

  const closePicker = (picker, restoreFocus = false) => {
    picker.menu.hidden = true;
    picker.toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) picker.toggle.focus();
  };

  const updatePickers = () => {
    pickers.forEach((picker) => {
      picker.icon.innerHTML = icons[preference] || icons.system;
      picker.toggle.setAttribute("aria-label", `颜色模式：${labels[preference] || labels.system}`);
      picker.options.forEach((option) => {
        option.setAttribute("aria-checked", String(option.dataset.themeValue === preference));
      });
    });
  };

  const applyTheme = () => {
    if (preference === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = preference;
    }

    root.dataset.themePreference = preference;
    const current = resolvedTheme();
    if (themeColor) {
      themeColor.content = themeColors[current] || (current === "dark" || current === "hud" ? "#040b15" : "#f8faf7");
    }
    updatePickers();
  };

  const savePreference = (value) => {
    preference = validThemes.includes(value) ? value : "system";
    try {
      if (preference === "system") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, preference);
    } catch {
      // Keep current page usable even when storage is blocked.
    }
    applyTheme();
  };

  applyTheme();

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-picker]").forEach((element, index) => {
      const menuId = `theme-menu-${index + 1}`;
      element.innerHTML = `
        <button class="theme-toggle" type="button" aria-label="颜色模式" aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}">
          <span data-theme-current-icon>${icons[preference] || icons.system}</span>
          <span class="theme-toggle-label">主题</span>
        </button>
        <div class="theme-menu" id="${menuId}" role="menu" aria-label="选择颜色模式" hidden>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="system" aria-checked="false">
            ${icons.system}<span class="theme-option-label">跟随系统</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="light" aria-checked="false">
            ${icons.light}<span class="theme-option-label">默认浅色</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="dark" aria-checked="false">
            ${icons.dark}<span class="theme-option-label">默认深色</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="swiss" aria-checked="false">
            ${icons.swiss}<span class="theme-option-label">瑞士网格</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="hud" aria-checked="false">
            ${icons.hud}<span class="theme-option-label">深空终端</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" data-theme-value="mono" aria-checked="false">
            ${icons.mono}<span class="theme-option-label">极简单色</span><span class="theme-option-check" aria-hidden="true">✓</span>
          </button>
        </div>
      `;

      const picker = {
        element,
        toggle: element.querySelector(".theme-toggle"),
        icon: element.querySelector("[data-theme-current-icon]"),
        menu: element.querySelector(".theme-menu"),
        options: [...element.querySelectorAll("[data-theme-value]")],
      };
      pickers.push(picker);

      picker.toggle.addEventListener("click", (event) => {
        const willOpen = picker.menu.hidden;
        pickers.forEach((item) => closePicker(item));
        picker.menu.hidden = !willOpen;
        picker.toggle.setAttribute("aria-expanded", String(willOpen));
        if (willOpen && event.detail === 0) {
          picker.options.find((option) => option.dataset.themeValue === preference)?.focus();
        }
      });

      picker.options.forEach((option) => {
        option.addEventListener("click", (event) => {
          savePreference(option.dataset.themeValue);
          closePicker(picker, event.detail === 0);
        });
      });

      picker.element.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          picker.menu.hidden = false;
          picker.toggle.setAttribute("aria-expanded", "true");
          const current = picker.options.indexOf(document.activeElement);
          const target = event.key === "Home" ? 0 : event.key === "End" ? picker.options.length - 1 :
            event.key === "ArrowDown" ? (current + 1) % picker.options.length : (current <= 0 ? picker.options.length - 1 : current - 1);
          picker.options[target].focus();
          return;
        }
        if (event.key !== "Escape" || picker.menu.hidden) return;
        event.preventDefault();
        closePicker(picker, true);
      });
    });

    updatePickers();

    document.addEventListener("click", (event) => {
      pickers.forEach((picker) => {
        if (!picker.element.contains(event.target)) closePicker(picker);
      });
    });
  });

  const handleSystemChange = () => {
    if (preference === "system") applyTheme();
  };

  if (systemTheme.addEventListener) systemTheme.addEventListener("change", handleSystemChange);
  else systemTheme.addListener(handleSystemChange);

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    preference = validThemes.includes(event.newValue) ? event.newValue : "system";
    applyTheme();
  });
})();
