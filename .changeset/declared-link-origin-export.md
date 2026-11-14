---
"@agent-native/core": patch
---

Export `declaredLinkOrigin` from `@agent-native/core/server`, so an app can build an absolute link only on an origin it trusts. A request keeps its own origin only when the app declares it; otherwise the link uses the app's declared origin, so a forwarded host can't send it elsewhere.
