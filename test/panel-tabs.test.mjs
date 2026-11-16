// The word panel's list of tabs: which are added, and which one shows.
// It touches no page, so Node can run it.
//
//   node --test test/panel-tabs.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import panelTabs from '../panel-tabs.js';

const { createTabList, RHYMES_TAB_ID } = panelTabs;

function tab(label) {
  return { label, onOpen() {}, onClose: null };
}

describe('createTabList', () => {
  it('starts on Rhymes with nothing added', () => {
    const list = createTabList();
    assert.equal(RHYMES_TAB_ID, 'rhymes');
    assert.equal(list.activeId(), RHYMES_TAB_ID);
    assert.deepEqual(list.added(), []);
  });

  it('adds tabs in order, two with one label included', () => {
    const list = createTabList();
    const first = list.add(tab('More'));
    const second = list.add(tab('More'));
    assert.notEqual(first, second);
    assert.deepEqual(list.added(),
      [{ id: first, label: 'More' }, { id: second, label: 'More' }]);
  });

  it('select reports what closed and what opened', () => {
    const list = createTabList();
    const more = tab('More');
    const id = list.add(more);
    assert.deepEqual(list.select(id), { closed: null, opened: more });
    assert.equal(list.activeId(), id);
    assert.deepEqual(list.select(RHYMES_TAB_ID), { closed: more, opened: null });
    assert.equal(list.activeId(), RHYMES_TAB_ID);
  });

  it('select answers null for the tab already showing', () => {
    const list = createTabList();
    const id = list.add(tab('More'));
    list.select(id);
    assert.equal(list.select(id), null);
    assert.equal(createTabList().select(RHYMES_TAB_ID), null);
  });

  it('select answers null for a tab it does not have', () => {
    assert.equal(createTabList().select('nope'), null);
  });

  it('moves from one added tab to another', () => {
    const list = createTabList();
    const first = tab('One');
    const second = tab('Two');
    list.add(first);
    const secondId = list.add(second);
    list.select(list.added()[0].id);
    assert.deepEqual(list.select(secondId), { closed: first, opened: second });
  });

  it('removing the active tab goes back to Rhymes', () => {
    const list = createTabList();
    const id = list.add(tab('More'));
    list.select(id);
    assert.equal(list.remove(id), true);
    assert.equal(list.activeId(), RHYMES_TAB_ID);
    assert.deepEqual(list.added(), []);
  });

  it('removing a tab twice answers false the second time', () => {
    const list = createTabList();
    const id = list.add(tab('More'));
    assert.equal(list.remove(id), true);
    assert.equal(list.remove(id), false);
  });

  it('never reuses an id', () => {
    const list = createTabList();
    const first = list.add(tab('One'));
    list.remove(first);
    assert.notEqual(list.add(tab('Two')), first);
  });
});
