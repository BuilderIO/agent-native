---
"@agent-native/core": patch
---

Add a reusable `RequireSession` client gate that redirects unauthenticated
visitors to the framework sign-in page instead of leaving a protected app shell
stuck on an infinite loading spinner. The server-side auth guard only protects
requests that reach the Nitro function; a statically-served/cached SPA shell or
a client-side navigation after the session expired never re-hits it, so the app
boots with no session and every data query 401s into a permanent loading state.
Wrap a private app shell with `<RequireSession>` (with optional `bypass` for
embed/popout surfaces that authenticate by another mechanism) to close that gap.
