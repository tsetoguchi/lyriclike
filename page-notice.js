// A strip under the title for what happened to the page: a save that someone
// else beat, or a page this account can no longer open. Amber buttons are for
// choices; a notice that only tells closes with a quiet ✕. The conflict bar
// has no ✕: one of its two choices has to be made.
(function exposePageNotice() {
  'use strict';

  const CLOSE_LABEL = 'Dismiss';
  const CLOSE_TEXT = '✕';

  const notice = document.getElementById('page-notice');
  const textEl = document.getElementById('page-notice-text');
  const buttons = document.getElementById('page-notice-actions');

  function actionButton({ label, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample-clear';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function closeButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lyrics-action-btn page-notice-close';
    button.setAttribute('aria-label', CLOSE_LABEL);
    button.title = CLOSE_LABEL;
    button.textContent = CLOSE_TEXT;
    button.addEventListener('click', hide);
    return button;
  }

  function show(text, actions = [], { closable = true } = {}) {
    textEl.textContent = text;
    buttons.innerHTML = '';
    for (const action of actions) buttons.appendChild(actionButton(action));
    if (closable) buttons.appendChild(closeButton());
    notice.hidden = false;
  }

  function hide() {
    notice.hidden = true;
  }

  window.PageNotice = { show, hide };
})();
