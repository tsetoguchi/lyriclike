// Apps like Instagram and TikTok open links in their own browser, and Google
// refuses to sign anyone in there. Inside one, the sign-in box says so under
// the Google button and says how to get out to a real browser.
// The name shown to the reader, and how the app's browser gives itself away.
const IN_APP_BROWSERS = [
  { name: 'Instagram', pattern: /Instagram/ },
  { name: 'Facebook', pattern: /FBAN|FBAV|FB_IAB/ },
  { name: 'TikTok', pattern: /musical_ly|BytedanceWebview|TikTok/i },
  { name: 'Snapchat', pattern: /Snapchat/ },
  { name: 'LINE', pattern: /\bLine\// },
];

function detectInAppBrowser(userAgent) {
  const match = IN_APP_BROWSERS.find(({ pattern }) => pattern.test(userAgent));
  return match ? match.name : null;
}

function describeWayOut(appName) {
  return `Google sign-in doesn't work inside ${appName}. `
    + 'Open this page in Safari or Chrome first: tap the ⋯ menu and choose '
    + 'Open in browser.';
}

function showWayOut(appName) {
  const hintEl = document.getElementById('auth-in-app');
  hintEl.textContent = describeWayOut(appName);
  hintEl.hidden = false;
}

const appName = detectInAppBrowser(navigator.userAgent);
if (appName !== null) showWayOut(appName);
