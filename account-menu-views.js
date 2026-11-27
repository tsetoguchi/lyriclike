// The account menu's inner pages: Account and Legal each open one, and its
// back row returns to the first page. The pages slide past each other while
// the menu eases to the new page's height, and the menu always opens on its
// first page.
const CURRENT_CLASS = 'is-current';
const INSTANT_CLASS = 'is-instant';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const accountMenu = document.getElementById('account-menu');
const views = document.getElementById('account-menu-views');
const mainView = document.getElementById('account-menu-main');
// Each inner page with the row that opens it and the row that leads back.
const pages = [
  ['account-menu-account', 'account-page-btn', 'account-page-back'],
  ['account-menu-legal', 'account-legal-btn', 'account-legal-back'],
].map(([viewId, openerId, backId]) => ({
  view: document.getElementById(viewId),
  opener: document.getElementById(openerId),
  back: document.getElementById(backId),
}));

// page: one of pages, or null for the first page.
function setPage(page) {
  mainView.classList.toggle(CURRENT_CLASS, !page);
  mainView.inert = Boolean(page);
  for (const each of pages) {
    each.view.classList.toggle(CURRENT_CLASS, each === page);
    each.view.inert = each !== page;
  }
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

// Going in focuses the page's back row; coming back focuses the row that
// opened it.
function showPage(page, returnFocusTo) {
  easeHeight(() => setPage(page));
  (page ? page.back : returnFocusTo).focus({ preventScroll: true });
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

for (const page of pages) {
  page.opener.addEventListener('click', () => showPage(page));
  page.back.addEventListener('click', () => showPage(null, page.opener));
}
views.addEventListener('transitionend', releaseHeight);
new MutationObserver(resetOnOpen)
  .observe(accountMenu, { attributes: true, attributeFilter: ['hidden'] });
