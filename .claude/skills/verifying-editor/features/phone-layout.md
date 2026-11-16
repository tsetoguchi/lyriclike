# Phone layout

On a phone the editor and rhymes are two tabs. Picking a word updates the
Rhymes tab label but keeps the writer on their lyrics.

## Sub-features

- `phone-tabs` shows Lyrics and Rhymes tabs; rhymes hidden at first.
- `phone-pick` puts the picked word on the Rhymes tab label.
- `phone-rhymes` opens the rhymes view from the tab.
- `phone-nav` shows the bottom nav.

## How to get to it (user POV)

- Open the site on a phone. Tap a word. Tap the Rhymes tab.

## Driving it with Playwright MCP

Preconditions:

- `page.setViewportSize({ width: 393, height: 852 })`, then check
  `innerWidth` is 393.

- **Tabs.** `#mobile-tabs` is visible. `#rhymes-panel` is hidden.
- **Pick.** `pickWord(page, 'night', 'touchend')`. `#tab-rhyme-word` reads
  `night`. The view stays on Lyrics, on purpose.
- **Open rhymes.** Click `#tab-rhyme-word`. The panel shows 30 chips.
- **Nav.** `#bottom-nav` is visible.
- **Proof.** Screenshots to `.playwright-mcp/phone-layout/`.

## Gotchas

- `innerWidth` sometimes reports the old width after a resize. Measure at
  the width you meant.
- Caret, keyboard and scroll behaviour on iPhone can't be checked here. Ask
  the user.
