// Puts the saved theme on <html> before the first paint, so the page never
// draws in the default look and then changes. theme-switch.js changes it
// later through window.appTheme, so the key and names live here only.
(function applySavedThemeEarly() {
  'use strict';

  const THEME_STORAGE_KEY = 'theme';
  const THEME_ATTRIBUTE = 'data-theme';
  const DEFAULT_THEME = 'blue-hour';
  // The browser bar's color for each theme: the header's top edge.
  const THEME_BAR_COLORS = Object.freeze({
    'blue-hour': '#0a0d13',
    aero: '#3a9df1',
  });

  let currentTheme = DEFAULT_THEME;

  function isKnownTheme(name) {
    return Object.prototype.hasOwnProperty.call(THEME_BAR_COLORS, name);
  }

  function readSavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return isKnownTheme(saved) ? saved : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  // Private windows can refuse storage; the theme still applies until reload.
  function saveTheme(name) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, name);
      return true;
    } catch {
      return false;
    }
  }

  function paintTheme(name) {
    const root = document.documentElement;
    if (name === DEFAULT_THEME) root.removeAttribute(THEME_ATTRIBUTE);
    else root.setAttribute(THEME_ATTRIBUTE, name);
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute('content', THEME_BAR_COLORS[name]);
    currentTheme = name;
  }

  function setTheme(name) {
    if (!isKnownTheme(name)) return false;
    paintTheme(name);
    return saveTheme(name);
  }

  paintTheme(readSavedTheme());
  window.appTheme = Object.freeze({
    current: () => currentTheme,
    set: setTheme,
  });
})();
