# Index and sitemap

A visitor can browse every rhyme page from one index, and search engines
find every page through the sitemap.

## Sub-features

- `index-featured` lists the most searched words first, under "Rhymes
  people search for".
- `index-list` links every word page from `/rhymes/`, A to Z.
- `sitemap-all` lists every word page plus the site's other pages.

## How to get to it (user POV)

- Open `/rhymes/`, or click "Rhyming dictionary" on any word page. Search
  engines read `/sitemap.xml`.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README.

- **Index.** `page.goto('/rhymes/')` answers 200. Title "Rhyming Dictionary
  for Songwriters | LyricLike", h1 "Rhyming dictionary". The first h2 is
  "Rhymes people search for" with 92 links, then A to Z. The distinct
  `/rhymes/<word>/` links number 5,000, one per page folder.
- **Sitemap.** `/sitemap.xml` answers 200 with 5,010 `<loc>`: 5,000 word
  pages, plus home, `/rhymes/`, `/guide/`, the four `*-alternative/`
  comparison pages, `/privacy/`, `/delete-account/`, and one page with no
  trailing slash that another worker serves (`PLANS_PATH` in
  `tools/rhymes/render-html.mjs`).
- **Proof.** Screenshot the index to
  `.playwright-mcp/index-and-sitemap/index.png` and save the `<loc>` count.

## Gotchas

- The title says "Rhyming Dictionary for Songwriters". The h1 only says
  "Rhyming dictionary".
- A sitemap page that 404s on the live site usually means a `.gitignore`
  rule hides its folder. `test/sitemap-pages.test.mjs` catches it.
- Hand-written pages live in `HAND_WRITTEN_PATHS` in
  `tools/rhymes/render-html.mjs`. A new one changes the count here.
