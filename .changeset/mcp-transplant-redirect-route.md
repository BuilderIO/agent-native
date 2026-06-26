---
"@agent-native/core": patch
---

Fix MCP App transplant (Claude) rendering the app's 404 page instead of the
target route. The embed ticket's `targetPath` is `/_agent-native/open?...&to=/plans/<id>`,
which 302-redirects to the real app route. The transplant followed that redirect
to fetch the correct SSR HTML, but then called `history.replaceState` with the
**pre-redirect** location (`/_agent-native/open`) — a server-only framework route
React Router has no client route for — so hydration threw
`No route matches URL "/_agent-native/open"` and rendered the app's 404 boundary.
The transplant now uses the post-redirect `response.url` (the resolved app route,
e.g. `/plans/<id>`) for `replaceState`, so the hydrated router matches the route.
