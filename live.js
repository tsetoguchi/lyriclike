// Live editing in the browser. Task 3 of plans/live-editing-3a-typing.md
// fills this in; for now it only names the bundle.
(function exposeLive(root) {
  'use strict';
  const LIVE_DEPS_SRC = '/vendor/live-deps-yjs13.6.33-p1.js';
  const Live = { LIVE_DEPS_SRC };
  if (typeof module === 'object' && module.exports) module.exports = Live;
  else root.Live = Live;
})(this);
