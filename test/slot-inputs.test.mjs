// The checks on what an extension passes to the page slots. They touch no
// page, so Node can run them.
//
//   node --test test/slot-inputs.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import slotInputs from '../slot-inputs.js';

const {
  readAction,
  readWords,
  readPreview,
  previewLines,
  MAX_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_TAG_LENGTH,
  LINE_MARKS,
} = slotInputs;

const ICON = '<svg viewBox="0 0 1 1"></svg>';

describe('constants', () => {
  it('has the agreed limits', () => {
    assert.equal(MAX_LABEL_LENGTH, 40);
    assert.equal(MAX_TITLE_LENGTH, 300);
    assert.equal(MAX_BODY_LENGTH, 500000);
    assert.equal(MAX_TAG_LENGTH, 64);
    assert.deepEqual(LINE_MARKS, ['added', 'removed']);
  });
});

describe('readAction', () => {
  const onClick = () => {};

  it('returns a good action', () => {
    const action = { label: 'Open', icon: ICON, onClick };
    assert.deepEqual(readAction(action), { label: 'Open', icon: ICON, onClick });
  });

  it('refuses a bad label', () => {
    assert.equal(readAction({ label: '', icon: ICON, onClick }), null);
    assert.equal(readAction({ label: 'x'.repeat(41), icon: ICON, onClick }), null);
    assert.equal(readAction({ label: 5, icon: ICON, onClick }), null);
  });

  it('accepts a label of exactly 40 characters', () => {
    assert.notEqual(readAction({ label: 'x'.repeat(40), icon: ICON, onClick }), null);
  });

  it('refuses an icon that is not svg', () => {
    assert.equal(readAction({ label: 'Open', icon: '<img src=x>', onClick }), null);
  });

  it('refuses a missing onClick', () => {
    assert.equal(readAction({ label: 'Open', icon: ICON }), null);
  });

  it('refuses null and a string', () => {
    assert.equal(readAction(null), null);
    assert.equal(readAction('Open'), null);
  });
});

describe('readWords', () => {
  it('gives a null tag when none is passed', () => {
    assert.deepEqual(readWords({ title: 'T', body: 'b' }), {
      title: 'T',
      body: 'b',
      tag: null,
    });
  });

  it('keeps a good tag', () => {
    assert.equal(readWords({ title: 'T', body: 'b', tag: 'x' }).tag, 'x');
  });

  it('refuses a long tag, a bad body, and a long title', () => {
    assert.equal(readWords({ title: 'T', body: 'b', tag: 'x'.repeat(65) }), null);
    assert.equal(readWords({ title: 'T', body: 5 }), null);
    assert.equal(readWords({ title: 'T', body: 'x'.repeat(MAX_BODY_LENGTH + 1) }), null);
    assert.equal(readWords({ title: 'x'.repeat(301), body: 'b' }), null);
  });

  it('refuses null', () => {
    assert.equal(readWords(null), null);
  });
});

describe('previewLines', () => {
  it('pairs each line with its mark', () => {
    assert.deepEqual(previewLines('a\nb\nc', ['added', 'removed', null]), [
      { text: 'a', mark: 'added', isCounted: true },
      { text: 'b', mark: 'removed', isCounted: false },
      { text: 'c', mark: null, isCounted: true },
    ]);
  });

  it('has no marks when none are passed', () => {
    assert.deepEqual(previewLines('a\nb'), [
      { text: 'a', mark: null, isCounted: true },
      { text: 'b', mark: null, isCounted: true },
    ]);
  });
});

describe('readPreview', () => {
  it('returns title, lines and no bar for a good call', () => {
    assert.deepEqual(readPreview({ title: 'T', body: 'a\nb' }), {
      title: 'T',
      lines: previewLines('a\nb'),
      bar: null,
    });
  });

  it('refuses lineMarks of the wrong length', () => {
    assert.equal(readPreview({ title: 'T', body: 'a\nb', lineMarks: [null] }), null);
  });

  it('refuses an unknown mark', () => {
    const lineMarks = ['changed', null];
    assert.equal(readPreview({ title: 'T', body: 'a\nb', lineMarks }), null);
  });

  it('refuses a bar that is not an element', () => {
    assert.equal(readPreview({ title: 'T', body: 'a', bar: {} }), null);
  });

  it('refuses null', () => {
    assert.equal(readPreview(null), null);
  });
});
