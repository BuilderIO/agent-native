---
"@agent-native/core": patch
---

Fix an infinite sign-in redirect loop under base-path deploys. When the
authenticated app shell (wrapped in `RequireSession`) was served at the sign-in
path — e.g. `/<app>/_agent-native/sign-in` on a path-prefixed deploy — the gate
redirected to the sign-in page from the sign-in page, nesting and re-encoding the
current URL as a fresh `?return=` on every hop (`…sign-in?return=%252F…sign-in%253Freturn…`).
`RequireSession` now refuses to redirect when already on the sign-in entry point
(new exported `isOnSignInPage` helper), and `safeReturnPath` collapses any
`return` that resolves back to `…/_agent-native/sign-in` to `/`.
