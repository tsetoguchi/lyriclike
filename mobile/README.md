# LyricLike mobile apps

The iOS and Android apps are the website bundled with [Capacitor](https://capacitorjs.com).
The site has no build step and keeps none: `copy-web.mjs` copies its static
files into `www/`, and Capacitor puts that folder in the apps. The code that
only runs inside an app is `native-shell.js` and `native-socket.js` at the
site root. On the website they do nothing.

## Android

You need Android Studio and JDK 21. Capacitor 8 pins Gradle 8.14, which can't
read the newer Java that Android Studio bundles (25 at the time of writing), so
install a separate JDK 21 (`winget install EclipseAdoptium.Temurin.21.JDK`) and
pick it under Settings > Build, Execution, Deployment > Build Tools > Gradle >
Gradle JDK.

```
cd mobile
npm install
npm run android      # copies the site, syncs, opens Android Studio
```

To build the debug APK without Android Studio, point `JAVA_HOME` at the JDK 21
and `ANDROID_HOME` at the SDK, then run `./gradlew assembleDebug` in
`mobile/android`. The APK lands in `app/build/outputs/apk/debug/`.

Or run it from Android Studio on an emulator or a phone. The API calls go to
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

iOS apps only build on a Mac, so the builds run on a GitHub macOS runner
(`.github/workflows/ios.yml`, started by hand from the Actions tab). The project
in `ios/` was made with `npx cap add ios` and then set up by hand, without
Xcode:
- `Info.plist`: the `lyriclike` URL scheme that Google sign-in returns through,
  `ITSAppUsesNonExemptEncryption` off (the app only talks HTTPS), `arm64`, and a
  dark interface, since the site is dark only.
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`), iOS 15 and up.
- `App.entitlements`: the Sign in with Apple capability.
- A plain `#0a0d13` launch screen, and the 1024 px App Store icon (the 512 px
  site icon with every pixel doubled, and no transparency, which the App Store
  rejects).

To build: run the workflow without "upload" to check the app compiles (no
secrets needed). To send a build to TestFlight, run it from `main` with
"upload" ticked, after adding the repo secrets listed at the top of the
workflow file. The app's bundle ID, `com.lyriclike.app`, has to exist in the
Apple developer account with the Sign in with Apple capability turned on.

After changing the site's files, run `npm run sync` here so `ios/App/App/public`
is rebuilt. It isn't tracked.

## Checks before each release

- Sign in with email and with Google, save a page, reload.
- Open a shared page on two devices and type in both (live editing).
- Put the app in the background and bring it back; the live session should
  reconnect.
- Airplane mode: rhymes and syllable counts still work.
- Sign out, then check that the token is gone (the next launch is signed out).

`npm audit` reports moderate issues in `rimraf` and `glob`, which the
Capacitor CLI uses at build time. They are not in the apps.
