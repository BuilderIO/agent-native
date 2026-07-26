---
"@agent-native/core": minor
---

One sign-in journey: collapse five return-path validators, four "don't redirect
to yourself" checks, and two login documents into a single primitive

`@agent-native/core/shared` now exports `signInJourney`, `normalizeAppPath`,
`encodeContinuation`, and `decodeContinuation`. Every sign-in surface — the
client gate, the login document, and the `/_agent-native/sign-in` entry route —
computes its destination through that one function. The sign-in URL carries an
opaque `?c=` continuation holding a PATH instead of a re-encoded URL, so a
return target cannot nest inside another one and the anti-loop checks are
deleted rather than centralised.

Fixed by this change:

- **Google-only apps looped on sign-in.** `createGoogleAuthPlugin` shipped its
  own login page whose completion was `window.location.href = ret || '/'` with
  `ret` set to the sign-in page itself — sign in, land back on sign-in. That
  page is gone; the plugin now serves `getOnboardingHtml({ googleOnly: true })`,
  gaining the already-signed-in bounce, stuck-button recovery, and i18n.
  `createGoogleAuthPlugin`'s signature is unchanged, but the markup is
  different: the Google button/error/debug element ids are now `google-btn`,
  `google-err`, `google-debug` (previously `btn`, `err`, `debug`).
- **Base-path deploys bounced forever.** `/myapp/login` was not recognised as an
  auth entry path, so a signed-in visitor resumed to the login page.
- **Verification emails linked back to a login form**, because the `callbackURL`
  posted to Better Auth could legitimately be the sign-in page.
- **Embed tickets minted for an auth entry path** were honoured; they now fail
  closed on the existing "Invalid embed target." 400.
- **Open redirect**: continuations are validated on both encode and decode, and
  must be contained in the app's own base path — a sibling app's path on a
  multi-app workspace host is rejected.

Scope: this fixes _where you land_, not _whether the cookie arrived_. The
Builder iframe, Builder desktop proxy, and Agent Native Desktop surfaces fail
for cookie-delivery reasons; the `_session` URL bridge and
`appendSessionToOAuthReturnUrl` are deliberately untouched. Those surfaces will
now land on the right page logged out rather than bouncing to a login loop.

Compatibility:

- `/_agent-native/sign-in?return=<path>` is accepted **permanently**. Generated
  apps hand-write it and cannot be upgraded. New producers must emit `?c=`.
- `buildSignInReturnHref()` keeps its zero-arg call signature and gains an
  optional `{ returnTo }`. It now emits `?c=`.
- `safeReturnPath()` keeps its signature, `"/"` fallback, and rejections; it is
  now a deprecated one-line delegate to `normalizeAppPath` and deliberately
  applies no base-path containment, because its eight remaining call sites are
  provider OAuth returns rather than sign-in journeys.
- `isOnSignInPage()` is removed. It was never reachable through a package export
  and has no remaining callers.
