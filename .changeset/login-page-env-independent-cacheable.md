---
"@agent-native/core": patch
---

Always hard-CDN-cache SSR for every visitor; make the login page an
env-independent cacheable shell.

The SSR handler was downgrading every authenticated request (any request
carrying a session cookie) to `private, no-store`, so logged-in visitors got
zero CDN caching on every page — including fully public pages like the docs
site. SSR responses are now served with the standard public
short-fresh / long-stale-while-revalidate policy for ALL visitors,
authenticated or not. To make that safe, the SSR handler no longer reads the
request session/cookies: it renders an impersonal public shell, and all
per-user state (who is signed in, private records, share-grant access) is
resolved client-side after load. A strong guardrail comment now documents that
SSR must never vary by cookie/session and must never be marked private/no-store.

Relatedly, the login page (the public homepage of every app) is now
env-independent: a Google-only app always renders a working Google sign-in
button instead of baking a render-time "Google sign-in is not configured"
message into the CDN-cached HTML. A genuinely misconfigured server surfaces the
error at click time via the auth API instead.
