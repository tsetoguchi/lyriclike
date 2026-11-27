// The small taps the phone plays in the iOS and Android apps. They mark a
// physical moment only: a drag crossing the line where letting go would
// commit, a held press opening its menu, a switch flipping, a share landing
// or failing. Everything else stays silent, so these keep their meaning.
//
// The moments map to the system's own feedback (@capacitor/haptics):
//   tap      light impact            a switch flipping
//   snap     medium impact           a held press opening its menu
//   tick     selection changed       crossing a drag's line, sliding onto an item
//   success  notification success    a share that landed
//   error    notification error      a share or remove that failed
// There is no switch in the app: the phone's own setting (System Haptics on
// iPhone) silences all of them, as it does for other apps. On the website,
// and wherever the plugin is missing, every call does nothing. No call ever
// throws.
(function defineHaptics(root) {
  'use strict';

  // A plugin call answers with a promise; a refused one must not surface as
  // an unhandled rejection, and a missing method must not throw.
  function quietly(call) {
    try {
      const result = call();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (error) {
      // A tap that can't play is not worth a broken gesture.
    }
  }

  // plugin: Capacitor's Haptics, or null for none.
  function createHaptics({ plugin }) {
    // Selection feedback runs inside a start/end pair; the start readies the
    // generator, so a tick in the middle of a drag plays without delay.
    let isSelecting = false;

    function play(call) {
      if (plugin) quietly(call);
    }

    function startTicks() {
      if (isSelecting) return;
      isSelecting = true;
      play(() => plugin.selectionStart());
    }

    function endTicks() {
      if (!isSelecting) return;
      isSelecting = false;
      play(() => plugin.selectionEnd());
    }

    function tick() {
      if (!isSelecting) startTicks();
      play(() => plugin.selectionChanged());
    }

    return {
      isAvailable: Boolean(plugin),
      tap: () => play(() => plugin.impact({ style: 'LIGHT' })),
      snap: () => play(() => plugin.impact({ style: 'MEDIUM' })),
      tick,
      startTicks,
      endTicks,
      success: () => play(() => plugin.notification({ type: 'SUCCESS' })),
      error: () => play(() => plugin.notification({ type: 'ERROR' })),
    };
  }

  function isNativeApp() {
    const { Capacitor } = globalThis;
    return Boolean(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  }

  function nativePlugin() {
    try {
      const plugins = globalThis.Capacitor.Plugins || {};
      return plugins.Haptics || null;
    } catch (error) {
      return null;
    }
  }

  const Haptics = { createHaptics };
  if (typeof module === 'object' && module.exports) {
    module.exports = Haptics;
    return;
  }

  root.AppHaptics = createHaptics({ plugin: isNativeApp() ? nativePlugin() : null });
})(this);
