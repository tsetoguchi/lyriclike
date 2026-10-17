---
name: verifying-editor
description: Use when a change touches the LyricLike lyrics editor or rhyme panel - typing, syllable counts, rhyme scheme letters, internal rhyme marks, picking a word, rhyme chips, the sort menu, the sample verse, or the phone layout - and needs checking in a real browser before a PR
---

# Verifying the editor

## Overview

Drive the editor the way a writer does, at desktop and phone width, and
compare against the expected results below.

**REQUIRED:** follow `running-lyriclike-locally` to start the site and set
up the browser.

## Pick a word

A word is picked on `mouseup` (desktop) or `touchend` (phone). A Playwright
click on the textarea can't aim at one word, so place the caret and fire the
event:

```js
async function pickWord(page, word, eventType = 'mouseup') {
  await page.evaluate(([w, type]) => {
    const ta = document.getElementById('lyrics');
    const i = ta.value.indexOf(w) + 1;
    ta.focus();
    ta.setSelectionRange(i, i);
    const Event = type === 'touchend' ? TouchEvent : MouseEvent;
    ta.dispatchEvent(new Event(type, { bubbles: true }));
  }, [word, eventType]);
  await page.waitForTimeout(800); // 150ms debounce, plus the dictionary on first pick
}
```

## Run through (desktop, 1440×900)

Start signed out with `localStorage` cleared.

1. **Sample verse.** First load shows "Nobody Home" with "This is a sample
   verse.", the dashed "Click a word to explore rhymes" pointer, and rhymes
   for "you" already showing.
2. **Blank the page.** Click `#lyrics`, press `Control+A`, then `Delete`.
   Don't use "Create page" while signed out: it opens the sign-up box
   (`#auth-overlay`).
3. **Type** with `page.keyboard.type`:
   ```
   I walk alone into the night
   The city burns a silver light
   My heart is slow, my head is clear
   ```
   Expect `#syllable-gutter` to read `8 8 8` and `#rhyme-scheme-gutter`
   `A A B`.
4. **Pick "night".** Expect `#selected-word` = `night`,
   `#selected-context` = the whole line, the Perfect group open with 30
   chips starting `right, might, quite, fight, light`, and "night" in amber
   (`#lyrics-highlight .highlight-word`).
5. **Sort menu.** `#rhyme-sort-btn` opens Closest, Popular, A–Z, Random
   (`#rhyme-sort-menu [data-order=...]`). A–Z reorders the chips to
   `alight, alright, bite...` and closes the menu. The choice is saved in
   `localStorage.rhymeSort`, so set it back to Closest afterwards.
6. **Swap a chip.** Click a chip. The picked word in the line becomes that
   chip with the same capitals: "Night" becomes "Alight".
7. **Toggles.** `#syllable-toggle`, `#rhyme-scheme-toggle` and
   `#internal-rhyme-toggle` flip `aria-pressed`. With internal rhymes on,
   `#lyrics-highlight` gains `.rhyme-mark` spans.
8. **Draft saved.** `localStorage.swag_draft` holds the new text. After
   `page.goto` the text is still there.

## Run through (phone, 393×852)

1. `#mobile-tabs` shows Lyrics and Rhymes. `#rhymes-panel` is hidden.
2. Pick a word with `'touchend'`. The Rhymes tab label (`#tab-rhyme-word`)
   changes to that word, but the view stays on Lyrics. That is on purpose.
3. Click `#tab-rhyme-word`. The rhymes panel shows 30 chips.
4. `#bottom-nav` is visible.

## Show the user

Screenshot both widths into `.playwright-mcp/` and look at them before
reporting. Put the ones that show the change in the PR.

## Common mistakes

| Symptom | Cause |
|---|---|
| Lyrics vanish but the text is there | The highlight layer draws every letter. A new code path that sets `#lyrics` must fire `input` or call `renderHighlight()` |
| Pick does nothing | Event fired before focus, or the word is under 2 letters |
| Hover tint never shows | The test browser has no hover. Not a bug by itself |
| Click hangs for 30s | A dialog (`.modal-overlay.open`) is covering the editor |
| Chips in an odd order | An earlier run left `rhymeSort` set |

## Hand to the user

Ask for an iPhone check whenever the change touches the caret, selection,
typing, scrolling or the keyboard. Desktop Chrome can't reproduce those.
Name the exact steps, e.g. "tap 'night', then tap a rhyme; the caret should
stay after the new word".
