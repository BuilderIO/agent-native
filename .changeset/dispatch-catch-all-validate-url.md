---
"@agent-native/dispatch": patch
---

`resolveCatchAllTarget` now validates `app.url` is an absolute http(s) URL before letting it take precedence over `app.path`. Previously any non-empty string would win — including bare hostnames like `"forms.example.com"` (no protocol, browser would treat the redirect as a relative path inside the gateway and 404) or `javascript:` schemes (phishing vector). Mirrors the validation in `normalizeWorkspaceAppUrl` (deploy CLI), inlined to avoid pulling that module into the runtime path. 3 new spec cases (bare hostname rejected, non-http(s) scheme rejected, trailing slash stripped). Flagged by the Builder bot review on #652.
