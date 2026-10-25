// Applies the colour theme before the page paints (load it as a blocking
// <script> in <head>). Modes: 'system' (default, follows the OS) | 'light' |
// 'dark'. The resolved theme is written to <html data-theme="light|dark">.
(() => {
  const KEY = 'flowdoc.theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const read = () => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  };
  let mode = read();
  const listeners = new Set();
  const resolved = () => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode);
  const apply = () => {
    document.documentElement.dataset.theme = resolved();
    listeners.forEach((fn) => fn(mode, resolved()));
  };

  media.addEventListener('change', () => mode === 'system' && apply());
  // Other pages of the app (popup, other workspace tabs) changed it.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      mode = read();
      apply();
    }
  });

  window.flowdocTheme = {
    get mode() {
      return mode;
    },
    get resolved() {
      return resolved();
    },
    set(next) {
      mode = next === 'light' || next === 'dark' ? next : 'system';
      try {
        localStorage.setItem(KEY, mode);
      } catch {}
      // Desktop: native window chrome, scrollbars and menus follow too.
      globalThis.flowdocDesktop?.setTheme?.(mode);
      apply();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  apply();
  globalThis.flowdocDesktop?.setTheme?.(mode);
})();
