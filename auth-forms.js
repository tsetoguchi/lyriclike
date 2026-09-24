// The sign-in modal. Google comes first, because every account made before
// passwords has it; then email and password, with a text link between Sign in
// and Create account, and the views that emailed links open: confirming a
// signup (#signup_token=, read by auth-link.js) and setting a new password
// (#reset_token=). With passwords switched off on the server, the modal shows
// only Google.
(function initAuthForms() {
  'use strict';

  const METHODS_URL = '/api/auth/methods';
  const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const TURNSTILE_WAIT_MS = 60000;
  const FOCUS_DELAY_MS = 50;
  const CLOSE_DELAY_MS = 250;
  const MIN_PASSWORD_LENGTH = 8;
  const MAX_PASSWORD_LENGTH = 256;
  const MAX_EMAIL_LENGTH = 254;
  const MIN_LOCAL_PART_LENGTH = 4;

  const HTTP_OK = 200;
  const HTTP_CREATED = 201;
  const HTTP_ACCEPTED = 202;
  const HTTP_UNAUTHORIZED = 401;
  const HTTP_CONFLICT = 409;
  const HTTP_CAPTCHA_REQUIRED = 428;
  const NETWORK_FAILURE = 0;

  const TEXT = Object.freeze({
    FAILED: 'Something went wrong. Try again.',
    OFFLINE: "Couldn't reach LyricLike. Check your connection and try again.",
    CHECK_FAILED: "The security check didn't finish. Try again.",
    NEED_EMAIL: 'Enter a valid email address.',
    NEED_PASSWORD: 'Enter your password.',
    TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    TOO_LONG: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
    HAS_EMAIL: "Don't use your email address in your password.",
    LOGIN_HINT: 'Signed up with Google? Use the Google button above.',
    SENT: 'Sent',
    SIGNUP_LINK_LIFETIME: 'The link works for 24 hours.',
    RESET_LINK_LIFETIME: 'The link works for 30 minutes.',
    // The sending domain is new, and some inboxes (Outlook first) file its
    // mail as junk until it has a reputation.
    CHECK_JUNK: 'Not there? Check your junk folder.',
  });

  const VIEW = Object.freeze({
    SIGN_IN: 'sign-in',
    SIGN_UP: 'sign-up',
    CHECK_EMAIL: 'check-email',
    FORGOT: 'forgot',
    FORGOT_SENT: 'forgot-sent',
    CONFIRM: 'confirm',
    RESET: 'reset',
  });

  // What each view shows. `password` is the field's autocomplete value, or
  // null for no password field; `turnstile` is the action the widget runs for.
  const VIEWS = Object.freeze({
    [VIEW.SIGN_IN]: {
      title: 'Log in', google: true, email: true, password: 'current-password',
      passwordLabel: 'Password', hint: false, submit: 'Log in', links: ['to-sign-up', 'forgot'],
      turnstile: null,
    },
    [VIEW.SIGN_UP]: {
      title: 'Create account', google: true, email: true, password: 'new-password',
      passwordLabel: 'Password', hint: true, submit: 'Create account', links: ['to-sign-in'],
      turnstile: 'signup',
    },
    [VIEW.CHECK_EMAIL]: {
      title: 'Check your email', google: false, email: false, password: null,
      submit: null, links: ['resend', 'different-email'], turnstile: 'signup',
    },
    [VIEW.FORGOT]: {
      title: 'Reset password', google: false, email: true, password: null,
      message: "Enter your email and we'll send you a link to set a new password.",
      submit: 'Send reset link', links: ['back'], turnstile: 'forgot',
    },
    [VIEW.FORGOT_SENT]: {
      title: 'Check your email', google: false, email: false, password: null,
      submit: null, links: ['back'], turnstile: null,
    },
    [VIEW.CONFIRM]: {
      title: 'Confirm your email', google: false, email: false, password: 'current-password',
      passwordLabel: 'Password', hint: false,
      message: 'Enter the password you chose when you signed up.',
      submit: 'Confirm email', links: [], turnstile: null,
    },
    [VIEW.RESET]: {
      title: 'Set a new password', google: false, email: false, password: 'new-password',
      passwordLabel: 'New password', hint: true, submit: 'Set password', links: [],
      turnstile: null,
    },
  });

  const overlay = document.getElementById('auth-overlay');
  const form = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const passwordToggle = document.getElementById('auth-password-toggle');
  const passwordHint = document.getElementById('auth-password-hint');
  const submitButton = document.getElementById('auth-submit');
  const errorEl = document.getElementById('auth-error');
  const messageEl = document.getElementById('auth-message');
  const turnstileEl = document.getElementById('auth-turnstile');
  const linkButtons = Array.from(document.querySelectorAll('[data-auth-link]'));

  let methodsPromise = null;
  let methods = { password: false, turnstileSiteKey: null };
  let currentView = VIEW.SIGN_IN;
  let linkToken = null;
  let pendingSignup = null;
  let loginNeedsCheck = false;
  let returnFocusTo = null;
  let busy = false;

  // ── Server ──

  // Asked once per page. A failure reads as "passwords off", which still
  // leaves Google working.
  function loadMethods() {
    if (methodsPromise) return methodsPromise;
    methodsPromise = fetch(METHODS_URL)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null)
      .then(body => {
        methods = {
          password: Boolean(body && body.password === true),
          turnstileSiteKey: body && typeof body.turnstileSiteKey === 'string' ? body.turnstileSiteKey : null,
        };
        return methods;
      });
    return methodsPromise;
  }

  // Resolves with { status, data }. A network failure is status 0, never a throw.
  async function postJson(url, payload) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch {
      return { status: NETWORK_FAILURE, data: null };
    }
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

  // ── Turnstile ──
  // Loaded only when a view needs it. The widget is interaction-only, so most
  // people never see it; the token it hands back is good for one request, so
  // the widget is reset after every submit that used one.

  let turnstileScript = null;
  let widgetId = null;
  let tokenWaiter = null;

  function loadTurnstileScript() {
    if (turnstileScript) return turnstileScript;
    turnstileScript = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = TURNSTILE_SCRIPT_URL;
      tag.async = true;
      tag.addEventListener('load', () => resolve(window.turnstile));
      tag.addEventListener('error', () => { turnstileScript = null; reject(new Error('turnstile')); });
      document.head.appendChild(tag);
    });
    return turnstileScript;
  }

  function armTokenWaiter() {
    const waiter = {};
    waiter.promise = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    waiter.promise.catch(() => {});
    tokenWaiter = waiter;
  }

  async function prepareTurnstile(action) {
    removeTurnstile();
    if (!action || !methods.turnstileSiteKey) return;
    armTokenWaiter();
    const waiter = tokenWaiter;
    let api;
    try {
      api = await loadTurnstileScript();
    } catch {
      waiter.reject(new Error('turnstile'));
      return;
    }
    if (tokenWaiter !== waiter || !api) return;
    widgetId = api.render(turnstileEl, {
      sitekey: methods.turnstileSiteKey,
      action,
      appearance: 'interaction-only',
      theme: 'dark',
      size: 'flexible',
      callback: token => { if (tokenWaiter) tokenWaiter.resolve(token); },
      'error-callback': () => { if (tokenWaiter) tokenWaiter.reject(new Error('turnstile')); },
      'expired-callback': armTokenWaiter,
    });
  }

  // Waits for the widget's token. Null when nothing is armed (no site key);
  // the server then answers captcha_failed and the person sees why.
  async function takeTurnstileToken() {
    if (!tokenWaiter) return null;
    const timeout = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('turnstile timeout')), TURNSTILE_WAIT_MS);
    });
    return Promise.race([tokenWaiter.promise, timeout]);
  }

  function resetTurnstile() {
    if (widgetId === null || !window.turnstile) return;
    armTokenWaiter();
    window.turnstile.reset(widgetId);
  }

  function removeTurnstile() {
    tokenWaiter = null;
    if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
    widgetId = null;
    turnstileEl.textContent = '';
  }

  // ── Views ──

  function setShown(element, shown) {
    element.hidden = !shown;
  }

  function showLinks(names) {
    linkButtons.forEach(button => {
      button.hidden = !names.includes(button.dataset.authLink);
      button.disabled = false;
    });
    const resend = linkButtons.find(button => button.dataset.authLink === 'resend');
    if (resend) resend.textContent = 'Send it again';
  }

  function showMessage(text) {
    messageEl.textContent = text || '';
    messageEl.hidden = !text;
  }

  function setPasswordVisible(visible) {
    passwordInput.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  }

  // With passwords off, every view collapses to Google alone. Create account
  // keeps its title, since Google is how an account is made then too.
  function describeView(name) {
    const view = VIEWS[name];
    if (methods.password) return view;
    const title = name === VIEW.SIGN_UP ? view.title : VIEWS[VIEW.SIGN_IN].title;
    return {
      ...VIEWS[VIEW.SIGN_IN], title, email: false, password: null, submit: null, links: [], turnstile: null,
    };
  }

  function showView(name, message) {
    const view = describeView(name);
    currentView = name;
    loginNeedsCheck = false;
    document.getElementById('auth-title').textContent = view.title;
    showMessage(message || view.message);
    setShown(document.getElementById('auth-google'), view.google);
    setShown(document.getElementById('auth-divider'), view.google && Boolean(view.submit));
    setShown(form, Boolean(view.submit));
    setShown(document.getElementById('auth-email-field'), view.email);
    setShown(document.getElementById('auth-password-field'), Boolean(view.password));
    if (view.password) {
      passwordInput.setAttribute('autocomplete', view.password);
      document.querySelector('label[for="auth-password"]').textContent = view.passwordLabel;
    }
    passwordInput.value = '';
    setPasswordVisible(false);
    setShown(passwordHint, Boolean(view.hint));
    if (view.submit) submitButton.textContent = view.submit;
    showLinks(view.links);
    clearError();
    prepareTurnstile(view.turnstile);
  }

  // ── Errors ──

  function clearError() {
    errorEl.textContent = '';
    passwordHint.classList.remove('is-error');
    [emailInput, passwordInput].forEach(input => {
      input.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
    });
  }

  // `field` is the input the problem is about, if any; `hint` adds a second,
  // quieter line under the error.
  function showError(text, field, hint) {
    clearError();
    const line = document.createElement('p');
    line.textContent = text;
    // The policy hint already says this on screen; it only needs announcing.
    if (field === passwordInput && !passwordHint.hidden && text === TEXT.TOO_SHORT) {
      line.className = 'visually-hidden';
    }
    errorEl.appendChild(line);
    if (hint) {
      const extra = document.createElement('p');
      extra.className = 'auth-error-hint';
      extra.textContent = hint;
      errorEl.appendChild(extra);
    }
    if (field) {
      field.classList.add('has-error');
      field.setAttribute('aria-invalid', 'true');
    }
    if (field === passwordInput && !passwordHint.hidden) passwordHint.classList.add('is-error');
  }

  // ── Checks that mirror the server's, so most mistakes never make a request ──

  function isEmailShaped(email) {
    return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Returns a message, or null when the password would pass the policy.
  function checkNewPassword(password, email) {
    const length = [...password.normalize('NFKC')].length;
    if (length < MIN_PASSWORD_LENGTH) return TEXT.TOO_SHORT;
    if (length > MAX_PASSWORD_LENGTH) return TEXT.TOO_LONG;
    const localPart = (email || '').split('@')[0].toLowerCase();
    if (localPart.length >= MIN_LOCAL_PART_LENGTH
        && password.normalize('NFKC').toLowerCase().includes(localPart)) {
      return TEXT.HAS_EMAIL;
    }
    return null;
  }

  // Which field a server error code is about.
  function fieldForCode(code) {
    if (code === 'invalid_email') return emailInput;
    if (code === 'too_short' || code === 'too_long' || code === 'has_email'
        || code === 'breached' || code === 'wrong_password') {
      return passwordInput;
    }
    return null;
  }

  // ── Submitting ──

  function setBusy(isBusy) {
    busy = isBusy;
    submitButton.disabled = isBusy;
    submitButton.setAttribute('aria-busy', String(isBusy));
  }

  // Runs one request with the Turnstile token when the view has a widget.
  async function postWithCheck(url, payload) {
    let token = null;
    try {
      token = await takeTurnstileToken();
    } catch {
      resetTurnstile();
      return { status: NETWORK_FAILURE, data: { error: { message: TEXT.CHECK_FAILED } } };
    }
    const result = await postJson(url, token ? { ...payload, turnstile: token } : payload);
    if (token) resetTurnstile();
    return result;
  }

  function attemptLogin(payload) {
    return loginNeedsCheck
      ? postWithCheck('/api/auth/login', payload)
      : postJson('/api/auth/login', payload);
  }

  async function submitSignIn() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!isEmailShaped(email)) return showError(TEXT.NEED_EMAIL, emailInput);
    if (!password) return showError(TEXT.NEED_PASSWORD, passwordInput);

    const payload = { email, password };
    let result = await attemptLogin(payload);
    if (result.status === HTTP_CAPTCHA_REQUIRED && !loginNeedsCheck) {
      // Over the all-IPs cap for this address: pass the check, then retry once.
      loginNeedsCheck = true;
      showError(failureMessage(result));
      await prepareTurnstile('login');
      result = await attemptLogin(payload);
    }

    if (result.status === HTTP_OK) return finishSignIn(result.data);
    if (result.status === HTTP_UNAUTHORIZED) {
      return showError(failureMessage(result), passwordInput, TEXT.LOGIN_HINT);
    }
    return showError(failureMessage(result), fieldForCode(errorCode(result)));
  }

  async function sendSignup(signup) {
    return postWithCheck('/api/auth/signup', signup);
  }

  async function submitSignUp() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!isEmailShaped(email)) return showError(TEXT.NEED_EMAIL, emailInput);
    const problem = checkNewPassword(password, email);
    if (problem) return showError(problem, passwordInput);

    const result = await sendSignup({ email, password });
    if (result.status !== HTTP_ACCEPTED) {
      return showError(failureMessage(result), fieldForCode(errorCode(result)));
    }
    pendingSignup = { email, password };
    showView(VIEW.CHECK_EMAIL, `We sent a link to ${email} to finish signing up. ${TEXT.SIGNUP_LINK_LIFETIME} ${TEXT.CHECK_JUNK}`);
    return null;
  }

  // "Send it again" submits the same signup again. It then reads "Sent" until
  // the view changes, since the address can only be sent a few an hour.
  async function resendSignup(button) {
    if (!pendingSignup || busy) return;
    busy = true;
    button.disabled = true;
    const result = await sendSignup(pendingSignup);
    busy = false;
    if (result.status === HTTP_ACCEPTED) {
      button.textContent = TEXT.SENT;
      clearError();
      return;
    }
    button.disabled = false;
    showError(failureMessage(result));
  }

  async function submitForgot() {
    const email = emailInput.value.trim();
    if (!isEmailShaped(email)) return showError(TEXT.NEED_EMAIL, emailInput);

    const result = await postWithCheck('/api/auth/password/forgot', { email });
    if (result.status !== HTTP_ACCEPTED) {
      return showError(failureMessage(result), fieldForCode(errorCode(result)));
    }
    const sent = result.data && typeof result.data.message === 'string' ? result.data.message : '';
    showView(VIEW.FORGOT_SENT, `${sent} ${TEXT.RESET_LINK_LIFETIME} ${TEXT.CHECK_JUNK}`.trim());
    return null;
  }

  async function submitConfirm() {
    const password = passwordInput.value;
    if (!password) return showError(TEXT.NEED_PASSWORD, passwordInput);

    const result = await postJson('/api/auth/signup/confirm', { token: linkToken, password });
    if (result.status === HTTP_CREATED) return finishSignIn(result.data);

    const code = errorCode(result);
    if (code === 'invalid_token') return endLinkView(['sign-up-again'], failureMessage(result));
    if (result.status === HTTP_CONFLICT) return endLinkView(['back', 'forgot'], failureMessage(result));
    return showError(failureMessage(result), fieldForCode(code));
  }

  async function submitReset() {
    const password = passwordInput.value;
    const problem = checkNewPassword(password, '');
    if (problem) return showError(problem, passwordInput);

    const result = await postJson('/api/auth/password/reset', { token: linkToken, password });
    if (result.status === HTTP_OK) return finishSignIn(result.data);

    const code = errorCode(result);
    if (code === 'invalid_token') return endLinkView(['new-reset-link'], failureMessage(result));
    return showError(failureMessage(result), fieldForCode(code));
  }

  // A link that can no longer be used leaves nothing to type into. The error
  // lives in the form, so its text moves up to the message line first.
  function endLinkView(links, text) {
    linkToken = null;
    clearError();
    showMessage(text);
    setShown(form, false);
    showLinks(links);
    focusFirstField();
  }

  const SUBMITTERS = Object.freeze({
    [VIEW.SIGN_IN]: submitSignIn,
    [VIEW.SIGN_UP]: submitSignUp,
    [VIEW.FORGOT]: submitForgot,
    [VIEW.CONFIRM]: submitConfirm,
    [VIEW.RESET]: submitReset,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const submitter = SUBMITTERS[currentView];
    if (!submitter || busy || !methods.password) return;
    setBusy(true);
    try {
      await submitter();
    } finally {
      setBusy(false);
    }
  }

  // ── Signed in ──

  // The response carries the account, so there is no second /api/me call.
  // showUser sets window.currentUser, which autosave checks before every save.
  // The header switching to Account is the only sign; nothing is announced.
  function finishSignIn(data) {
    const user = data && data.user;
    if (!user || typeof user.email !== 'string') {
      showError(TEXT.FAILED);
      return;
    }
    pendingSignup = null;
    linkToken = null;
    showUser(user);
    closeAuthModal();
  }

  // ── Opening and closing ──

  // Runs on a delay, so the modal may have been closed in the meantime.
  function focusFirstField() {
    if (!overlay.classList.contains('open')) return;
    const candidates = [emailInput, passwordInput, submitButton, document.getElementById('auth-google'),
      ...linkButtons, document.getElementById('auth-close')];
    const target = candidates.find(element => element.offsetParent !== null);
    if (target) target.focus();
  }

  async function openAuthModal(options) {
    const settings = options || {};
    returnFocusTo = document.activeElement;
    await loadMethods();
    showView(VIEWS[settings.view] ? settings.view : VIEW.SIGN_IN, settings.message);
    overlay.hidden = false;
    overlay.classList.add('open');
    // Focus once the panel is on its way in, so iOS raises the keyboard for it.
    setTimeout(focusFirstField, FOCUS_DELAY_MS);
  }

  function closeAuthModal() {
    overlay.classList.remove('open');
    setTimeout(() => { if (!overlay.classList.contains('open')) overlay.hidden = true; }, CLOSE_DELAY_MS);
    removeTurnstile();
    passwordInput.value = '';
    pendingSignup = null;
    linkToken = null;
    const signInButton = document.getElementById('sign-in-btn');
    const target = returnFocusTo && returnFocusTo.offsetParent !== null ? returnFocusTo : signInButton;
    returnFocusTo = null;
    if (target && target.offsetParent !== null) target.focus();
  }

  // Keeps Tab inside the panel while it is open.
  function trapFocus(event) {
    const focusable = Array.from(overlay.querySelectorAll('button, input'))
      .filter(element => !element.disabled && element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!overlay.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ── Wiring ──

  const LINK_ACTIONS = Object.freeze({
    'to-sign-up': () => showView(VIEW.SIGN_UP),
    'to-sign-in': () => showView(VIEW.SIGN_IN),
    'back': () => showView(VIEW.SIGN_IN),
    'forgot': () => showView(VIEW.FORGOT),
    'sign-up-again': () => showView(VIEW.SIGN_UP),
    'new-reset-link': () => showView(VIEW.FORGOT),
    'different-email': () => { pendingSignup = null; showView(VIEW.SIGN_UP); },
    'resend': button => resendSignup(button),
  });

  // Moving between views keeps the address that was typed, so switching from
  // Sign in to Forgot password does not ask for it twice.
  linkButtons.forEach(button => {
    button.addEventListener('click', () => {
      const action = LINK_ACTIONS[button.dataset.authLink];
      if (!action) return;
      action(button);
      setTimeout(focusFirstField, FOCUS_DELAY_MS);
    });
  });

  form.addEventListener('submit', handleSubmit);
  document.getElementById('auth-google').addEventListener('click', startSignIn);
  document.getElementById('auth-close').addEventListener('click', closeAuthModal);
  passwordToggle.addEventListener('click', () => {
    setPasswordVisible(passwordInput.type === 'password');
    passwordInput.focus();
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeAuthModal();
  });
  // On the document, not the overlay: when a view hides the focused button,
  // focus falls to the body, and Escape still has to close the modal.
  document.addEventListener('keydown', event => {
    if (!overlay.classList.contains('open')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeAuthModal(); }
    if (event.key === 'Tab') trapFocus(event);
  });

  window.openAuthModal = openAuthModal;

  // An emailed link opens its view straight away. Nothing is sent until the
  // person enters their password, so a mail scanner fetching the link does
  // nothing.
  function openAuthLink(link) {
    if (!link || typeof link.token !== 'string') return;
    linkToken = link.token;
    openAuthModal({ view: link.kind === 'reset' ? VIEW.RESET : VIEW.CONFIRM });
  }

  openAuthLink(window.authLink);
  window.authLink = null;
  // A link opened in a tab that already shows the app only changes the
  // fragment, so the page does not load again.
  window.addEventListener('hashchange', () => {
    if (window.takeAuthLink) openAuthLink(window.takeAuthLink());
  });
})();
