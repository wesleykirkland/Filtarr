// Applies the saved (or system) colour scheme before first paint to avoid a flash.
// Served as a same-origin file so the CSP (script-src 'self') allows it.
(function () {
  try {
    var saved = localStorage.getItem('darkMode');
    var dark =
      saved === null
        ? typeof globalThis.matchMedia === 'function' &&
          globalThis.matchMedia('(prefers-color-scheme: dark)').matches
        : saved === 'true';
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  } catch {
    document.documentElement.classList.add('light');
  }
})();
