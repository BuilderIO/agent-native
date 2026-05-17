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

Also hardens the dev auto-account so the convenience can't become an
exposure: it now (1) only fires for **loopback** requests — a new shared
`isLoopbackRequest` helper (also adopted by the desktop-SSO broker) so a
tunnelled / reverse-proxied / misconfigured-non-prod dev server never
auto-signs-in a remote visitor; and (2) mints a **random per-DB password**
printed to the server console once, instead of the source-code-known fixed
`local-dev-account`, so there is no shared credential to reuse. Still gated
on `NODE_ENV` and `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`.
