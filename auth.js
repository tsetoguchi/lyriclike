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
  document.getElementById('sign-in-btn').style.display = 'none';
  document.getElementById('user-info').style.display = '';
  document.getElementById('user-email').textContent = user.email;
}

function showSignIn() {
  window.currentUser = null;
  document.body.classList.remove('signed-in');
  document.getElementById('sign-in-btn').style.display = '';
  document.getElementById('user-info').style.display = 'none';
}

function openAccountSettings() {
  document.getElementById('settings-user-email').textContent = window.currentUser?.email || '';
  document.getElementById('account-settings-overlay').classList.add('open');
}

function closeAccountSettings() {
  document.getElementById('account-settings-overlay').classList.remove('open');
}

document.getElementById('sign-in-btn').addEventListener('click', () => {
  window.location.href = '/api/auth/google/start';
});

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  closeAccountSettings();
  showSignIn();
}

document.getElementById('sign-out-btn').addEventListener('click', signOut);
document.getElementById('settings-sign-out-btn').addEventListener('click', signOut);

document.getElementById('account-settings-btn').addEventListener('click', openAccountSettings);
document.getElementById('close-account-settings-btn').addEventListener('click', closeAccountSettings);
document.getElementById('account-settings-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('account-settings-overlay')) closeAccountSettings();
});
document.getElementById('settings-delete-account-btn').addEventListener('click', async () => {
  if (!confirm('Permanently delete your account and all saved lyrics? This cannot be undone.')) return;
  await fetch('/api/me', { method: 'DELETE' });
  closeAccountSettings();
  showSignIn();
});

window.handleSessionExpired = showSignIn;

initAuth();
