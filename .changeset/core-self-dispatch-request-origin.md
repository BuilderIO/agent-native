---
"@agent-native/core": patch
---

Fix self-dispatch from an agent turn or a CLI action forwarded to the dev server. With no inbound request to read a host from, the local fallback guessed `localhost:3000`, so a run started by the chat agent (for example a queued automation run) failed with an opaque `fetch failed` whenever the app was served on another port. The local fallback now uses the origin the current request was served on; configured deployment URLs are unchanged and hosted deployments still require one. A dispatch that gets no HTTP answer now throws the new `SelfDispatchNetworkError` (exported with `SelfDispatchHttpError` from `@agent-native/core/server`) carrying the `target` origin and the socket code such as `ECONNREFUSED`, and `SelfDispatchHttpError` carries the `target` too. The existing messages keep their text, with the target and code added to the network one.
