# Word page

A visitor from search lands on `/rhymes/<word>/`, sees grouped rhymes for
that word, and can jump into the editor with the word ready.

## Sub-features

- `word-seo` has the right title, description, canonical and JSON-LD.
- `word-content` shows the heading, pronunciation, meaning and groups.
- `word-to-editor` opens the editor with the word picked.
- `word-phone` has no sideways scroll at 393px.

## How to get to it (user POV)

- Search "words that rhyme with night" and click the result.
- Click a word on `/rhymes/`.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README.

- **Load.** `page.goto('/rhymes/night/')` answers 200. Title "Words That
  Rhyme With Night | LyricLike".
- **Tags.** Meta description under 160 characters, starting "What rhymes
  with night? Right, might, quite and fight." Canonical
  `https://lyriclike.com/rhymes/night/`. One JSON-LD block of `@type`
  BreadcrumbList that parses.
- **Content.** h1 "Words that rhyme with night", pronunciation `/naɪt/`,
  "What night means", groups Perfect (72), Family, Additive, Subtractive,
  Assonance, Consonance.
- **To editor.** Two "Write with these rhymes" links go to
  `/?rhymes=night`. From a clean start (README), follow one at 1440: the
  editor has "night" on the page, selected 0 to 5, night's rhymes in the
  panel, and the address returns to `/`. The tour card opens too.
- **Draft kept.** Type a line into the editor at `/`, then follow the link
  again: the line stays, nothing is added, and night's rhymes show beside
  it.
- **Phone.** At 393px, `document.documentElement.scrollWidth` is at most
  `innerWidth`.
- **Proof.** Screenshots at both widths to `.playwright-mcp/word-page/`.

## Gotchas

- Any text already on the page is kept, including the word a past visit to
  the link put there. So a second test in the same browser shows the old
  word, not the new one. Start clean between tests.
- Don't fake a draft with `localStorage.setItem('swag_draft', ...)`. A page
  saved earlier wins over it. Type the draft in the editor instead.
- On a first visit, a `Rhymes for "night"` tour card opens over the editor.
  Close it before clicking anything under it.
- At 393 the word is not selected and the pad is not focused, so no
  keyboard pops up. That is on purpose (`openOnLinkedWord` in
  `storage.js`). The rhymes sit behind the Rhymes tab. Check selection at
  1440 only.
- The page has more editor links: "See them all in the editor" under each
  group. Match the exact text "Write with these rhymes".
- Counts change when the dictionary or generator changes. Update the
  numbers here when they do.
