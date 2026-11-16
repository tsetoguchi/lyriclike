# Pick a word

A writer clicks a word in their lyrics and the rhyme panel shows rhymes for
it, which they can sort and click to swap into the line.

## Sub-features

- `pick-select` picks the word under the caret and highlights it.
- `pick-rhymes` shows grouped rhyme chips (Perfect first).
- `pick-sort` reorders chips: Closest, Popular, A–Z, Random.
- `pick-swap` replaces the picked word with a chip, keeping its capitals.

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
- **Swap.** Click a chip. "Night" becomes "Alight" in the line.
- **Proof.** Screenshot before and after the swap to
  `.playwright-mcp/pick-a-word/`.
- **Reset.** Pick `[data-order="closest"]` to set the sort back.

## Gotchas

- A Playwright click can't aim at one word. Use `pickWord`.
- Words under 2 letters don't pick.
- The sort choice is saved in `localStorage.rhymeSort` and leaks into the
  next run.
