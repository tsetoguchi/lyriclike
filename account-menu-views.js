// The account menu's inner pages: Notifications, Account and Legal each open
// one, and its back row returns to the first page. The pages slide past each
// other, the menu keeps one size on every page (styles.css stacks them in
// one grid cell), and it always opens on its first page.
const CURRENT_CLASS = 'is-current';
const INSTANT_CLASS = 'is-instant';

const accountMenu = document.getElementById('account-menu');
const views = document.getElementById('account-menu-views');
const mainView = document.getElementById('account-menu-main');
// Each inner page with the row that opens it and the row that leads back.
const pages = [
  ['account-menu-notifications', 'notifications-page-btn', 'notifications-page-back'],
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

// Going in focuses the page's back row; coming back focuses the row that
// opened it.
function showPage(page, returnFocusTo) {
  setPage(page);
  (page ? page.back : returnFocusTo).focus({ preventScroll: true });
}

// Opening shows the first page at once, with nothing sliding.
function resetOnOpen() {
  if (accountMenu.hidden) return;
  views.classList.add(INSTANT_CLASS);
  setPage(null);
  void views.offsetHeight;
  views.classList.remove(INSTANT_CLASS);
}

for (const page of pages) {
  page.opener.addEventListener('click', () => showPage(page));
  page.back.addEventListener('click', () => showPage(null, page.opener));
}
new MutationObserver(resetOnOpen)
  .observe(accountMenu, { attributes: true, attributeFilter: ['hidden'] });
