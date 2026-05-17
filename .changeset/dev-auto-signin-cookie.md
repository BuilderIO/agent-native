---
"@agent-native/core": patch
---

Fix local-dev zero-setup auto-sign-in: the session cookie is now emitted on
the 302 itself. `maybeAutoCreateDevSession` returned a bare
`new Response("", { status: 302, headers: { Location } })` after staging the
session cookie via `setFrameworkSessionCookie`. h3 v2's `prepareResponse`
only merges the event's staged response headers into a returned web
`Response` when that Response is 2xx — its `!val.ok` early-return hands a
non-2xx Response (like a 302) back as-is, dropping the staged `Set-Cookie`.
A fresh `pnpm dev` therefore 302'd straight to the app and bounced back to
the login form. A new `redirectWithStagedCookies` helper mirrors the staged
cookies onto the redirect Response's own headers so the 302 actually carries
the session.
