---
"@agent-native/core": patch
---

Resolve the durable background handoff as one typed transport decision. A single
`resolveBackgroundDispatchTarget()` returns a `BackgroundDispatchTarget` union —
an HTTP function target, a queue target, and the portable in-process route —
carrying the runtime expectation alongside the transport, so the two agent-chat
dispatch call sites no longer re-derive host knowledge from the dispatch path
string. Netlify resolves to exactly the values it produced before; no behaviour
changes.
