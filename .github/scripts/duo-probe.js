// Goes into the app only in the iPhone Duo test build, never the shipped app.
// After each fold or turn it walks through the main screens, checks the layout
// of each, and logs "DUO|..." lines. duo-run.py reads them to know when to
// take a screenshot or tap the screen.
(() => {
  const SETTLE_MS = 4000;
  const STEP_MS = 1500;
  const SCENE_HOLD_MS = 3500;
  const FOCUS_WAIT_MS = 15000;
  const KEYBOARD_MS = 2000;
  const EDGE_SLACK_PX = 1;
  const MIN_TARGET_PX = 44;
  const INTERACTIVE = 'button, a[href], input, textarea, select, [role="tab"], '
    + '[contenteditable="true"]';

  let roundNumber = 0;
  let roundSize = '';
  let isRunning = false;
  let settleTimer = 0;

  function sizeKey() {
    return `${innerWidth}x${innerHeight}`;
  }

  function log(...parts) {
    console.log(['DUO', roundNumber, roundSize, ...parts].join('|'));
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function readInsets() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) '
      + 'env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const insets = {
      top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft),
    };
    probe.remove();
    return insets;
  }

  function isShown(el) {
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const x = Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit) && (hit === el || el.contains(hit));
  }

  function describe(el) {
    const name = el.id ? `#${el.id}` : el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    return `${name} "${label.slice(0, 24)}"`;
  }

  function findEdgeProblem(box, insets) {
    if (box.left < insets.left - EDGE_SLACK_PX) return 'left side bar or edge';
    if (box.right > innerWidth - insets.right + EDGE_SLACK_PX) return 'right side bar or edge';
    if (box.top < insets.top - EDGE_SLACK_PX) return 'top bar';
    return '';
  }

  // Links inside a sentence are as tall as the text, which is fine.
  function isSmallTarget(el, box) {
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
    return box.width < MIN_TARGET_PX && box.height < MIN_TARGET_PX;
  }

  function checkControls(scene, insets) {
    let failures = 0;
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!isShown(el)) continue;
      const box = el.getBoundingClientRect();
      const problem = findEdgeProblem(box, insets);
      if (problem) {
        failures += 1;
        log('check', 'FAIL', scene, `${describe(el)} is under the ${problem}`);
      }
      if (isSmallTarget(el, box)) {
        log('check', 'WARN', scene, `${describe(el)} is small (${Math.round(box.width)}x${Math.round(box.height)})`);
      }
    }
    return failures;
  }

  function checkSideScroll(scene) {
    const width = document.documentElement.scrollWidth;
    if (width <= innerWidth + EDGE_SLACK_PX) return 0;
    log('check', 'FAIL', scene, `page scrolls sideways (${width} wide in ${innerWidth})`);
    return 1;
  }

  function checkScene(scene) {
    const insets = readInsets();
    return checkControls(scene, insets) + checkSideScroll(scene);
  }

  function clickFirstShown(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isShown(el)) {
        el.click();
        return true;
      }
    }
    return false;
  }

  // The keyboard may shrink the page, so that scene allows a new size.
  async function showScene(name, allowsResize = false) {
    await wait(STEP_MS);
    if (!allowsResize && sizeKey() !== roundSize) throw new Error('size changed');
    const failures = checkScene(name);
    log('scene', name, failures);
    await wait(SCENE_HOLD_MS);
    return failures;
  }

  async function tryScene(name, openSelectors, closeSelectors, allowsResize = false) {
    if (!clickFirstShown(openSelectors)) {
      log('skip', name, 'nothing to open it with');
      return 0;
    }
    const failures = await showScene(name, allowsResize);
    document.activeElement?.blur();
    clickFirstShown(closeSelectors);
    await wait(STEP_MS);
    return failures;
  }

  function waitForFocus(el) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), FOCUS_WAIT_MS);
      el.addEventListener('focus', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
    });
  }

  async function keyboardScene() {
    // The sample verse sits over the editor, so the editor itself never wins the
    // hit test; a tap on the verse still lands in it.
    const editor = document.getElementById('lyrics');
    if (!editor || editor.getBoundingClientRect().height < 1) {
      log('skip', 'keyboard', 'editor not on screen');
      return 0;
    }
    const box = editor.getBoundingClientRect();
    const focused = waitForFocus(editor);
    log('tap', Math.round(box.left + box.width / 2), Math.round(box.top + 24));
    if (!(await focused)) {
      log('check', 'FAIL', 'keyboard', 'tapping the editor did not focus it');
      return 1;
    }
    await wait(KEYBOARD_MS);
    const failures = await showScene('keyboard', true);
    editor.blur();
    await wait(STEP_MS);
    return failures;
  }

  async function phoneTabScenes() {
    const failures = await tryScene('rhymes-tab',
      ['.mobile-tab[data-tab="rhymes"]'], ['.mobile-tab[data-tab="lyrics"]']);
    return failures;
  }

  // A round cut short by a fold can leave a popup or the keyboard open.
  async function clearScreen() {
    document.activeElement?.blur();
    clickFirstShown(['#auth-close', '#sidebar-close-btn', '.modal-overlay.open .modal-close']);
    await wait(STEP_MS);
  }

  async function walkScenes() {
    await clearScreen();
    let failures = await showScene('start');
    clickFirstShown(['#coach-skip']);
    failures += await showScene('page');
    failures += await phoneTabScenes();
    failures += await tryScene('notebook',
      ['#notebook-btn', '#rail-open-btn'], ['#sidebar-close-btn', '#sidebar-scrim']);
    failures += await tryScene('highlights', ['#rhymes-menu-btn'], ['#rhymes-menu-btn']);
    // Log in puts the cursor in the email field, so the keyboard may open.
    failures += await tryScene('log-in', ['#sign-in-btn'], ['#auth-close'], true);
    failures += await keyboardScene();
    return failures;
  }

  async function runRound() {
    isRunning = true;
    roundNumber += 1;
    roundSize = sizeKey();
    const insets = readInsets();
    log('round-start', `insets ${insets.top},${insets.right},${insets.bottom},${insets.left}`);
    try {
      log('round-done', await walkScenes());
    } catch (error) {
      log('round-abort', error.message);
    }
    isRunning = false;
    if (sizeKey() !== roundSize) scheduleRound();
  }

  function scheduleRound() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (!isRunning && sizeKey() !== roundSize) runRound();
    }, SETTLE_MS);
  }

  addEventListener('resize', scheduleRound);
  addEventListener('load', scheduleRound);
})();
