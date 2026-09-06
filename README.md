# LyricLike

A tool for writing song lyrics — syllable counts per line, rhyme-scheme
detection, and a rhyme finder built on the CMU Pronouncing Dictionary's
phoneme data instead of spelling.

This repo is public mainly so I have a record of how the app actually got
built.

## What it does

- Counts syllables per line as you type
- Detects and labels rhyme scheme (A/B/C...) across the lyric
- Finds rhymes by phoneme match, including near-rhymes, not just exact spelling
- Optional Google sign-in to save lyrics and sync them across devices

## Stack

- Frontend: plain HTML/CSS/JS, no build step
- Backend: Cloudflare Pages Functions
- Database: Cloudflare D1 (SQLite) for accounts and saved lyrics
- Auth: Google OAuth

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

## License

MIT — see [LICENSE](LICENSE). The bundled CMU Pronouncing Dictionary carries
its own license; see [NOTICE](NOTICE).
