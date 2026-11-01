---
"@agent-native/core": minor
"@agent-native/dispatch": patch
---

Add `runtime.apiBaseUrl` (`AGENT_NATIVE_CONFIG_RUNTIME_API_BASE_URL`, or `window.__AGENT_NATIVE_CONFIG__.apiBaseUrl`) so a UI served from another origin can reach the app's server. `agentNativePath()` and `appApiPath()` return URLs on that server, requests addressed to it carry credentials, relative URLs are never rewritten (a host page that embeds the app keeps its own `/api` calls), and framework and template client code now build every server URL with those helpers; and origins in `CORS_ALLOWED_ORIGINS` are matched with the same normalization for credentialed responses and are trusted by the sign-in origin check. Sign-in from such a UI happens on the server and returns to the UI page through `/_agent-native/auth/ui-return`, which redirects only to those allowlisted origins. Preflights from allowed origins now also admit any extra request headers they ask for, and cookie-writing POSTs such as consent accept an origin listed in `CORS_ALLOWED_ORIGINS`.
