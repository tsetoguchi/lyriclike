const GOOGLE_SIGN_IN_URL = '/api/auth/google/start';
const APPLE_SIGN_IN_URL = '/api/auth/apple/start';
// Set once this device has reported a signed-in visit to analytics.
const FIRST_SIGN_IN_KEY = 'first_sign_in_tracked';
// How long the account menu waits for its password item before showing
// anyway, so a slow connection still answers the click.
const ACCOUNT_OPEN_WAIT_MS = 600;
// Hide My Email gives the site a made-up address the person never saw, so it
// is not shown back to them as who they are.
const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';
const CAPTION_SIGNED_IN_AS = 'Signed in as';
const CAPTION_SIGNED_IN_WITH_APPLE = 'Signed in with Apple';

const accountButton = document.getElementById('account-settings-btn');
const accountMenu = document.getElementById('account-menu');
// Phones keep the account in the sidebar's foot, since the header is bare,
// except on the start screen (hub.js), whose top bar is the header.
const PHONE_QUERY = window.matchMedia('(max-width: 768px)');
const HUB_CLASS = 'is-hub';

function placeAccountMenu() {
  const userInfo = document.getElementById('user-info');
  const isHub = document.documentElement.classList.contains(HUB_CLASS);
  const home = PHONE_QUERY.matches && !isHub
    ? document.getElementById('sidebar-account-slot')
    : document.getElementById('user-area');
  if (userInfo.parentElement !== home) home.appendChild(userInfo);
}
PHONE_QUERY.addEventListener('change', placeAccountMenu);
placeAccountMenu();

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

// Asked again after something on the server changed the account, such as a
// purchase in the iOS app. Only the account's numbers and the page count are
// redrawn; the page being written is left alone. The same object is kept, so
// code waiting on a check of this account still matches it. Any failure, or
// a different account by now, changes nothing.
async function refreshCurrentUser() {
  const user = window.currentUser;
  if (!user) return;
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const fresh = await res.json();
    if (window.currentUser !== user || fresh.email !== user.email) return;
    Object.assign(user, fresh);
    if (window.NotebookList) window.NotebookList.refreshPageCount();
  } catch {
    // Offline: the next sign-in check catches up.
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
  drawAccountInitial(user);
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
  if (window.NotebookList) window.NotebookList.load();
}

function hasHiddenAppleEmail(user) {
  const email = (user && user.email) || '';
  return email.toLowerCase().endsWith(APPLE_RELAY_DOMAIN);
}

// What the menu says the account is: the address, or for a hidden Apple one,
// the person's name (empty when Apple did not share it).
function accountWho(user) {
  if (hasHiddenAppleEmail(user)) {
    return { caption: CAPTION_SIGNED_IN_WITH_APPLE, line: (user.name || '').trim() };
  }
  return { caption: CAPTION_SIGNED_IN_AS, line: (user && user.email) || '' };
}

// The first letter of what the menu shows stands for the account in the
// header. Empty for a hidden Apple address with no name.
function accountInitial(user) {
  return accountWho(user).line.charAt(0).toUpperCase();
}

// With no letter to show, the Apple logo from the sign-in button stands in.
function drawAccountInitial(user) {
  const slot = document.getElementById('account-initial');
  slot.textContent = accountInitial(user);
  if (slot.textContent || !hasHiddenAppleEmail(user)) return;
  const logo = document.querySelector('#auth-apple svg');
  if (logo) slot.appendChild(logo.cloneNode(true));
}

function isAccountMenuOpen() {
  return !accountMenu.hidden;
}

// Shows once the password item is settled, so the menu opens at its full
// size instead of growing under the reader.
async function openAccountMenu() {
  const who = accountWho(window.currentUser);
  const line = document.getElementById('settings-user-email');
  document.getElementById('settings-user-caption').textContent = who.caption;
  line.textContent = who.line;
  line.hidden = !who.line;
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

// Sign-in in the app ended without a session (native-shell.js).
document.addEventListener('native-sign-in-failed', () => {
  PageNotice.show('Sign-in did not finish. Please try again.');
});

// Signing in with Google is also how an account is made: the first visit
// creates it.
function startSignIn() {
  trackEvent('google_sign_in_started');
  // The system browser runs Google sign-in in the apps; a webview can't.
  if (window.NativeShell.isNative) {
    window.NativeShell.startGoogleSignIn();
    return;
  }
  window.location.href = GOOGLE_SIGN_IN_URL;
}

// Sign in with Apple. The iOS app shows the system sheet; the website goes to
// Apple's page. auth-forms.js decides where the button is offered.
function startAppleSignIn() {
  trackEvent('apple_sign_in_started');
  if (window.NativeShell.isNative) {
    window.NativeShell.startAppleSignIn();
    return;
  }
  window.location.href = APPLE_SIGN_IN_URL;
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
  if (window.OpenPage) window.OpenPage.clear();
}

// Logging out ends the session on the server, so it needs a connection:
// without one this device would only look logged out.
async function signOut() {
  if (navigator.onLine === false) return tellSignOutOffline();
  const button = document.getElementById('settings-sign-out-btn');
  button.disabled = true;
  try {
    // Live words still on their way get a moment to save (storage.js).
    if (window.OpenPage && !await window.OpenPage.confirmSignOut()) return;
    if (await sendLogout()) endSession();
    else await tellSignOutOffline();
  } finally {
    button.disabled = false;
  }
}

async function sendLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

function tellSignOutOffline() {
  closeAccountMenu();
  return window.OpenPage ? window.OpenPage.tellOffline() : undefined;
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
window.startAppleSignIn = startAppleSignIn;
window.refreshCurrentUser = refreshCurrentUser;

initAuth();
