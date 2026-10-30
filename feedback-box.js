// The feedback box the envelope at the foot of the sidebar opens. A message
// goes to /api/feedback, which emails it on; a thank-you replaces the form
// once it has gone.
const FEEDBACK_URL = '/api/feedback';
const FOCUS_DELAY_MS = 50;
const CLOSE_DELAY_MS = 250;
const HTTP_TOO_MANY_REQUESTS = 429;
const SEND_LABEL = 'Send';
const SENDING_LABEL = 'Sending…';
const TOO_MANY_MESSAGE = "You've sent a few already. Try again in a bit.";
const FAILED_MESSAGE = "Couldn't send it. Try again in a moment.";
const SIGNED_IN_NOTE = 'Your email comes with it, so I can reply.';
const SIGNED_OUT_NOTE = "Add your email if you'd like a reply.";

const overlay = document.getElementById('feedback-overlay');
const form = document.getElementById('feedback-form');
const input = document.getElementById('feedback-input');
const sendButton = document.getElementById('feedback-send');
const errorBox = document.getElementById('feedback-error');
const sentView = document.getElementById('feedback-sent');

let isSending = false;

function updateSendButton() {
  sendButton.disabled = isSending || !input.value.trim();
}

function showForm() {
  form.hidden = false;
  sentView.hidden = true;
  errorBox.textContent = '';
  document.getElementById('feedback-note').textContent =
    window.currentUser ? SIGNED_IN_NOTE : SIGNED_OUT_NOTE;
  updateSendButton();
}

function isFeedbackOpen() {
  return overlay.classList.contains('open');
}

// A draft that wasn't sent is kept for the next time the box opens.
function openFeedbackBox() {
  showForm();
  overlay.hidden = false;
  overlay.classList.add('open');
  setTimeout(() => input.focus(), FOCUS_DELAY_MS);
}

export function closeFeedbackBox() {
  overlay.classList.remove('open');
  setTimeout(() => { if (!isFeedbackOpen()) overlay.hidden = true; }, CLOSE_DELAY_MS);
}

async function errorMessageFor(response) {
  if (response.status === HTTP_TOO_MANY_REQUESTS) return TOO_MANY_MESSAGE;
  try {
    return (await response.json()).message || FAILED_MESSAGE;
  } catch {
    return FAILED_MESSAGE;
  }
}

async function postMessage(message) {
  try {
    const response = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return response.ok ? null : await errorMessageFor(response);
  } catch {
    return FAILED_MESSAGE;
  }
}

function setSending(isNowSending) {
  isSending = isNowSending;
  sendButton.textContent = isNowSending ? SENDING_LABEL : SEND_LABEL;
  updateSendButton();
}

async function sendFeedback(event) {
  event.preventDefault();
  if (sendButton.disabled) return;
  errorBox.textContent = '';
  setSending(true);
  const error = await postMessage(input.value.trim());
  setSending(false);
  if (error) {
    errorBox.textContent = error;
    return;
  }
  input.value = '';
  form.hidden = true;
  sentView.hidden = false;
  document.getElementById('feedback-done').focus();
}

function closeOnScrimOrEscape(event) {
  const isScrimClick = event.type === 'click' && event.target === overlay;
  const isEscape = event.type === 'keydown' && event.key === 'Escape';
  if (!isScrimClick && !isEscape) return;
  event.preventDefault();
  closeFeedbackBox();
}

// The envelope sits in the sidebar and on the folded sidebar's rail.
for (const button of document.querySelectorAll('[data-feedback-open]')) {
  button.addEventListener('click', openFeedbackBox);
}
document.getElementById('feedback-close').addEventListener('click', closeFeedbackBox);
document.getElementById('feedback-cancel').addEventListener('click', closeFeedbackBox);
document.getElementById('feedback-done').addEventListener('click', closeFeedbackBox);
input.addEventListener('input', updateSendButton);
form.addEventListener('submit', sendFeedback);
overlay.addEventListener('click', closeOnScrimOrEscape);
overlay.addEventListener('keydown', closeOnScrimOrEscape);
