# Sample verse

A first-time visitor sees a sample song so the page isn't empty, with a
hint pointing at a word and rhymes already showing.

## Sub-features

- `sample-show` shows "Nobody Home" and "This is a sample verse.".
- `sample-pointer` shows the dashed "Click a word to explore rhymes" hint.
- `sample-rhymes` shows rhymes for "you" before any click.

## How to get to it (user POV)

- Open `lyriclike.com` for the first time (no saved draft).

## Driving it with Playwright MCP

Preconditions:

- Fresh first visit: `page.evaluate(() => localStorage.clear())`, then
  `page.goto('http://localhost:8788/')`.

- **Load.** The editor shows "Nobody Home" and "This is a sample verse.".
- **Pointer.** The dashed pointer text "Click a word to explore rhymes" is
  visible.
- **Rhymes.** `#selected-word` reads `you` and chips are showing.
- **Proof.** Screenshot to `.playwright-mcp/sample-verse/first-visit.png`.

## Gotchas

- Any saved `swag_draft` replaces the sample. Clear storage first.
- "Create page" while signed out opens the sign-up box, not a blank page.
