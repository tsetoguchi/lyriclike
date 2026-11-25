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
// The phone's own setting (System Haptics on iPhone) silences all of them,
// and the account menu's Haptics switch silences them in this app alone.
// On the website, and wherever the plugin is missing, every call does
// nothing. No call ever throws.
(function defineHaptics(root) {
  'use strict';

  const SETTING_KEY = 'haptics_on';
  const OFF_VALUE = '0';
  const ON_VALUE = '1';
  const ON_LABEL = 'On';
  const OFF_LABEL = 'Off';
  const TOGGLE_ID = 'haptics-toggle-btn';
  const STATE_ID = 'haptics-state';

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

  // plugin: Capacitor's Haptics, or null for none. preferences: Capacitor's
  // Preferences, or null to keep the setting for this run only.
  function createHaptics({ plugin, preferences }) {
    let isOn = true;
    // Selection feedback runs inside a start/end pair; the start readies the
    // generator, so a tick in the middle of a drag plays without delay.
    let isSelecting = false;

    function play(call) {
      if (plugin && isOn) quietly(call);
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

    function setOn(value) {
      isOn = Boolean(value);
      if (!isOn) isSelecting = false;
      if (preferences) {
        quietly(() => preferences.set({ key: SETTING_KEY, value: isOn ? ON_VALUE : OFF_VALUE }));
      }
    }

    // Never rejects: an unreadable setting leaves haptics on.
    async function loadSetting() {
      if (!preferences) return isOn;
      try {
        const stored = await preferences.get({ key: SETTING_KEY });
        if (stored && stored.value === OFF_VALUE) isOn = false;
      } catch (error) {
        // Keep the default.
      }
      return isOn;
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
      isOn: () => isOn,
      setOn,
      ready: loadSetting(),
    };
  }

  function isNativeApp() {
    const { Capacitor } = globalThis;
    return Boolean(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  }

  function nativePlugins() {
    try {
      const plugins = globalThis.Capacitor.Plugins || {};
      return { plugin: plugins.Haptics || null, preferences: plugins.Preferences || null };
    } catch (error) {
      return { plugin: null, preferences: null };
    }
  }

  // The account menu's switch, shown only where there is something to switch.
  function wireToggle(haptics, document) {
    const button = document.getElementById(TOGGLE_ID);
    const stateLabel = document.getElementById(STATE_ID);
    if (!button || !stateLabel) return;
    function showState() {
      button.setAttribute('aria-checked', String(haptics.isOn()));
      stateLabel.textContent = haptics.isOn() ? ON_LABEL : OFF_LABEL;
    }
    button.hidden = false;
    haptics.ready.then(showState);
    showState();
    button.addEventListener('click', () => {
      haptics.setOn(!haptics.isOn());
      showState();
      // Turning it on plays the tap it brings back.
      haptics.tap();
    });
  }

  const Haptics = { createHaptics };
  if (typeof module === 'object' && module.exports) {
    module.exports = Haptics;
    return;
  }

  const haptics = createHaptics(isNativeApp() ? nativePlugins() : { plugin: null, preferences: null });
  root.AppHaptics = haptics;
  if (!haptics.isAvailable) return;
  const { document } = globalThis;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireToggle(haptics, document));
  } else {
    wireToggle(haptics, document);
  }
})(this);
