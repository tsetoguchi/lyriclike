// The Security part of the Account panel: how the account signs in, changing
// the password, emailing a Google-only account a link to set one, and
// deleting the account.

(function initAccountSecurity() {
  const MIN_PASSWORD_LENGTH = 8;
  const MAX_PASSWORD_LENGTH = 256;
  const HTTP_UNAUTHORIZED = 401;
  const HTTP_FORBIDDEN = 403;
  const HTTP_TOO_MANY_REQUESTS = 429;
  const NETWORK_FAILURE = 0;

  const TEXT = Object.freeze({
    CONNECTED: 'Connected',
    NOT_CONNECTED: 'Not connected',
    SET: 'Set',
    NOT_SET: 'Not set',
    ENTER_CURRENT: 'Enter your current password.',
    TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    TOO_LONG: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
    CHANGED: 'Password changed. Any other devices were signed out.',
    LINK_SENT_FALLBACK: 'We sent you a link.',
    JUNK: 'Not there? Check your junk folder.',
    OFFLINE: "Couldn't reach the server. Check your connection and try again.",
    FAILED: 'Something went wrong. Try again.',
    DELETE_WITH_PASSWORD:
      'This deletes your account and every page saved to it. It cannot be undone. '
      + 'Enter your password to confirm.',
    WRONG_PASSWORD: "That password isn't right.",
    TOO_MANY: 'Too many tries. Wait a few minutes, then try again.',
  });

  const googleValue = document.getElementById('security-google');
  const passwordValue = document.getElementById('security-password');
  const changeButton = document.getElementById('change-password-btn');
  const addButton = document.getElementById('add-password-btn');
  const addHint = document.getElementById('add-password-hint');
  const form = document.getElementById('change-password-form');
  const usernameInput = document.getElementById('security-username');
  const currentInput = document.getElementById('current-password');
  const newInput = document.getElementById('new-password');
  const newHint = document.getElementById('new-password-hint');
  const errorEl = document.getElementById('security-error');
  const cancelButton = document.getElementById('cancel-password-btn');
  const saveButton = document.getElementById('save-password-btn');
  const statusEl = document.getElementById('security-status');

  let busy = false;

  // ── Server ──

  // Resolves with { status, data }. A network failure is status 0, never a throw.
  async function sendJson(url, method, payload) {
    try {
      const init = { method };
      if (payload !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(url, init);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch {
      return { status: NETWORK_FAILURE, data: null };
    }
  }

  function isOk(result) {
    return result.status >= 200 && result.status < 300;
  }

  function errorCode(result) {
    const error = result.data && result.data.error;
    return error && typeof error.code === 'string' ? error.code : null;
  }

  // The server's messages are written for people, so they are shown as they are.
  function failureMessage(result) {
    if (result.status === NETWORK_FAILURE) return TEXT.OFFLINE;
    const error = result.data && result.data.error;
    return error && typeof error.message === 'string' ? error.message : TEXT.FAILED;
  }

  // The session ran out while the panel was open.
  function endExpiredSession() {
    closeAccountSettings();
    if (window.handleSessionExpired) window.handleSessionExpired();
  }

  // ── Showing the panel ──

  function showStatus(text) {
    statusEl.textContent = text || '';
    statusEl.hidden = !text;
  }

  function clearError() {
    errorEl.textContent = '';
    newHint.classList.remove('is-error');
    [currentInput, newInput].forEach(input => {
      input.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
    });
  }

  function showError(text, field) {
    clearError();
    const line = document.createElement('p');
    line.textContent = text;
    errorEl.appendChild(line);
    if (field) {
      field.classList.add('has-error');
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
    if (field === newInput && text === TEXT.TOO_SHORT) newHint.classList.add('is-error');
  }

  function setFormOpen(open) {
    form.hidden = !open;
    changeButton.hidden = open;
    changeButton.setAttribute('aria-expanded', String(open));
    if (!open) {
      form.reset();
      clearError();
    }
  }

  // The buttons only show when passwords are switched on. Without the answer
  // from the server yet, the rows are filled in and the buttons stay hidden.
  async function showAccountSecurity(user) {
    if (!user) return;
    const hasGoogle = Array.isArray(user.providers) && user.providers.includes('google');
    googleValue.textContent = hasGoogle ? TEXT.CONNECTED : TEXT.NOT_CONNECTED;
    passwordValue.textContent = user.has_password ? TEXT.SET : TEXT.NOT_SET;
    usernameInput.value = user.email || '';
    setFormOpen(false);
    showStatus('');
    changeButton.hidden = true;
    addButton.hidden = true;
    addHint.hidden = true;

    const methods = window.loadAuthMethods ? await window.loadAuthMethods() : { password: false };
    if (!methods.password || window.currentUser !== user) return;
    changeButton.hidden = !user.has_password;
    addButton.hidden = user.has_password;
    addHint.hidden = user.has_password;
  }

  // ── Changing the password ──

  function checkNewPassword(password) {
    const length = [...password.normalize('NFKC')].length;
    if (length < MIN_PASSWORD_LENGTH) return TEXT.TOO_SHORT;
    if (length > MAX_PASSWORD_LENGTH) return TEXT.TOO_LONG;
    return null;
  }

  // Which field a server error code is about.
  function fieldForCode(code) {
    if (code === 'wrong_password') return currentInput;
    if (code && code.startsWith('password_')) return newInput;
    return null;
  }

  async function submitChange(event) {
    event.preventDefault();
    if (busy) return;
    showStatus('');

    if (!currentInput.value) { showError(TEXT.ENTER_CURRENT, currentInput); return; }
    const problem = checkNewPassword(newInput.value);
    if (problem) { showError(problem, newInput); return; }

    busy = true;
    saveButton.disabled = true;
    const result = await sendJson('/api/me/password', 'POST', {
      current_password: currentInput.value,
      password: newInput.value,
    });
    busy = false;
    saveButton.disabled = false;

    if (result.status === HTTP_UNAUTHORIZED) { endExpiredSession(); return; }
    if (!isOk(result)) {
      showError(failureMessage(result), fieldForCode(errorCode(result)));
      return;
    }
    if (result.data && result.data.user) window.currentUser = result.data.user;
    setFormOpen(false);
    showStatus(TEXT.CHANGED);
    changeButton.focus();
  }

  // ── Adding a password ──

  async function sendPasswordLink() {
    if (busy) return;
    busy = true;
    addButton.disabled = true;
    const result = await sendJson('/api/me/password-link', 'POST');
    busy = false;
    addButton.disabled = false;

    if (result.status === HTTP_UNAUTHORIZED) { endExpiredSession(); return; }
    if (!isOk(result)) { showStatus(failureMessage(result)); return; }
    const sent = result.data && typeof result.data.message === 'string'
      ? result.data.message : TEXT.LINK_SENT_FALLBACK;
    addHint.hidden = true;
    showStatus(`${sent} ${TEXT.JUNK}`);
  }

  // ── Deleting the account ──

  // An account with a password gives it again. One with only Google has no
  // password to ask for, so the address has to be typed back instead.
  function askToDelete(user, note) {
    if (user.has_password) {
      return openDialog({
        heading: 'Delete account',
        message: note ? `${note} ${TEXT.DELETE_WITH_PASSWORD}` : TEXT.DELETE_WITH_PASSWORD,
        confirmLabel: 'Delete account',
        danger: true,
        field: { label: 'Password', value: '', type: 'password' },
      });
    }
    return openDialog({
      heading: 'Delete account',
      message: `This deletes your account and every page saved to it. It cannot be undone. Type ${user.email} to confirm.`,
      confirmLabel: 'Delete account',
      danger: true,
      field: { label: 'Email address', value: '', mustMatch: user.email },
    });
  }

  // A wrong password asks again; any other failure says so and stops.
  // Nothing on screen changes until the server has deleted the account.
  async function deleteAccount() {
    const user = window.currentUser;
    if (!user || !user.email) return;

    let note = null;
    for (;;) {
      const answer = await askToDelete(user, note);
      if (answer === null) return;

      const result = user.has_password
        ? await sendJson('/api/me', 'DELETE', { password: answer })
        : await sendJson('/api/me', 'DELETE');
      if (isOk(result)) { endSession(); return; }
      if (result.status === HTTP_UNAUTHORIZED) { endExpiredSession(); return; }
      if (result.status === HTTP_FORBIDDEN && errorCode(result) === 'wrong_password') {
        note = TEXT.WRONG_PASSWORD;
        continue;
      }
      const message = result.status === HTTP_TOO_MANY_REQUESTS ? TEXT.TOO_MANY : failureMessage(result);
      await openDialog({ heading: 'Delete account', message, confirmLabel: 'OK' });
      return;
    }
  }

  changeButton.addEventListener('click', () => {
    showStatus('');
    setFormOpen(true);
    currentInput.focus();
  });
  cancelButton.addEventListener('click', () => {
    setFormOpen(false);
    changeButton.focus();
  });
  form.addEventListener('submit', submitChange);
  addButton.addEventListener('click', sendPasswordLink);
  document.getElementById('settings-delete-account-btn').addEventListener('click', deleteAccount);

  window.showAccountSecurity = showAccountSecurity;
  window.hideAccountSecurityForm = () => setFormOpen(false);
})();
