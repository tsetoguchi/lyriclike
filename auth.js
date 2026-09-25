const GOOGLE_SIGN_IN_URL = '/api/auth/google/start';

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
  document.body.classList.add('signed-in');
  document.getElementById('signed-out-actions').style.display = 'none';
  document.getElementById('user-info').style.display = '';
  // The sidebar shows the notebook's pages once it knows whose they are.
  if (window.refreshNotebook) window.refreshNotebook();
}

function showSignIn() {
  window.currentUser = null;
  document.body.classList.remove('signed-in');
  document.getElementById('signed-out-actions').style.display = '';
  document.getElementById('user-info').style.display = 'none';
  if (window.refreshNotebook) window.refreshNotebook();
}

function openAccountSettings() {
  document.getElementById('settings-user-email').textContent = window.currentUser?.email || '';
  if (window.showAccountSecurity) window.showAccountSecurity(window.currentUser);
  document.getElementById('account-settings-overlay').classList.add('open');
}

function closeAccountSettings() {
  document.getElementById('account-settings-overlay').classList.remove('open');
  if (window.hideAccountSecurityForm) window.hideAccountSecurityForm();
}

// Signing in with Google is also how an account is made: the first visit
// creates it.
function startSignIn() {
  window.location.href = GOOGLE_SIGN_IN_URL;
}

// The modal (auth-forms.js) offers Google and, when it is switched on, email
// and password. Without it, both buttons still go straight to Google, which
// is also how an account is made.
function openSignIn() {
  if (window.openAuthModal) window.openAuthModal();
  else startSignIn();
}

function openSignUp() {
  if (window.openAuthModal) window.openAuthModal({ view: 'sign-up' });
  else startSignIn();
}

document.getElementById('sign-in-btn').addEventListener('click', openSignIn);
document.getElementById('sign-up-btn').addEventListener('click', openSignUp);
document.getElementById('local-save-sign-up').addEventListener('click', openSignUp);
document.getElementById('sidebar-sign-up-btn').addEventListener('click', openSignUp);

// An explicit sign-out or a deleted account leaves nothing of the account on
// screen. An expired session does not come through here, so writing that
// has not been saved yet survives it.
function endSession() {
  closeAccountSettings();
  showSignIn();
  if (window.clearLyricState) window.clearLyricState();
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  endSession();
}

document.getElementById('settings-sign-out-btn').addEventListener('click', signOut);

document.getElementById('account-settings-btn').addEventListener('click', openAccountSettings);
document.getElementById('close-account-settings-btn').addEventListener('click', closeAccountSettings);
document.getElementById('account-settings-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('account-settings-overlay')) closeAccountSettings();
});

window.handleSessionExpired = showSignIn;
window.startSignIn = startSignIn;

initAuth();
