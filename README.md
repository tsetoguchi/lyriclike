# LyricLike

LyricLike is a tool I built for writing song lyrics. It counts the syllables in
each line, labels the rhyme scheme, and finds rhymes based on how words sound
(phonemes from the CMU Pronouncing Dictionary) rather than how they are spelled.

I made this repo public mainly so I have a record of how the app actually got
built.

## What it does

As you type, it counts the syllables in each line and labels the rhyme scheme
(A/B/C, etc). It also marks internal rhymes, which are words inside a line that
rhyme with each other.

When you click a word, it finds rhymes by matching sounds, so near-rhymes show
up too and not just words with the same ending. Common words come first. Names,
rare words and crude words come last.

Accounts are optional. You can sign in with Google, or with an email and
password, to save your pages and sync them across devices.

## Stack

- Frontend: plain HTML/CSS/JS, no build step
- Backend: Cloudflare Pages Functions
- Database: Cloudflare D1 (SQLite) for accounts and saved pages
- Auth: Google OAuth, plus email and password
- Email: Resend, for sign-up confirmation and password reset links
- Bot checks: Cloudflare Turnstile on the password forms

## Running it locally

You'll need Node, a Cloudflare account and
[Wrangler](https://developers.cloudflare.com/workers/wrangler/). I run Wrangler
through `npx` at the same version the deploys use, since older global installs
have crashed on me:

```
npx wrangler@4.131.2 d1 migrations apply lyricalmiracle_db --local
npx wrangler@4.131.2 pages dev .
```

Before that, create a `.dev.vars` file in the project root:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_REDIRECT_URL=http://localhost:8788/api/auth/google/callback
```

You can get these from a Google Cloud OAuth client (type "Web") with that
redirect URI added.

Email and password accounts stay off unless you also set these:

```
PASSWORD_AUTH_ENABLED=true
PASSWORD_PEPPER=32-or-more-random-bytes-base64
APP_BASE_URL=http://localhost:8788
TURNSTILE_SECRET_KEY=your-turnstile-secret
RESEND_API_KEY=your-resend-key
EMAIL_FROM=LyricLike <noreply@your-domain>
```

`PASSWORD_AUTH_ENABLED` works as the kill switch. If you leave it unset, only
Google sign-in shows up. Every link that gets emailed is built from
`APP_BASE_URL`. The public Turnstile site key is in `wrangler.toml`.

Sign in with Apple is for the iOS app, and stays off unless you set all four:

```
APPLE_CLIENT_ID=com.lyriclike.app
APPLE_TEAM_ID=your-10-character-team-id
APPLE_KEY_ID=your-10-character-key-id
APPLE_PRIVATE_KEY=the-text-of-your-.p8-file
```

`APPLE_CLIENT_ID` is the app's bundle ID. The first three are not secret. The
key is a Sign in with Apple key made in the Apple developer account, and it
belongs in the dashboard's secrets, not in `wrangler.toml`. The app sends the
identity token to `POST /api/auth/apple`. The server keeps the refresh token
Apple returns so it can revoke the grant when an account is deleted, which Apple
requires.

You can also set `ALERT_EMAIL` to an address that should get a heads up when a
day's signup or account email reaches 70% of its cap in `functions/_email.js`.
Once a cap is reached, the signup, forgot-password and set-password requests
answer 503 until the next day.

Preview deploys use their own database (`lyricalmiracle-db-preview`), so a
branch never touches real accounts.

## Rhyme pages

`/rhymes/` holds static "words that rhyme with X" pages for search engines.
They are generated from the same rhyme logic as the editor. Since the site has
no build step, the pages are committed. To regenerate them:

```
node tools/rhymes/collect-popular-words.mjs   # rarely: re-rank popular searches
node tools/rhymes/build-pages.mjs             # rewrite /rhymes/ and sitemap.xml
```

The editor and the pages share one copy of the rhyme logic, `rhyme-core.js`.
The pages leave out names, rare words and crude words, while the editor lists
them last. The pages also leave out the words in
`tools/rhymes/page-excluded-words.json`, which ad networks treat as sensitive.
Those words don't get a page either, but the editor still lists them.

## Word lists

These are all at the repo root, and all plain JSON arrays:

- `cmudict.json`: pronunciations, from the CMU Pronouncing Dictionary
- `english-words.json`: words that rhyme results can list, commonest first (the
  order is the frequency ranking)
- `name-words.json`: words English only spells with a capital ("wayne"), listed
  last. Rebuild with `node tools/build-name-words.mjs`
- `crude-words.json`: swear and sex words, listed last and never on a rhyme page
- `blocklist.json`: slurs. These are never listed, and typing one doesn't look
  anything up

## Tests

The rhyme logic and the API's access checks have tests. They need Node 22 or
later, and nothing else installed:

```
node --test "test/*.test.mjs"
```

GitHub Actions runs them on every pull request.

## License

MIT, see [LICENSE](LICENSE). The bundled CMU Pronouncing Dictionary has its own
license, see [NOTICE](NOTICE).
