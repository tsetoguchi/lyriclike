const GOOGLE_SIGN_IN_URL = '/api/auth/google/start';
// How long the account menu waits for its password item before showing
// anyway, so a slow connection still answers the click.
const ACCOUNT_OPEN_WAIT_MS = 600;

const accountButton = document.getElementById('account-settings-btn');
const accountMenu = document.getElementById('account-menu');

async function initAuth() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const user = await res.json();
      showUser(user);
    } else {
      showSignIn();
    }
  } catch {
    showSignIn();
  }
}

function showUser(user) {
  window.currentUser = user;
  document.dispatchEvent(new Event('auth-checked'));
  document.body.classList.add('signed-in');
  document.getElementById('signed-out-actions').style.display = 'none';
  document.getElementById('user-info').style.display = '';
  document.getElementById('account-initial').textContent = accountInitial(user);
  // The sidebar shows the notebook's pages once it knows whose they are.
  if (window.openNotebook) window.openNotebook();
}

function showSignIn() {
  window.currentUser = null;
  document.dispatchEvent(new Event('auth-checked'));
  document.body.classList.remove('signed-in');
  document.getElementById('signed-out-actions').style.display = '';
  document.getElementById('user-info').style.display = 'none';
  if (window.refreshNotebook) window.refreshNotebook();
}

// The first letter of the address stands for the account in the header.
function accountInitial(user) {
  const email = (user && user.email) || '';
  return email.charAt(0).toUpperCase();
}

function isAccountMenuOpen() {
  return !accountMenu.hidden;
}

// Shows once the password item is settled, so the menu opens at its full
// size instead of growing under the reader.
async function openAccountMenu() {
  document.getElementById('settings-user-email').textContent = window.currentUser?.email || '';
  if (window.showAccountSecurity) {
    const settled = window.showAccountSecurity(window.currentUser);
    await Promise.race([settled, new Promise(done => setTimeout(done, ACCOUNT_OPEN_WAIT_MS))]);
  }
  accountMenu.hidden = false;
  accountButton.setAttribute('aria-expanded', 'true');
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  accountButton.setAttribute('aria-expanded', 'false');
}

function toggleAccountMenu() {
  if (isAccountMenuOpen()) closeAccountMenu();
  else openAccountMenu();
}

// A click anywhere else closes the menu, as the sort menu does.
function closeAccountMenuOnOutsideClick(event) {
  if (!isAccountMenuOpen() || event.target.closest('.account-menu')) return;
  closeAccountMenu();
}

function closeAccountMenuOnEscape(event) {
  if (event.key !== 'Escape' || !isAccountMenuOpen()) return;
  closeAccountMenu();
  accountButton.focus();
}

// Signing in with Google is also how an account is made: the first visit
// creates it.
function startSignIn() {
  window.location.href = GOOGLE_SIGN_IN_URL;
}

// The modal (auth-forms.js) offers Google and, when it is switched on, email
// and password. It asks for the email first and works out from it whether this
// is a log in or a sign up, so every button opens the same step. Without the
// modal, they go straight to Google, which is also how an account is made.
function openSignIn() {
  if (window.openAuthModal) window.openAuthModal();
  else startSignIn();
}

document.getElementById('sign-in-btn').addEventListener('click', openSignIn);
document.getElementById('sign-up-btn').addEventListener('click', openSignIn);

// An explicit sign-out or a deleted account leaves nothing of the account on
// screen. An expired session does not come through here, so writing that
// has not been saved yet survives it.
function endSession() {
  closeAccountMenu();
  if (window.closePasswordBox) window.closePasswordBox();
  showSignIn();
  if (window.clearLyricState) window.clearLyricState();
}

async function signOut() {
  const button = document.getElementById('settings-sign-out-btn');
  button.disabled = true;
  try {
    // Live words still on their way get a moment to save, and offline the
    // writer decides (storage.js).
    if (window.confirmSignOut && !await window.confirmSignOut()) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    endSession();
  } finally {
    button.disabled = false;
  }
}

document.getElementById('settings-sign-out-btn').addEventListener('click', signOut);

accountButton.addEventListener('click', toggleAccountMenu);
// On the document: sending a password link disables its item, focus falls
// to the body, and Escape still has to close the menu.
document.addEventListener('keydown', closeAccountMenuOnEscape);
document.addEventListener('click', closeAccountMenuOnOutsideClick);

window.handleSessionExpired = showSignIn;
window.closeAccountMenu = closeAccountMenu;
window.startSignIn = startSignIn;

initAuth();
