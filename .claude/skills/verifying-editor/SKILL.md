---
name: verifying-editor
description: Use when a change touches the LyricLike lyrics editor or rhyme panel - typing, syllable counts, rhyme scheme letters, internal rhyme marks, picking a word, rhyme chips, the sort menu, the sample verse, the page's title and buttons (Share, Invite), or the phone layout - and needs checking in a real browser before a PR
---

# Verifying the editor

## Overview

Drive the editor the way a writer does, at desktop and phone width, and
compare against the expected results below.

**REQUIRED:** follow `running-lyriclike-locally` to start the site and set
up the browser.


## Feature map

`features/README.md` lists every feature this guide covers, one file each:
how a user reaches it, how to drive it, and what proves it works. Use it to
cover every entry point, not just the handy one. Keep it in step with the
app.

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

Start signed out with `localStorage` and `sessionStorage` cleared.

1. **Sample verse.** First load shows the sample: "(This is a sample
   verse.)" as the first line, no count beside it, "Nobody Home" as the
   title placeholder, and rhymes for "you" already showing. The welcome
   tour opens over it. Press `Escape` to end the tour.
   `features/sample-verse.md` has the pointer hint, which only shows
   once the tour has been seen.
2. **Blank the page.** Click `#lyrics`, press `Control+A`, then `Delete`.
   Don't use "Create page" while signed out: it opens the sign-up box
   (`#auth-overlay`).
3. **Type** with `page.keyboard.type`:
   ```
   I walk alone into the night
   The city burns a silver light
   My heart is slow, my head is clear
   ```
   Expect the `#syllable-gutter .syl-line` rows to read `8, 8, 8` and the
   `#rhyme-scheme-gutter .scheme-line` rows `A, A, B`. Read the rows: the
   gutter's own `textContent` runs them together as `888`.
4. **Pick "night".** Expect `#selected-word` = `night`,
   `#selected-context` = the whole line, the Perfect group open with 30
   chips starting `right, might, quite, fight, light`, and "night" in amber
   (`#lyrics-highlight .highlight-word`).
5. **Sort menu.** `#rhyme-sort-btn` opens Closest, Popular, A–Z, Random
   (`#rhyme-sort-menu [data-order=...]`). A–Z reorders the chips to
   `alight, alright, bite...` and closes the menu. The choice is saved in
   `localStorage.rhymeSort`, so set it back to Closest afterwards.
6. **Rhyme meaning.** Click a chip. A `.def-popup` opens with the word's
   meaning, and the lyric does not change. Close it by clicking outside it
   (`.def-overlay`). `Escape` does not close it.
7. **Toggles.** `#syllable-toggle`, `#rhyme-scheme-toggle` and
   `#internal-rhyme-toggle` flip `aria-pressed`. Syllables and Rhyme Scheme
   start on, Internal Rhymes starts off. With internal rhymes on,
   `#lyrics-highlight` gains `.rhyme-mark` spans. The choices are kept in
   `sessionStorage`, so they survive a reload in the same tab.
8. **Draft saved.** `localStorage.swag_draft` is JSON. Its `body` holds the
   new text. After `page.goto` the text is still there.

## Run through (phone, 393×852)

1. `#mobile-tabs` shows Lyrics and Rhymes. `#rhymes-panel` is hidden.
2. `#bottom-nav` shows at the top of the Lyrics tab. Check it here: it
   slides off screen on the Rhymes tab and once the lyric scrolls.
3. Pick a word with `'touchend'`. The Rhymes tab label (`#tab-rhyme-word`)
   changes to that word, but the view stays on Lyrics. That is on purpose.
4. Click `#tab-rhyme-word`. The rhymes panel shows the first group open
   with 30 chips.
5. Swipes, the Highlights hold, the bar switches and the edge fades each
   have a recipe in `features/`. The test browser has no touch screen;
   `features/phone-gestures.md` has the helpers that fake one.

## Doubled buttons

After both run-throughs, run the doubled-button check from
`running-lyriclike-locally` at both widths, signed in and signed out, on a
long page at the top and after scrolling. `features/phone-page-head.md`
has the full phone recipe.

## Show the user

Screenshot both widths into `.playwright-mcp/` and look at them before
reporting. Put the ones that show the change in the PR.

## Common mistakes

| Symptom | Cause |
|---|---|
| Lyrics vanish but the text is there | The highlight layer draws every letter. A new code path that sets `#lyrics` must fire `input` or call `renderHighlight()` |
| Pick does nothing | Event fired before focus, or the word is under 2 letters |
| Hover tint never shows | The test browser has no hover. Not a bug by itself |
| Click hangs for 30s | A dialog (`.modal-overlay.open`) or a rhyme's meaning (`.def-overlay`) is covering the editor. `Escape` doesn't close the meaning; click outside it |
| Toggles start in the wrong state | An earlier run left them in `sessionStorage`. Clear it too |
| Chips in an odd order | An earlier run left `rhymeSort` set |

## Hand to the user

Ask for an iPhone check whenever the change touches the caret, selection,
typing, scrolling or the keyboard. Desktop Chrome can't reproduce those.
Name the exact steps, e.g. "tap 'night', then tap a rhyme; its meaning
opens and the caret stays where it was".
