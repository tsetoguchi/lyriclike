// The textarea binding: local edits go to Yjs one at a time, remote edits
// wait for the next frame (and for IME composition to end), the caret
// keeps its place, and undo takes back only this person's words.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import binding from '../live-binding.js';
import liveCore from '../live-core.js';
import { FakeTextarea } from './support/fake-textarea.mjs';
import { Y, newDmp } from './support/live-deps.mjs';

const { LOCAL_ORIGIN, MAX_BODY_LENGTH, createTextBinding } = binding;

let textarea;
let doc;
let bound;
let frames;
let tooLong;

// Another person's copy of the same page, to make remote updates with.
function coWriter() {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  return {
    edit(change) {
      let update = null;
      other.once('update', captured => { update = captured; });
      change(other.getText('body'));
      return update;
    },
  };
}

function runFrames() {
  for (const frame of frames.splice(0)) frame();
}

beforeEach(() => {
  textarea = new FakeTextarea('hello world');
  doc = new Y.Doc();
  doc.getText('body').insert(0, 'hello world');
  frames = [];
  tooLong = 0;
  bound = createTextBinding({
    textarea, doc, Y, liveCore, dmp: newDmp(),
    schedule: frame => frames.push(frame),
    isFocused: () => true,
    onTooLong: () => { tooLong += 1; },
  });
});

describe('local edits', () => {
  it('applies a typed letter to Yjs as a local edit', () => {
    const origins = [];
    doc.on('update', (update, origin) => origins.push(origin));
    textarea.type(5, ',');
    assert.equal(doc.getText('body').toString(), 'hello, world');
    assert.deepEqual(origins, [LOCAL_ORIGIN]);
  });

  it('syncs an untrusted input too, such as the mobile rhyme swap', () => {
    textarea.value = 'jello world';
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new Event('input'));
    assert.equal(doc.getText('body').toString(), 'jello world');
  });

  it('reverts an edit past the length cap, with a notice', () => {
    textarea.type(0, 'x'.repeat(MAX_BODY_LENGTH));
    assert.equal(textarea.value, 'hello world');
    assert.equal(doc.getText('body').toString(), 'hello world');
    assert.equal(tooLong, 1);
  });
});

describe('remote edits', () => {
  it('waits for the next frame, then shows the edit', () => {
    const update = coWriter().edit(text => text.insert(0, 'oh '));
    bound.queueRemote(update);
    assert.equal(textarea.value, 'hello world');
    runFrames();
    assert.equal(textarea.value, 'oh hello world');
  });

  it('moves the caret past an edit before it and leaves it for one after', () => {
    textarea.setSelectionRange(6, 6);
    bound.queueRemote(coWriter().edit(text => text.insert(0, 'oh ')));
    runFrames();
    assert.equal(textarea.selectionStart, 9);
    bound.queueRemote(coWriter().edit(text => text.insert(text.length, '!')));
    runFrames();
    assert.equal(textarea.selectionStart, 9);
  });

  it('tells the page with an untrusted input, and sends nothing back', () => {
    const local = [];
    doc.on('update', (update, origin) => { if (origin === LOCAL_ORIGIN) local.push(update); });
    let inputs = 0;
    textarea.addEventListener('input', event => { if (!event.isTrusted) inputs += 1; });
    bound.queueRemote(coWriter().edit(text => text.insert(0, 'oh ')));
    runFrames();
    assert.equal(inputs, 1);
    assert.deepEqual(local, []);
  });

  it('places a keystroke typed while a remote edit waits where it was typed', () => {
    bound.queueRemote(coWriter().edit(text => text.insert(0, 'oh ')));
    textarea.type(11, '!');
    runFrames();
    assert.equal(textarea.value, 'oh hello world!');
    assert.equal(doc.getText('body').toString(), 'oh hello world!');
  });

  it('holds remote edits until an IME composition ends', () => {
    textarea.dispatchEvent(new Event('compositionstart'));
    bound.queueRemote(coWriter().edit(text => text.insert(0, 'oh ')));
    runFrames();
    assert.equal(textarea.value, 'hello world');
    textarea.type(11, 'ね');
    textarea.dispatchEvent(new Event('compositionend'));
    runFrames();
    assert.equal(textarea.value, 'oh hello worldね');
  });
});

describe('undo', () => {
  it('takes back only my own words, never the co-writer’s', () => {
    textarea.type(11, ' again');
    bound.queueRemote(coWriter().edit(text => text.insert(0, 'oh ')));
    runFrames();
    bound.undo();
    assert.equal(textarea.value, 'oh hello world');
    bound.redo();
    assert.equal(textarea.value, 'oh hello world again');
  });

  it('answers Ctrl+Z and the keyboard undo, and stops the browser’s own', () => {
    textarea.type(11, '!');
    const key = textarea.key({ key: 'z', ctrlKey: true });
    assert.equal(key.defaultPrevented, true);
    assert.equal(textarea.value, 'hello world');
    textarea.type(11, '?');
    const native = textarea.beforeInput('historyUndo');
    assert.equal(native.defaultPrevented, true);
    assert.equal(textarea.value, 'hello world');
  });
});

describe('applyLocalText', () => {
  it('turns the textarea into new text with minimal local edits', () => {
    bound.applyLocalText('hello there world');
    assert.equal(textarea.value, 'hello there world');
    assert.equal(doc.getText('body').toString(), 'hello there world');
  });
});

describe('destroy', () => {
  it('stops listening', () => {
    bound.destroy();
    textarea.type(0, 'x');
    assert.equal(doc.getText('body').toString(), 'hello world');
  });
});

describe('the length cap', () => {
  it('still lets a page pushed past the cap by others be shortened', () => {
    const long = 'x'.repeat(MAX_BODY_LENGTH + 5);
    const longArea = new FakeTextarea(long);
    const longDoc = new Y.Doc();
    longDoc.getText('body').insert(0, long);
    createTextBinding({ textarea: longArea, doc: longDoc, Y, liveCore, dmp: newDmp(), schedule: () => {}, isFocused: () => true });
    longArea.replace(0, 1, '');
    assert.equal(longDoc.getText('body').length, MAX_BODY_LENGTH + 4);
  });
});
