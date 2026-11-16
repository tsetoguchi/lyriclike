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
  `/?rhymes=night`. Follow one: the editor has "night" on the page, picked,
  rhymes showing, and the address returns to `/`.
- **Phone.** At 393px, `document.documentElement.scrollWidth` is at most
  `innerWidth`.
- **Proof.** Screenshots at both widths to `.playwright-mcp/word-page/`.

## Gotchas

- A returning draft is kept as it was when following the editor link.
- With `localStorage` cleared, a "Rhymes for ..." tour card opens over the
  editor. Close it before clicking anything under it.
- Counts change when the dictionary or generator changes. Update the
  numbers here when they do.
