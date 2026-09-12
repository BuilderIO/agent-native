---
"@agent-native/core": patch
---

Derive the dev action discovery origin from the URL Vite actually prints instead of
hardcoding `127.0.0.1`, so the printed URL, `dev-server.json`, and every CLI/agent
open path share one canonical dev origin (localhost on the default all-interfaces
bind). Unauthenticated loopback `/_agent-native/*` requests in dev now get a
one-line response hint naming the canonical origin versus the label being visited,
instead of a silent 401 storm followed by a redirect to sign-in. Production and
non-loopback requests keep the bare 401.
