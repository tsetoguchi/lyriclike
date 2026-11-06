// The Theme page in the account menu: one row per theme, the chosen one
// ticked. theme-boot.js owns applying and saving; this only wires the rows.
const THEME_OPTION_SELECTOR = '.theme-option';
const THEME_NAME_ATTRIBUTE = 'data-theme-name';

const options = [...document.querySelectorAll(THEME_OPTION_SELECTOR)];

function showChosen(name) {
  for (const option of options) {
    const isChosen = option.getAttribute(THEME_NAME_ATTRIBUTE) === name;
    option.setAttribute('aria-checked', isChosen ? 'true' : 'false');
  }
}

function choose(option) {
  const name = option.getAttribute(THEME_NAME_ATTRIBUTE);
  window.appTheme.set(name);
  showChosen(window.appTheme.current());
}

for (const option of options) {
  option.addEventListener('click', () => choose(option));
}
showChosen(window.appTheme.current());
