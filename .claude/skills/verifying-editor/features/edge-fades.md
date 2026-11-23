# Edge fades

The lyrics fade at an edge only while some of the page is hidden past it.
The bottom fades while there is more below. The top fades once the page is
scrolled down, and goes sharp again back at the top.

## Sub-features

- `fade-none` a short page has sharp top and bottom edges.
- `fade-below` a long page at the top fades only its bottom.
- `fade-both` scrolled into the middle, both edges fade.
- `fade-end` scrolled to the end, only the top fades.

## How to get to it (user POV)

- Write or paste a song longer than the screen, then scroll it.

## Driving it with Playwright MCP

Preconditions:

- Desktop or phone width. Welcome tour closed on phone.

Fill the page and read the edges:

```js
await page.evaluate(() => {
  const ta = document.getElementById('lyrics');
  ta.value = Array.from({ length: 80 }, (_, i) => 'Line number ' + i + ' of the song').join('\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
const edges = () => page.evaluate(() => {
  const a = document.querySelector('.lyrics-area');
  return { top: a.scrollTop, above: a.classList.contains('has-more-above'),
    below: a.classList.contains('has-more-below') };
});
```

Scroll with `document.querySelector('.lyrics-area').scrollTop = <px>`, then
wait 500ms.

- **Short page.** One line of text: `above` and `below` are both `false`.
- **Long page, top.** `above` `false`, `below` `true`.
- **Middle.** `scrollTop = 400`: both `true`. The mask
  (`getComputedStyle(area).maskImage`) runs transparent, black at 48px,
  black at `100% - 48px`, transparent.
- **End.** `scrollTop = 99999`: `above` `true`, `below` `false`.
- **Back up.** `scrollTop = 0`: `above` is `false` again.
- **Proof.** A screenshot of the top 300px while scrolled, showing the
  first line faded, to `.playwright-mcp/edge-fades/`.

## Gotchas

- Setting `value` without firing `input` leaves the page height stale, so
  the bottom edge reads wrong.
- The fades ease in over the base duration. Read the classes, not a
  screenshot taken mid-ease.
