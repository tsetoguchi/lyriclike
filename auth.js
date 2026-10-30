const GOOGLE_SIGN_IN_URL = '/api/auth/google/start';
// Set once this device has reported a signed-in visit to analytics.
const FIRST_SIGN_IN_KEY = 'first_sign_in_tracked';
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
      // Only a real answer forgets the account: offline, the splash
      // (splash.js) still shows next time.
      if (window.rememberSignedIn) window.rememberSignedIn(false);
      showSignIn(await res.json().catch(() => null));
    }
  } catch {
    showSignIn();
  }
}

function showUser(user) {
  window.currentUser = user;
  if (window.rememberSignedIn) window.rememberSignedIn(true);
  window.setSignedInProperty(true);
  trackEventOnce(FIRST_SIGN_IN_KEY, 'first_sign_in');
  document.dispatchEvent(new Event('auth-checked'));
  document.body.classList.add('signed-in');
  document.getElementById('signed-out-actions').style.display = 'none';
  document.getElementById('user-info').style.display = '';
  document.getElementById('account-initial').textContent = accountInitial(user);
  // The sidebar shows the notebook's pages once it knows whose they are.
  if (window.openNotebook) window.openNotebook();
}

// signedOut is /api/me's 401 answer, when there is one. It names the site's
// extension script, which runs for visitors too.
function showSignIn(signedOut = null) {
  window.currentUser = null;
  if (signedOut) window.signedOutScriptUrl = signedOut.extension_script_url;
  window.setSignedInProperty(false);
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
  trackEvent('google_sign_in_started');
  window.location.href = GOOGLE_SIGN_IN_URL;
}

// The modal (auth-forms.js) offers Google and, when it is switched on, email
// and password. It asks for the email first and works out from it whether this
// is a log in or a sign up, so every button opens the same step. Without the
// modal, they go straight to Google, which is also how an account is made.
function openSignIn(entry) {
  trackEvent('auth_opened', { entry });
  if (window.openAuthModal) window.openAuthModal();
  else startSignIn();
}

document.getElementById('sign-in-btn').addEventListener('click', () => openSignIn('log_in'));
document.getElementById('sign-up-btn').addEventListener('click', () => openSignIn('sign_up'));

// An explicit sign-out or a deleted account leaves nothing of the account on
// screen. An expired session does not come through here, so writing that
// has not been saved yet survives it.
function endSession() {
  if (window.rememberSignedIn) window.rememberSignedIn(false);
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
