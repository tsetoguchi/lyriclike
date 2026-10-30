// The account menu's second page: Legal opens it, the back row returns. The
// pages slide past each other while the menu eases to the new page's height,
// and the menu always opens on its first page.
const CURRENT_CLASS = 'is-current';
const SHOWING_LEGAL_CLASS = 'is-showing-legal';
const INSTANT_CLASS = 'is-instant';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const accountMenu = document.getElementById('account-menu');
const views = document.getElementById('account-menu-views');
const mainView = document.getElementById('account-menu-main');
const legalView = document.getElementById('account-menu-legal');
const legalButton = document.getElementById('account-legal-btn');
const backButton = document.getElementById('account-legal-back');

function setPage(isLegal) {
  mainView.classList.toggle(CURRENT_CLASS, !isLegal);
  legalView.classList.toggle(CURRENT_CLASS, isLegal);
  mainView.inert = isLegal;
  legalView.inert = !isLegal;
  views.classList.toggle(SHOWING_LEGAL_CLASS, isLegal);
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

function showPage(isLegal) {
  easeHeight(() => setPage(isLegal));
  (isLegal ? backButton : legalButton).focus({ preventScroll: true });
}

// Opening shows the first page at once, with nothing sliding.
function resetOnOpen() {
  if (accountMenu.hidden) return;
  views.classList.add(INSTANT_CLASS);
  setPage(false);
  views.style.height = '';
  void views.offsetHeight;
  views.classList.remove(INSTANT_CLASS);
}

legalButton.addEventListener('click', () => showPage(true));
backButton.addEventListener('click', () => showPage(false));
views.addEventListener('transitionend', releaseHeight);
new MutationObserver(resetOnOpen)
  .observe(accountMenu, { attributes: true, attributeFilter: ['hidden'] });
