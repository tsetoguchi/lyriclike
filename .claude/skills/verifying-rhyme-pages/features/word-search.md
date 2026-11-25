# Word search

A visitor on a rhyme page who wants another word types it in the "Find
rhymes" box. The editor opens on that word, since every word has rhymes
there, even ones with no page.

## Sub-features

- `search-open` sends the typed word to the editor as `/?rhymes=<word>`.
- `search-check` blocks anything but one word of letters.

## How to get to it (user POV)

- The box sits at the top of every word page, the index `/rhymes/` and the
  404 page.

## Driving it with Playwright MCP

Preconditions:

- Baseline and clean start from the README.

- **Open.** On `/rhymes/night/` at 1440, fill
  `form.word-search input[name=rhymes]` with " Ocean " and click the "Find
  rhymes" button. The editor opens at `/` with "ocean" on the page (trimmed,
  lower case), selected 0 to 5, and ocean's rhymes in the panel.
- **Check.** Fill "two words" and submit. The browser blocks it and the
  address stays on the word page.
- **From the 404.** On `/rhymes/zzqqx/`, search "river". The editor opens
  with river's rhymes in the panel. A draft already there is kept.
- **Proof.** Screenshot to `.playwright-mcp/word-search/`.

## Gotchas

- The box is a plain form with no script. The editor does the work: see
  `takeLinkedWord` and `openOnLinkedWord` in `storage.js`.
- Its button has class `cta-button`, like the editor links. Select by
  `form.word-search button`, not `.cta-button`.
- Same keep-the-draft rule as the word page: a second search in a dirty
  browser shows the old text on the page. Start clean.
