---
"@agent-native/core": patch
---

Fix an infinite redirect loop when an app sets `homePath: "/"`. The auth guard
served the framework login document at `/` whenever marketing content was
configured, but for a root-home app `/` is the authenticated app shell — so a
signed-in visitor was bounced from `/` to `/` forever. The guard now serves the
app shell at `/` (letting the client session gate own sign-in) when the app home
is the root, and only serves the login document there for apps whose home is a
separate path.
