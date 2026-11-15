(() => {
  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback to execCommand below
      }
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      area.style.pointerEvents = 'none';
      document.body.append(area);
      area.focus();
      area.select();
      const success = document.execCommand('copy');
      area.remove();
      return success;
    } catch {
      return false;
    }
  };

  const enhance = (root, options = {}) => {
    if (!root) return;
    const {
      selector = 'pre',
      excludeSelector = '',
      wrapperClass = 'code-block',
      toolbarClass = 'code-toolbar',
      actionsClass = 'code-actions',
      toggleClass = 'code-toggle',
      copyClass = 'copy-code',
      idPrefix = 'code-block-',
      labels = null,
      withToggleIcon = true,
      focusablePre = true,
    } = options;

    root.querySelectorAll(selector).forEach((pre, index) => {
      if (excludeSelector && pre.closest(excludeSelector)) return;
      if (pre.parentElement && pre.parentElement.classList.contains(wrapperClass)) return;

      const wrapper = document.createElement('div');
      wrapper.className = wrapperClass;
      const toolbar = document.createElement('div');
      toolbar.className = toolbarClass;

      const language = document.createElement('span');
      const langName = Array.isArray(labels)
        ? (labels[index] || 'code')
        : (typeof labels === 'function'
            ? labels(pre, index)
            : (pre.closest('[class*="language-"]')?.className.match(/language-([\w+-]+)/)?.[1] || 'text'));
      language.textContent = langName;

      const preId = pre.id || `${idPrefix}${index + 1}`;
      pre.id = preId;

      const actions = document.createElement('div');
      actions.className = actionsClass;

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = toggleClass;
      toggleButton.setAttribute('aria-expanded', 'true');
      toggleButton.setAttribute('aria-controls', preId);
      toggleButton.setAttribute('aria-label', '收起代码');

      let toggleText = toggleButton;
      if (withToggleIcon) {
        const toggleIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        toggleIcon.setAttribute('class', 'code-toggle-icon');
        toggleIcon.setAttribute('width', '12');
        toggleIcon.setAttribute('height', '12');
        toggleIcon.setAttribute('viewBox', '0 0 12 12');
        toggleIcon.setAttribute('fill', 'none');
        toggleIcon.setAttribute('stroke', 'currentColor');
        toggleIcon.setAttribute('stroke-width', '1.75');
        toggleIcon.setAttribute('stroke-linecap', 'round');
        toggleIcon.setAttribute('stroke-linejoin', 'round');
        toggleIcon.setAttribute('aria-hidden', 'true');
        const togglePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        togglePath.setAttribute('d', 'M2.5 7.5L6 4L9.5 7.5');
        toggleIcon.append(togglePath);

        toggleText = document.createElement('span');
        toggleText.textContent = '收起';
        toggleButton.append(toggleIcon, toggleText);
      } else {
        toggleButton.textContent = '收起';
      }

      const toggleCollapse = () => {
        const isCollapsed = wrapper.classList.toggle('is-collapsed');
        toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
        toggleButton.setAttribute('aria-label', isCollapsed ? '展开代码' : '收起代码');
        toggleText.textContent = isCollapsed ? '展开' : '收起';
        pre.hidden = isCollapsed;
      };

      toggleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapse();
      });

      toolbar.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        if (wrapper.classList.contains('is-collapsed')) {
          toggleCollapse();
        }
      });

      const button = document.createElement('button');
      button.type = 'button';
      button.className = copyClass;
      button.textContent = '复制';
      button.setAttribute('aria-label', '复制代码');
      button.setAttribute('aria-live', 'polite');
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const text = pre.querySelector('code')?.textContent || pre.textContent;
        const ok = await copyText(text);
        button.textContent = ok ? '已复制' : '复制失败';
        setTimeout(() => { button.textContent = '复制'; }, 1800);
      });

      actions.append(toggleButton, button);
      toolbar.append(language, actions);
      pre.replaceWith(wrapper);
      wrapper.append(toolbar, pre);
      if (focusablePre) {
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', `${langName} 代码，可横向滚动`);
      }
    });
  };

  window.S5CodeBlocks = { copyText, enhance };
})();
