---
"@agent-native/core": minor
---

Add optional `outputSchema` to `defineAction` — validate an action's RETURN
value (warn/strict/fallback). Pass a Standard Schema-compatible `outputSchema`
(Zod, Valibot, ArkType — same surface as the input `schema`) and the framework
validates the result AFTER `run()` resolves, composing with the existing input
validation (input validated before `run`, output validated after). The
`outputErrorStrategy` (default `"warn"`) controls the mismatch behavior:
`"strict"` throws a clear error so a buggy action surfaces loudly, `"warn"`
`console.warn`s the issues and returns the ORIGINAL result unchanged
(non-breaking), and `"fallback"` returns the provided `outputFallback`. When no
`outputSchema` is supplied, behavior is byte-for-byte unchanged (no wrapping).
Borrowed from Mastra/Flue structured-output and kept dependency-free on the
action layer.
