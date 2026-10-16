// Local smoke run for the live-editing room: two WebSocket clients against
// `wrangler dev` (collab/) and `wrangler pages dev` (the site), checking the
// handoff, relaying, persisted acks, write-back and the old-protocol refusal.
// See plans/live-editing-2-room.md, Task 12, for starting both servers.
//
//   node tools/live-smoke.mjs
import { Y } from '../collab/src/deps.js';
import {
  CLOSE, SYNC, encodeSyncStep1, encodeSyncStep2, encodeUpdate, readRoomMessage,
} from '../collab/src/protocol.js';
import liveCore from '../live-core.js';

const SITE = 'http://localhost:8788';
const PAGE = 'smoke-page';
const TOKENS = { ann: 'smoke-token-ann', bo: 'smoke-token-bo' };
const WAIT_STEP_MS = 100;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, timeoutMs, label) {
  for (let waited = 0; waited < timeoutMs; waited += WAIT_STEP_MS) {
    if (await check()) return;
    await wait(WAIT_STEP_MS);
  }
  throw new Error(`timed out: ${label}`);
}

function receive(client, message) {
  if (message.kind === 'persisted') client.persisted = message.snapshot;
  if (message.kind !== 'sync') return;
  if (message.syncType === SYNC.STEP1) client.socket.send(encodeSyncStep2(client.doc, message.payload));
  else Y.applyUpdate(client.doc, message.payload, 'room');
}

function connect(who, protocol = 1) {
  const url = `${SITE.replace('http', 'ws')}/api/lyrics/${PAGE}/live?protocol=${protocol}`;
  const socket = new WebSocket(url, { headers: { Cookie: `sid=${TOKENS[who]}`, Origin: SITE } });
  socket.binaryType = 'arraybuffer';
  const client = { who, socket, doc: new Y.Doc(), persisted: null, closed: null, isOpen: false };
  socket.onopen = () => {
    client.isOpen = true;
    socket.send(encodeSyncStep1(client.doc));
  };
  socket.onclose = event => { client.closed = event.code; };
  socket.onmessage = event => receive(client, readRoomMessage(new Uint8Array(event.data)));
  client.doc.on('update', (update, origin) => {
    if (origin !== 'room' && client.isOpen) socket.send(encodeUpdate(update));
  });
  return client;
}

const text = client => client.doc.getText('body').toString();

async function storedBody() {
  const response = await fetch(`${SITE}/api/lyrics/${PAGE}`, { headers: { Cookie: `sid=${TOKENS.ann}` } });
  return (await response.json()).body;
}

async function checkEditing(ann, bo) {
  await until(() => text(ann) === 'hello' && text(bo) === 'hello', 5000, 'both see the page');
  console.log('ok  both clients synced the page');
  let edit = null;
  ann.doc.once('update', update => { edit = update; });
  ann.doc.getText('body').insert(5, ' world');
  await until(() => text(bo) === 'hello world', 3000, 'Bo sees Ann type');
  console.log('ok  an edit reached the other client');
  await until(() => ann.persisted && liveCore.isUpdateSaved(Y, edit, ann.persisted), 8000, 'persisted covers the edit');
  console.log('ok  persisted covered the edit');
  await until(async () => (await storedBody()) === 'hello world', 15000, 'write-back to D1');
  console.log('ok  the room wrote the text back to D1');
}

async function checkOldProtocol() {
  const old = connect('bo', 0);
  await until(() => old.closed !== null, 5000, 'old protocol closed');
  if (old.closed !== CLOSE.OLD_PROTOCOL) throw new Error(`old protocol closed with ${old.closed}`);
  console.log('ok  an old protocol was refused with 4001');
}

async function checkLastLeave(ann, bo) {
  bo.doc.getText('body').insert(0, 'oh ');
  await until(() => text(ann) === 'oh hello world', 3000, 'Ann sees Bo type');
  ann.socket.close();
  bo.socket.close();
  // Locally the two processes share one SQLite file, so a write can meet
  // "database is locked" and land on the room's retry instead.
  await until(async () => (await storedBody()) === 'oh hello world', 30000, 'write-back when the last one left');
  console.log('ok  the last one leaving wrote the final text back');
}

async function main() {
  const ann = connect('ann');
  const bo = connect('bo');
  await checkEditing(ann, bo);
  await checkLastLeave(ann, bo);
  // Last: a close the room starts did not reach the client through the local
  // two-process proxy (2026-10-11); this check is for the preview deploy.
  await checkOldProtocol();
}

main().then(() => process.exit(0), err => {
  console.error('FAIL', err.message);
  process.exit(1);
});
