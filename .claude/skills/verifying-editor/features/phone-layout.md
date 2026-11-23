# Phone layout

On a phone the editor and rhymes are two tabs. Picking a word updates the
Rhymes tab label but keeps the writer on their lyrics.

## Sub-features

- `phone-tabs` shows Lyrics and Rhymes tabs; rhymes hidden at first.
- `phone-pick` puts the picked word on the Rhymes tab label.
- `phone-rhymes` opens the rhymes view from the tab.
- `phone-nav` shows the bottom bar on Lyrics: Syllables, Highlights,
  Notebook, Create. Rhyme Scheme and Internal Rhymes sit in the
  Highlights menu.

## How to get to it (user POV)

- Open the site on a phone. Tap a word. Tap the Rhymes tab.

## Driving it with Playwright MCP

Preconditions:

- `page.setViewportSize({ width: 393, height: 852 })`, then check
  `innerWidth` is 393.

- **Tabs.** `#mobile-tabs` shows "Lyrics" and "Rhymes". `.main` has
  `show-lyrics` and `#rhymes-panel` is `display: none`.
- **Nav.** Before leaving Lyrics: `#bottom-nav` has opacity 1 and no
  `ducked` or `off-screen` class. Its children are `#syllable-toggle`,
  `#rhymes-menu`, `#notebook-btn`, `#create-btn`.
- **Pick.** `pickWord(page, 'night', 'touchend')`. `#tab-rhyme-word` reads
  `night`. The view stays on Lyrics, on purpose.
- **Open rhymes.** Click `#tab-rhyme-word`. `.main` has `show-rhymes` and
  the first group shows 30 chips. `#bottom-nav` has `off-screen`.
- **Back.** Click `.mobile-tab[data-tab="lyrics"]`. The bar is back.
- **Proof.** Screenshots to `.playwright-mcp/phone-layout/`.

## Gotchas

- `innerWidth` sometimes reports the old width after a resize. Measure at
  the width you meant.
- Phone layout is anything 768px wide or less.
- The bar leaves on the Rhymes tab and ducks once the lyric scrolls. A
  visibility check can still pass at opacity 0; read the class.
- Caret, keyboard and scroll behaviour on iPhone can't be checked here. Ask
  the user.
