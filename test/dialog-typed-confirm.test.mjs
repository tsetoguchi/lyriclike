// Deleting an account with only Google asks for the email address typed back.
// Phones capitalise the first letter, so the match ignores case and the box
// asks the keyboard not to capitalise. Other fields (a page's name) keep it.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../dialog.js', import.meta.url), 'utf8');
const EMAIL = 'taosetoguchi@gmail.com';

class FakeElement {
  constructor() {
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() {}
  select() {}
}

function loadDialog() {
  const elements = new Map();
  const document = {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
  };
  const context = { document, setTimeout: () => 0, clearTimeout() {} };
  context.window = context;
  vm.runInNewContext(SOURCE, context);
  return { Dialog: context.Dialog, input: elements.get('dialog-input'),
    confirm: elements.get('dialog-confirm') };
}

function type(input, text) {
  input.value = text;
  input.listeners.get('input')();
}

function askForEmail(Dialog) {
  Dialog.open({
    heading: 'Delete account', confirmLabel: 'Delete account',
    field: { label: 'Email address', value: '', mustMatch: EMAIL },
  });
}

describe('a field that has to be typed back', () => {
  it('unlocks when the phone capitalised the first letter', () => {
    const { Dialog, input, confirm } = loadDialog();
    askForEmail(Dialog);
    assert.equal(confirm.disabled, true);
    type(input, 'Taosetoguchi@gmail.com');
    assert.equal(confirm.disabled, false);
  });

  it('stays locked for a different address', () => {
    const { Dialog, input, confirm } = loadDialog();
    askForEmail(Dialog);
    type(input, 'taosetoguchi@gmail.co');
    assert.equal(confirm.disabled, true);
  });

  it('turns capitals off only for that kind of field', () => {
    const { Dialog, input } = loadDialog();
    askForEmail(Dialog);
    assert.equal(input.attributes.get('autocapitalize'), 'off');
    Dialog.open({ heading: 'Rename', confirmLabel: 'Save', field: { label: 'Title', value: '' } });
    assert.equal(input.attributes.has('autocapitalize'), false);
  });
});
