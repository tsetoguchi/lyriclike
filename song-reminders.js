// The account menu's "Song reminders" switch: whether this account gets the
// "your song is waiting" email when a song sits unfinished for a few days.
// The server answers with the account, so the switch shows what was saved.

const REMINDERS_URL = '/api/me/reminders';
const ON_LABEL = 'On';
const OFF_LABEL = 'Off';
const FAILED_LABEL = "Couldn't save";
const FAILED_SHOW_MS = 2000;

const button = document.getElementById('reminders-toggle-btn');
const stateLabel = document.getElementById('reminders-state');

let isSaving = false;

function showState(isOn) {
  button.setAttribute('aria-checked', String(isOn));
  stateLabel.textContent = isOn ? ON_LABEL : OFF_LABEL;
}

// Older servers don't send reminders_on, so the switch stays hidden there.
function showForUser() {
  const user = window.currentUser;
  const hasSetting = Boolean(user) && typeof user.reminders_on === 'boolean';
  button.hidden = !hasSetting;
  if (hasSetting) showState(user.reminders_on);
}

async function saveSetting(isOn) {
  const res = await fetch(REMINDERS_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: isOn }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).user;
}

function showFailure(wasOn) {
  stateLabel.textContent = FAILED_LABEL;
  setTimeout(() => showState(wasOn), FAILED_SHOW_MS);
}

async function toggle() {
  const user = window.currentUser;
  if (isSaving || !user) return;
  isSaving = true;
  const wasOn = user.reminders_on;
  showState(!wasOn);
  try {
    const saved = await saveSetting(!wasOn);
    if (window.currentUser === user) user.reminders_on = saved.reminders_on;
    showState(saved.reminders_on);
  } catch {
    showFailure(wasOn);
  } finally {
    isSaving = false;
  }
}

if (button && stateLabel) {
  button.addEventListener('click', toggle);
  document.addEventListener('auth-checked', showForUser);
  // sharing.js sends it after the email's turn-off link worked for this account.
  document.addEventListener('reminders-changed', showForUser);
  showForUser();
}
