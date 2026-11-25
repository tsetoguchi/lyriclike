# Missing word

A visitor who types a rhyme URL for a word with no page gets a real "not
found" page, not the app.

## Sub-features

- `missing-404` answers status 404 with the not-found page.

## How to get to it (user POV)

- Type `/rhymes/<made-up word>/` into the address bar.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README.

- **Load.** `page.goto('/rhymes/zzqqx/')` answers 404.
- **Page.** Title "Page not found | LyricLike", h1 "Page not found". The
  editor does not load: the only scripts are analytics. The search box is
  there (see [word search](./word-search.md)).
- **Left out on purpose.** `/rhymes/sex/` gives the same 404: the word is
  in `tools/rhymes/page-excluded-words.json`.
- **Proof.** Screenshot to `.playwright-mcp/missing-word/404.png`.

## Gotchas

- The app showing instead means `404.html` is missing or moved.
- Words in the editor with no page are often left out on purpose: names,
  rare or crude words, or `tools/rhymes/page-excluded-words.json`.
