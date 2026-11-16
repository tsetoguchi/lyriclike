# Counts and scheme

As a writer types, each line gets a syllable count and a rhyme scheme
letter, and internal rhymes can be marked inside lines.

## Sub-features

- `count-syllables` fills `#syllable-gutter` per line.
- `count-scheme` fills `#rhyme-scheme-gutter` with letters.
- `count-internal` marks internal rhymes with `.rhyme-mark` spans.
- `count-toggles` turns each layer on and off.

## How to get to it (user POV)

- Type lyrics in the editor.
- Use the three toggle buttons in the toolbar: syllables, rhyme scheme,
  internal rhymes.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README. Blank the page: click `#lyrics`,
  `Control+A`, `Delete`.

- **Type.** `page.keyboard.type` the three lines from `../SKILL.md`
  ("I walk alone into the night" ...).
- **Counts.** `#syllable-gutter` reads `8 8 8`.
- **Scheme.** `#rhyme-scheme-gutter` reads `A A B`.
- **Toggles.** Click `#syllable-toggle`, `#rhyme-scheme-toggle`,
  `#internal-rhyme-toggle`. Each flips `aria-pressed`.
- **Internal marks.** With internal rhymes on, `#lyrics-highlight` has
  `.rhyme-mark` spans.
- **Proof.** Screenshot to `.playwright-mcp/counts-and-scheme/typed.png`.

## Gotchas

- Text set without an `input` event leaves the highlight layer stale, so
  the lyrics look blank. Type with the keyboard.
