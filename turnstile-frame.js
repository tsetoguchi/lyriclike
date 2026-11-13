// Shows the security check from the website in a frame, for the iOS app, where
// Turnstile cannot run on the app's own capacitor:// page. The frame page is
// app-check/; it posts back the token, errors, and when the challenge needs
// to be seen.
(function initTurnstileFrame(root) {
  'use strict';

  const FRAME_PATH = '/app-check/';
  const MESSAGE_SOURCE = 'lyriclike-app-check';
  const FRAME_CLASS = 'auth-turnstile-frame';
  const SHOWN_CLASS = 'is-shown';
  const FRAME_TITLE = 'Security check';

  function frameUrl(siteOrigin, siteKey, action) {
    const url = new URL(FRAME_PATH, siteOrigin);
    url.searchParams.set('sitekey', siteKey);
    url.searchParams.set('action', action);
    return url.href;
  }

  function isFromFrame(event, frame, siteOrigin) {
    const data = event.data;
    return event.origin === siteOrigin
      && event.source === frame.contentWindow
      && Boolean(data) && data.source === MESSAGE_SOURCE;
  }

  function handleFrameMessage(data, frame, handlers) {
    if (data.type === 'token' && typeof data.token === 'string') handlers.onToken(data.token);
    else if (data.type === 'error') handlers.onError(String(data.code || ''));
    else if (data.type === 'expired') handlers.onExpired();
    else if (data.type === 'show') frame.classList.add(SHOWN_CLASS);
    else if (data.type === 'hide') frame.classList.remove(SHOWN_CLASS);
  }

  // Returns a handle whose remove() takes the frame and its listener away.
  function mount({ window, container, siteOrigin, siteKey, action, ...handlers }) {
    const frame = window.document.createElement('iframe');
    frame.className = FRAME_CLASS;
    frame.title = FRAME_TITLE;
    frame.src = frameUrl(siteOrigin, siteKey, action);
    const listener = event => {
      if (isFromFrame(event, frame, siteOrigin)) handleFrameMessage(event.data, frame, handlers);
    };
    window.addEventListener('message', listener);
    container.appendChild(frame);
    return {
      remove() {
        window.removeEventListener('message', listener);
        frame.remove();
      },
    };
  }

  const TurnstileFrame = { mount, frameUrl };
  if (typeof module === 'object' && module.exports) {
    module.exports = TurnstileFrame;
    return;
  }
  root.TurnstileFrame = TurnstileFrame;
})(this);
