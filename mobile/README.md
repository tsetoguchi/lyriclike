# LyricLike mobile apps

The iOS and Android apps are the website bundled with [Capacitor](https://capacitorjs.com).
The site has no build step and keeps none: `copy-web.mjs` copies its static
files into `www/`, and Capacitor puts that folder in the apps. The code that
only runs inside an app is `native-shell.js` and `native-socket.js` at the
site root. On the website they do nothing.

## Android

You need Android Studio and JDK 21 (Capacitor 8 builds with Java 21).

```
cd mobile
npm install
npm run android      # copies the site, syncs, opens Android Studio
```

Run it from Android Studio on an emulator or a phone. The API calls go to
https://lyriclike.com, so sign-in and saving use the real site.

Run `npm run sync` after any change to the site's files. `www/` and
`android/app/src/main/assets/public` are rebuilt each time and are not
tracked.

What was set up by hand in `android/`:
- `AndroidManifest.xml`: the `lyriclike://auth` filter that Google sign-in
  returns through, and `allowBackup="false"` so the session token is not
  copied to Google's backups.
- Launcher icons, from `assets/icon-only.png` with `@capacitor/assets`.
- A plain `#0a0d13` launch screen in place of Capacitor's default splash.

## iOS

Needs a Mac (or a cloud Mac) with Xcode. Run `npx cap add ios`, then add a
URL type with the scheme `lyriclike` to `Info.plist` for Google sign-in.
Sign in with Apple is also needed before review.

## Checks before each release

- Sign in with email and with Google, save a page, reload.
- Open a shared page on two devices and type in both (live editing).
- Put the app in the background and bring it back; the live session should
  reconnect.
- Airplane mode: rhymes and syllable counts still work.
- Sign out, then check that the token is gone (the next launch is signed out).

`npm audit` reports moderate issues in `rimraf` and `glob`, which the
Capacitor CLI uses at build time. They are not in the apps.
