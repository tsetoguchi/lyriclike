// SPIKE ONLY (branch live-spike): drives the echo room for the checks in
// plans/live-co-editing.md §3.2. Not for merging.
const PING_MS = 30_000;
const LOAD_MINUTES = 10;
const UPDATE_EVERY_MS = 200;
const PRESENCE_EVERY_MS = 500;
const SIZE_STEPS_KB = [64, 256, 512, 1024, 1536, 2048, 3072, 4096, 8192];
const SIZE_WAIT_MS = 15_000;

let socket = null;
let lyricId = null;
let hiddenAt = null;
let connectedAt = null;
let pingTimer = null;
const waiters = new Set();

function log(text) {
  const line = `${new Date().toLocaleTimeString()}  ${text}\n`;
  const box = document.getElementById('log');
  box.textContent = line + box.textContent;
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function isOpen() {
  return socket && socket.readyState === WebSocket.OPEN;
}

async function pickLyric() {
  const fromUrl = new URLSearchParams(location.search).get('id');
  if (fromUrl) return fromUrl;
  const res = await fetch('/api/lyrics');
  log(`page list: ${res.status}`);
  if (res.status === 401) return null;
  const list = await res.json();
  const lyrics = Array.isArray(list) ? list : list.lyrics || [];
  return lyrics.length ? lyrics[0].id : null;
}

function handleMessage(event) {
  if (event.data === 'pong') return log('pong (auto-response, room stays asleep)');
  const message = JSON.parse(event.data);
  for (const waiter of waiters) waiter(message);
  if (message.type === 'echo') return;
  log(`room says: ${event.data}`);
}

function connect() {
  if (!lyricId) return;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/lyrics/${lyricId}/live`;
  setStatus('Connecting…');
  socket = new WebSocket(url);
  socket.onopen = () => {
    connectedAt = Date.now();
    setStatus('Connected');
    log(`open: ${url}`);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => isOpen() && socket.send('ping'), PING_MS);
  };
  socket.onmessage = handleMessage;
  socket.onerror = () => log('error event (see close code)');
  socket.onclose = event => {
    const lived = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : 0;
    setStatus(`Closed (${event.code}) — tap anywhere or come back to reconnect`);
    log(`close: code ${event.code} reason "${event.reason}" after ${lived}s`);
    for (const waiter of waiters) waiter({ type: 'closed', code: event.code });
    connectedAt = null;
  };
}

function waitFor(predicate, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => finish({ type: 'timeout' }), timeoutMs);
    function finish(message) {
      clearTimeout(timer);
      waiters.delete(check);
      resolve(message);
    }
    function check(message) {
      if (predicate(message)) finish(message);
    }
    waiters.add(check);
  });
}

function sendEcho(kind) {
  if (isOpen()) socket.send(JSON.stringify({ type: 'echo', kind, at: Date.now() }));
}

function runLoad() {
  log(`load: ${LOAD_MINUTES} min, 1 update / ${UPDATE_EVERY_MS} ms + 1 presence / ${PRESENCE_EVERY_MS} ms`);
  const updates = setInterval(() => sendEcho('update'), UPDATE_EVERY_MS);
  const presence = setInterval(() => sendEcho('presence'), PRESENCE_EVERY_MS);
  setTimeout(() => {
    clearInterval(updates);
    clearInterval(presence);
    log('load: done. Tap "Room stats", then note the time for the dashboard.');
  }, LOAD_MINUTES * 60_000);
}

async function sendSize(kb) {
  connect();
  while (!isOpen()) await new Promise(r => setTimeout(r, 250));
  const answer = waitFor(m => m.type === 'size' || m.type === 'closed', SIZE_WAIT_MS);
  socket.send('x'.repeat(kb * 1024));
  const result = await answer;
  if (result.type === 'size') log(`size ${kb} KB: room got ${result.bytes} bytes`);
  else log(`size ${kb} KB: FAILED (${result.type}${result.code ? ' ' + result.code : ''})`);
  return result.type === 'size';
}

async function runSizeTest() {
  for (const kb of SIZE_STEPS_KB) {
    if (!await sendSize(kb)) break;
  }
  log('size test: done');
}

function watchVisibility() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
    log(`back after ${away}s; socket ${isOpen() ? 'still open' : 'closed, reconnecting'}`);
    connect();
  });
  window.addEventListener('online', () => {
    log('online event');
    connect();
  });
  document.body.addEventListener('click', () => connect());
}

function bindButtons() {
  document.getElementById('btn-echo').onclick = () => sendEcho('one');
  document.getElementById('btn-stats').onclick = () => isOpen() && socket.send('{"type":"stats"}');
  document.getElementById('btn-load').onclick = runLoad;
  document.getElementById('btn-size').onclick = runSizeTest;
  document.getElementById('btn-copy').onclick = () =>
    navigator.clipboard.writeText(document.getElementById('log').textContent);
}

async function logDiagnostics() {
  const res = await fetch(`/api/lyrics/${lyricId}/live?probe=1`);
  log(`server sees (plain request): ${res.status} ${await res.text()}`);
}

async function start() {
  bindButtons();
  watchVisibility();
  document.addEventListener('securitypolicyviolation', event => {
    log(`BLOCKED by page security rules: ${event.violatedDirective} ${event.blockedURI}`);
  });
  log(`browser: ${navigator.userAgent}`);
  log(`signed in check: ${(await fetch('/api/me')).status}`);
  lyricId = await pickLyric();
  if (!lyricId) {
    setStatus('Sign in on the main site and write one page first, then reload.');
    return;
  }
  log(`page id ${lyricId}`);
  await logDiagnostics();
  connect();
}

start();
