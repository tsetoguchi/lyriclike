// The account menu's inner pages: Theme and Legal each open one, and its
// back row returns. The pages slide past each other while the menu eases to
// the new page's height, and the menu always opens on its first page.
const CURRENT_CLASS = 'is-current';
const INSTANT_CLASS = 'is-instant';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const accountMenu = document.getElementById('account-menu');
const views = document.getElementById('account-menu-views');
const mainView = document.getElementById('account-menu-main');
const innerPages = [
  { open: 'account-theme-btn', back: 'account-theme-back', view: 'account-menu-theme' },
  { open: 'account-legal-btn', back: 'account-legal-back', view: 'account-menu-legal' },
].map(ids => ({
  openButton: document.getElementById(ids.open),
  backButton: document.getElementById(ids.back),
  view: document.getElementById(ids.view),
}));

function markCurrent(view, isCurrent) {
  view.classList.toggle(CURRENT_CLASS, isCurrent);
  view.inert = !isCurrent;
}

// `page` is one of innerPages, or null for the first page.
function setPage(page) {
  markCurrent(mainView, page === null);
  for (const each of innerPages) markCurrent(each.view, each === page);
}

// Only the shown page takes room, so the box would jump to its height.
// It is pinned at the old height and eased to the new one, then let go
// so the page can still grow, as when the password note appears.
function easeHeight(change) {
  const fromHeight = views.offsetHeight;
  change();
  views.style.height = '';
  const toHeight = views.offsetHeight;
  if (fromHeight === toHeight || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
  views.style.height = `${fromHeight}px`;
  void views.offsetHeight;
  views.style.height = `${toHeight}px`;
}

function releaseHeight(event) {
  if (event.target === views && event.propertyName === 'height') views.style.height = '';
}

function openPage(page) {
  easeHeight(() => setPage(page));
  page.backButton.focus({ preventScroll: true });
}

function closePage(page) {
  easeHeight(() => setPage(null));
  page.openButton.focus({ preventScroll: true });
}

// Opening shows the first page at once, with nothing sliding.
function resetOnOpen() {
  if (accountMenu.hidden) return;
  views.classList.add(INSTANT_CLASS);
  setPage(null);
  views.style.height = '';
  void views.offsetHeight;
  views.classList.remove(INSTANT_CLASS);
}

for (const page of innerPages) {
  page.openButton.addEventListener('click', () => openPage(page));
  page.backButton.addEventListener('click', () => closePage(page));
}
views.addEventListener('transitionend', releaseHeight);
new MutationObserver(resetOnOpen)
  .observe(accountMenu, { attributes: true, attributeFilter: ['hidden'] });
