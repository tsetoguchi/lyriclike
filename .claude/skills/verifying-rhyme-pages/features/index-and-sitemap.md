# Index and sitemap

A visitor can browse every rhyme page from one index, and search engines
find every page through the sitemap.

## Sub-features

- `index-list` links every word page from `/rhymes/`.
- `sitemap-all` lists every page plus the home page.

## How to get to it (user POV)

- Open `/rhymes/`. Search engines read `/sitemap.xml`.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README.

- **Index.** `page.goto('/rhymes/')` answers 200, heading "Rhyming
  Dictionary for Songwriters", linking every page.
- **Sitemap.** `/sitemap.xml` answers 200 with one `<loc>` per page plus
  the home page (5,003 today).
- **Proof.** Screenshot the index to
  `.playwright-mcp/index-and-sitemap/index.png` and save the `<loc>` count.

## Gotchas

- A sitemap page that 404s on the live site usually means a `.gitignore`
  rule hides its folder. `test/sitemap-pages.test.mjs` catches it.
