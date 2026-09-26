# LyricLike

A tool for writing song lyrics — syllable counts per line, rhyme-scheme
detection, and a rhyme finder built on the CMU Pronouncing Dictionary's
phoneme data instead of spelling.

This repo is public mainly so I have a record of how the app actually got
built.

## What it does

- Counts syllables per line as you type
- Detects and labels rhyme scheme (A/B/C...) across the lyric
- Marks internal rhymes: words inside lines that rhyme with each other
- Finds rhymes by phoneme match, including near-rhymes, not just exact spelling.
  Common words come first; names, rare words and crude words come last
- Optional accounts (Google, or email and password) to save pages and sync them
  across devices

## Stack

- Frontend: plain HTML/CSS/JS, no build step
- Backend: Cloudflare Pages Functions
- Database: Cloudflare D1 (SQLite) for accounts and saved pages
- Auth: Google OAuth, plus email and password
- Email: Resend, for sign-up confirmation and password reset links
- Bot checks: Cloudflare Turnstile on the password forms

## Running it locally

You'll need [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
and a Cloudflare account.

```
npm install -g wrangler
wrangler d1 migrations apply lyricalmiracle_db --local
wrangler pages dev .
```

Create a `.dev.vars` file in the project root first:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_REDIRECT_URL=http://localhost:8788/api/auth/google/callback
```

Get those from a Google Cloud OAuth client (type "Web") with that redirect
URI added.

Email and password accounts are off unless you also set these:

```
PASSWORD_AUTH_ENABLED=true
PASSWORD_PEPPER=32-or-more-random-bytes-base64
APP_BASE_URL=http://localhost:8788
TURNSTILE_SECRET_KEY=your-turnstile-secret
RESEND_API_KEY=your-resend-key
EMAIL_FROM=LyricLike <noreply@your-domain>
```

`PASSWORD_AUTH_ENABLED` is the kill switch: leave it unset and only Google
sign-in shows. Every emailed link is built from `APP_BASE_URL`. The public
Turnstile site key lives in `wrangler.toml`.

Preview deploys use their own database, `lyricalmiracle-db-preview`, so a
branch never touches real accounts.

## Rhyme pages

`/rhymes/` holds static "words that rhyme with X" pages for search engines,
generated from the same rhyme logic as the editor. They are committed, since
the site has no build step. To regenerate:

```
node tools/rhymes/collect-popular-words.mjs   # rarely: re-rank popular searches
node tools/rhymes/build-pages.mjs             # rewrite /rhymes/ and sitemap.xml
```

The editor and the pages share one copy of the rhyme logic, `rhyme-core.js`.
Pages leave out names, rare words and crude words; the editor lists them last.

## Word lists

All at the repo root, all plain JSON arrays:

- `cmudict.json`: pronunciations, from the CMU Pronouncing Dictionary
- `english-words.json`: words rhyme results may list, commonest first. Its order
  is the frequency ranking
- `name-words.json`: words English only spells with a capital ("wayne"), listed
  last. Rebuild with `node tools/build-name-words.mjs`
- `crude-words.json`: swear and sex words, listed last and never on a rhyme page
- `blocklist.json`: slurs. Never listed, and typing one looks nothing up

## Tests

The rhyme logic and the API's access checks have tests. They need Node 22 or later and nothing installed:

```
node --test "test/*.test.mjs"
```

GitHub Actions runs them on every pull request.

## License

MIT — see [LICENSE](LICENSE). The bundled CMU Pronouncing Dictionary carries
its own license; see [NOTICE](NOTICE).
