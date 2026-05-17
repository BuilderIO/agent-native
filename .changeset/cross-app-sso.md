---
"@agent-native/core": minor
---

Cross-app SSO ("Sign in with Agent-Native", Dispatch as identity authority).
New opt-in env `AGENT_NATIVE_IDENTITY_HUB_URL`: when set, an app exposes
`/_agent-native/identity/login` + `/callback`, redirects to the hub's
`/_agent-native/identity/authorize`, verifies the short-lived `A2A_SECRET`-
signed identity token (strict `scope:"identity"`, single-use CSRF state,
`iat`/`exp` bounds), and **JIT-links to the local Better Auth user strictly by
verified email** — existing same-email user is linked (additive `account` row
via the adapter; the user/session rows are never modified, renamed, or
deleted), new email is created via the normal signup path — then mints a normal
local session. Unset = zero behavior change (fully reversible; per-app canary
via one env var). Identity rows are only ever added to, so rolling this out
logs users out once and they log back into the _same_ account with data intact.
Includes the `redirect()` staged-`Set-Cookie`-on-302 fix so the session
survives the federated callback. The Dispatch-side identity authority lives in
the (private) dispatch template.
