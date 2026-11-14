// Asks iPhone writers for an App Store review. Apple's own sheet is used,
// since its rules ban a home-made one, and Apple shows it at most three times
// a year, so each ask has to count: a week after first launch, on a third day
// of use, once per app version, and only after a page with a real verse in it
// has saved. It waits until the writer stops typing, so it never cuts in.
(() => {
  const STATE_KEY = 'review_prompt';
  const MIN_DAYS_INSTALLED = 7;
  const MIN_DAYS_USED = 3;
  // About a verse: enough words to have got something out of the app.
  const MIN_WRITTEN_LINES = 8;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const DAY_PART_WIDTH = 2;
  // The app's number in App Store Connect (App Information > Apple ID), for
  // the "Rate LyricLike" row. Empty hides the row.
  const APP_STORE_ID = '6831974243';
  const RATE_ROW_ID = 'account-rate-app';
  const ASKED_EVENT = 'review_prompt_requested';
  const RATE_EVENT = 'review_page_opened';

  function padDayPart(number) {
    return String(number).padStart(DAY_PART_WIDTH, '0');
  }

  // The writer's own calendar day, so a day of use matches their clock.
  function dayKeyOf(date) {
    const month = padDayPart(date.getMonth() + 1);
    return `${date.getFullYear()}-${month}-${padDayPart(date.getDate())}`;
  }

  function daysBetween(fromDayKey, toDayKey) {
    return Math.round((Date.parse(toDayKey) - Date.parse(fromDayKey)) / MS_PER_DAY);
  }

  function freshState(todayKey) {
    return { firstDay: todayKey, daysUsed: [todayKey], askedVersion: null };
  }

  function isValidState(state) {
    return Boolean(state) && typeof state.firstDay === 'string'
      && Array.isArray(state.daysUsed);
  }

  // Storage that cannot be read starts over, which only delays the ask.
  function readState(storage, todayKey) {
    try {
      const state = JSON.parse(storage.getItem(STATE_KEY));
      if (isValidState(state)) return state;
    } catch {}
    return freshState(todayKey);
  }

  function writeState(storage, state) {
    try {
      storage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {}
  }

  // Past the minimum only the count matters, so the list stays short.
  function withDayUsed(state, todayKey) {
    if (state.daysUsed.includes(todayKey)) return state;
    return { ...state, daysUsed: [...state.daysUsed, todayKey].slice(-MIN_DAYS_USED) };
  }

  function isReviewDue(state, todayKey, appVersion) {
    if (!appVersion || state.askedVersion === appVersion) return false;
    if (state.daysUsed.length < MIN_DAYS_USED) return false;
    return daysBetween(state.firstDay, todayKey) >= MIN_DAYS_INSTALLED;
  }

  function countWrittenLines(body) {
    return body.split('\n').filter(line => line.trim() !== '').length;
  }

  function hasRealVerse(body) {
    return countWrittenLines(body) >= MIN_WRITTEN_LINES;
  }

  function canRequestReview(appStore) {
    return Boolean(appStore && appStore.requestReview);
  }

  function canWriteReview(appStore, appId) {
    return Boolean(appStore && appStore.writeReview && appId);
  }

  window.ReviewPrompt = {
    dayKeyOf, readState, withDayUsed, isReviewDue, hasRealVerse,
    canRequestReview, canWriteReview, afterSave() {},
  };

  const appStore = window.NativeShell && window.NativeShell.appStore;
  if (!canRequestReview(appStore)) return;

  const lyricsEl = document.getElementById('lyrics');
  let appVersion = null;
  // Set when a real verse saved; the ask waits for the writer to stop typing.
  let isAskEarned = false;

  function todayKey() {
    return dayKeyOf(new Date());
  }

  function recordDayUsed() {
    const today = todayKey();
    writeState(localStorage, withDayUsed(readState(localStorage, today), today));
  }

  function askIfDue() {
    const today = todayKey();
    const state = readState(localStorage, today);
    if (!isAskEarned || !isReviewDue(state, today, appVersion)) return;
    isAskEarned = false;
    writeState(localStorage, { ...state, askedVersion: appVersion });
    appStore.requestReview()
      .then(() => window.trackEvent(ASKED_EVENT))
      .catch(error => console.warn('The review sheet could not be asked for:', error));
  }

  function afterSave(body) {
    if (!hasRealVerse(body)) return;
    isAskEarned = true;
    if (document.activeElement !== lyricsEl) askIfDue();
  }

  function loadAppVersion() {
    const app = window.Capacitor && window.Capacitor.Plugins.App;
    if (!app || !app.getInfo) return;
    app.getInfo()
      .then(info => { appVersion = info.version; })
      .catch(error => console.warn('The app version could not be read:', error));
  }

  function openReviewPage() {
    appStore.writeReview(APP_STORE_ID)
      .then(() => window.trackEvent(RATE_EVENT))
      .catch(error => console.warn('The App Store could not be opened:', error));
  }

  function showRateRow() {
    const rateRow = document.getElementById(RATE_ROW_ID);
    if (!rateRow || !canWriteReview(appStore, APP_STORE_ID)) return;
    rateRow.hidden = false;
    rateRow.addEventListener('click', openReviewPage);
  }

  window.ReviewPrompt.afterSave = afterSave;
  loadAppVersion();
  recordDayUsed();
  showRateRow();
  lyricsEl.addEventListener('blur', askIfDue);
  // The app can sit open in the background across days.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recordDayUsed();
  });
})();
