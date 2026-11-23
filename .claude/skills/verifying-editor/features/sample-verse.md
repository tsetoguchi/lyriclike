# Sample verse

A first-time visitor sees a sample song so the page isn't empty, with
rhymes already showing. The welcome tour opens over it. A hint pointing at
a word shows instead of the tour once the tour has been seen.

## Sub-features

- `sample-show` shows "Nobody Home" as the title placeholder and the first
  line "(This is a sample verse.)", with no count beside it.
- `sample-tour` opens the welcome tour on a true first visit.
- `sample-pointer` shows the "Click a word to explore rhymes" hint, with a
  dashed arrow, when the tour has been seen but the hint hasn't.
- `sample-rhymes` shows rhymes for "you" before any click.
- `sample-clear` "Start your own" (`#sample-clear`) ends the sample.

## How to get to it (user POV)

- Open `lyriclike.com` for the first time (no saved draft).

## Driving it with Playwright MCP

Preconditions:

- Fresh first visit: `page.evaluate(() => localStorage.clear())`, then
  `page.goto('http://localhost:8788/')`. Wait about 2.5s for the
  dictionary and the tour.

- **Load.** `#lyrics` holds 5 lines starting "(This is a sample verse.)".
  The title is empty text with
  `#lyrics-panel-title.dataset.placeholder === 'Nobody Home'`. Beside line
  1, the syllable row is blank and the scheme row is a dash (`–`); the
  other lines read `8 8 8 8` and `A B A B`. `#sample-clear` shows
  "Start your own". `localStorage.swag_draft` is still null: the sample is
  never saved.
- **Tour.** `window.isCoachTourOpen()` is `true` and `#sample-pointer`
  lacks `.is-shown`. `Escape` ends the tour and sets
  `localStorage.tour_seen`.
- **Pointer.** Clear storage, set `localStorage.tour_seen = '1'`, reload.
  No tour, `#sample-pointer` has `.is-shown`, and `.sample-pointer-tip`
  reads "Click a word to explore rhymes".
- **Rhymes.** `#selected-word` reads `you` and 30 chips are showing.
- **Proof.** Screenshot to `.playwright-mcp/sample-verse/first-visit.png`.

## Gotchas

- Any saved `swag_draft`, or `sample_seen`, stops the sample. Clear all of
  `localStorage` first, not just the draft.
- The tour and the pointer never show together. A fresh clear always gets
  the tour.
- "Create page" while signed out opens the sign-up box, not a blank page.
