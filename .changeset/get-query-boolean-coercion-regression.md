---
"@agent-native/core": patch
---

Document and regression-test that `useActionQuery` / `callAction` GET calls round-trip boolean and number params. Browser query params are serialized through `URLSearchParams`, which stringifies everything — so `useActionQuery("instrument-overview", { includeSeries: true, limit: 5 })` sends `includeSeries: "true"` / `limit: "5"`. Schema-aware coercion (added in 0.70.2) already restores native types before validation, but it was framed and tested only as a model-gateway concern. This adds an end-to-end regression test through the action route for the GET path and broadens the coercion doc comment so it is not narrowed to gateway-only and silently re-break browser GET calls. No runtime behavior change.
