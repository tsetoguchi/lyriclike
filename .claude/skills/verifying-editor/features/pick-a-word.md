# Pick a word

A writer clicks a word in their lyrics and the rhyme panel shows rhymes for
it, which they can sort and click to see what each one means.

## Sub-features

- `pick-select` picks the word under the caret and highlights it.
- `pick-rhymes` shows grouped rhyme chips (Perfect first).
- `pick-sort` reorders chips: Closest, Popular, A–Z, Random.
- `pick-meaning` opens a chip's meaning; the lyrics do not change.

## How to get to it (user POV)

- Click a word in the lyrics (desktop) or tap it (phone).
- Use the sort button above the chips.
- Click a chip.

## Driving it with Playwright MCP

Preconditions:

- The three lines from `counts-and-scheme.md` are typed.
- `rhymeSort` unset (Closest).

- **Pick.** `pickWord(page, 'night')` (helper in `../SKILL.md`).
  `#selected-word` = `night`, `#selected-context` = the whole line.
- **Chips.** Perfect group open with 30 chips starting
  `right, might, quite, fight, light`. "night" is amber
  (`#lyrics-highlight .highlight-word`).
- **Sort.** Click `#rhyme-sort-btn`, then
  `#rhyme-sort-menu [data-order="alphabetical"]`. Chips start
  `alight, alright, bite`, and the menu closes.
- **Meaning.** Click a chip. `.def-popup` opens for "alight", and the
  line still says "night".
- **Proof.** Screenshot the open meaning to
  `.playwright-mcp/pick-a-word/`.
- **Reset.** Pick `[data-order="closest"]` to set the sort back.

## Gotchas

- A Playwright click can't aim at one word. Use `pickWord`.
- Words under 2 letters don't pick.
- The sort choice is saved in `localStorage.rhymeSort` and leaks into the
  next run.
