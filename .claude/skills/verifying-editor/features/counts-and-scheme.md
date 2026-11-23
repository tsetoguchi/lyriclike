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
  internal rhymes. On a phone, Syllables is in the bottom bar and the
  other two are in its Highlights menu.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README. Blank the page: click `#lyrics`,
  `Control+A`, `Delete`.

- **Type.** `page.keyboard.type` the three lines from `../SKILL.md`
  ("I walk alone into the night" ...).
- **Counts.** The `#syllable-gutter .syl-line` rows read `8, 8, 8`.
- **Scheme.** The `#rhyme-scheme-gutter .scheme-line` rows read `A, A, B`.
- **Toggles.** They start Syllables on, Rhyme Scheme on, Internal Rhymes
  off. Click `#syllable-toggle`, `#rhyme-scheme-toggle`,
  `#internal-rhyme-toggle`. Each flips `aria-pressed`, and
  `sessionStorage` holds `syllablesVisible`, `rhymeSchemeVisible` and
  `internalRhymesVisible` (`'0'` or `'1'`).
- **Internal marks.** With internal rhymes on, `#lyrics-highlight` has
  `.rhyme-mark` spans (4 for the three lines).
- **Proof.** Screenshot to `.playwright-mcp/counts-and-scheme/typed.png`.

## Gotchas

- Text set without an `input` event leaves the highlight layer stale, so
  the lyrics look blank. Type with the keyboard.
- The gutter's `textContent` runs the rows together (`888`). Read the rows.
- The scheme gutter stays empty until the dictionary loads. Wait about
  1.5s after typing.
- The toggles survive a reload in the same tab. Clear `sessionStorage`
  before a run.
