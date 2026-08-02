---
"@agent-native/core": patch
"@agent-native/creative-context": patch
---

Let Design generation work on Cloudflare D1. Creating the default creative
context used `db.transaction()`, which D1 rejects with `Failed query: begin`,
so `generate-design` failed on every attempt and no design could ever be
generated on a Worker. The new `runAtomicWrites` helper — companion to
`runCompareAndSwap` — runs a fixed statement list through D1's `batch()` and
through a transaction on interactive dialects, keeping the dialect branch in
core rather than at the call site.
