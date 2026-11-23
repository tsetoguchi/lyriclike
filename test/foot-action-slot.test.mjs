// The extension hook for the sidebar's foot: a spot left of the account for
// the script's own small buttons. Runs the real extensions.js against a
// small fake page.
//
//   node --test test/foot-action-slot.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const FOOT_ACTION_SLOT_ID = 'sidebar-foot-action-slot';
const EXPECTED_HOOK_VERSION = 11;

function readScript(name) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function fakeNode() {
  return { addEventListener() {}, appendChild() {} };
}

function loadHooks(elements) {
  const document = fakeNode();
  document.getElementById = (id) => elements.get(id) || null;
  document.head = fakeNode();
  const context = { document, console: { warn() {} } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readScript('extensions.js'), context);
  return context.siteExtensions;
}

describe('the sidebar foot action slot hook', () => {
  it('hands out the foot action slot', () => {
    const slot = fakeNode();
    const hooks = loadHooks(new Map([[FOOT_ACTION_SLOT_ID, slot]]));
    assert.equal(hooks.sidebarFootActionSlot(), slot);
  });

  it('answers null on a page without the slot', () => {
    assert.equal(loadHooks(new Map()).sidebarFootActionSlot(), null);
  });

  it(`announces hook version ${EXPECTED_HOOK_VERSION}`, () => {
    assert.equal(loadHooks(new Map()).version, EXPECTED_HOOK_VERSION);
  });
});
