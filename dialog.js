// One panel for everything the app needs to ask. It comes in three shapes:
// a question with a field (naming a page), a question without one (deleting
// a page), and a question whose field has to be typed correctly before the
// answer counts (deleting an account with only Google). A field can also be a
// password (deleting an account that has one). open resolves with the field's
// contents, or true when there is no field, or null if the person backed out.
//
// window.openDialog stays as well: the closed extension script calls it by
// that name.
(function exposeDialog() {
  'use strict';

  const FOCUS_DELAY_MS = 50;
  const CLOSE_DELAY_MS = 250;
  const OPEN_CLASS = 'open';

  const overlay = document.getElementById('dialog-overlay');
  const input = document.getElementById('dialog-input');
  const confirm = document.getElementById('dialog-confirm');
  const cancel = document.getElementById('dialog-cancel');
  const messageEl = document.getElementById('dialog-message');
  const fieldEl = document.getElementById('dialog-field');
  const closeButton = document.getElementById('dialog-close');

  let resolveDialog = null;
  let requiredAnswer = null;

  function showField(field) {
    fieldEl.hidden = !field;
    requiredAnswer = field && field.mustMatch ? field.mustMatch : null;
    if (!field) return;
    document.getElementById('dialog-label').textContent = field.label;
    input.placeholder = field.label;
    input.value = field.value || '';
    // A password field also tells password managers what to fill.
    input.type = field.type || 'text';
    input.autocomplete = field.type === 'password' ? 'current-password' : 'off';
  }

  function open({
    heading, message, confirmLabel, danger, field, noCancel = false, cancelLabel = 'Cancel',
  }) {
    document.getElementById('dialog-title').textContent = heading;
    // A dialog that only tells something has nothing to cancel, so the X
    // closes it instead.
    cancel.hidden = noCancel;
    closeButton.hidden = !noCancel;
    cancel.textContent = cancelLabel;
    confirm.textContent = confirmLabel;
    confirm.classList.toggle('danger-btn', Boolean(danger));

    messageEl.textContent = message || '';
    messageEl.hidden = !message;

    showField(field);
    updateConfirmState();

    overlay.hidden = false;
    overlay.classList.add(OPEN_CLASS);

    // Focus once the panel is on its way in, so iOS raises the keyboard for it.
    setTimeout(() => {
      if (field) { input.focus(); input.select(); } else { confirm.focus(); }
    }, FOCUS_DELAY_MS);

    return new Promise(resolve => { resolveDialog = resolve; });
  }

  // Only a field that has to match can hold the button shut.
  function updateConfirmState() {
    confirm.disabled = requiredAnswer !== null && input.value.trim() !== requiredAnswer;
  }

  function close(answer) {
    overlay.classList.remove(OPEN_CLASS);
    // Wait out the fade before taking it out of the page entirely.
    setTimeout(() => {
      if (!overlay.classList.contains(OPEN_CLASS)) overlay.hidden = true;
    }, CLOSE_DELAY_MS);
    const resolve = resolveDialog;
    resolveDialog = null;
    requiredAnswer = null;
    if (resolve) resolve(answer);
  }

  function submit() {
    if (confirm.disabled) return;
    close(fieldEl.hidden ? true : input.value);
  }

  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', () => close(null));
  closeButton.addEventListener('click', () => close(null));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close(null);
  });
  input.addEventListener('input', updateConfirmState);
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
  });

  window.Dialog = { open, close };
  window.openDialog = open;
})();
