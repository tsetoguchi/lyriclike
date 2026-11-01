# Sign in with Apple, for the iOS app

A small Capacitor plugin with one call, `authorize`. The page reaches it as
`Capacitor.Plugins.AppleSignIn.authorize({ scopes, nonce })`. It asks the system
for an identity token and returns `{ response: { user, email, givenName, familyName,
identityToken, authorizationCode } }`; a closed sheet rejects with code `1001`.

It is adapted from `@capacitor-community/apple-sign-in` (MIT, see `LICENSE`).
That package's Swift package asks for Capacitor 7, so it cannot be built beside
Capacitor 8, which this app uses. This copy only changes the Capacitor
requirement, keeps the one waiting call and the system sheet in properties, and
sends missing fields as null.

It does nothing on Android or the web, and the app only offers the button on iOS.
