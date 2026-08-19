---
"@agent-native/core": patch
---

Stop the Builder gateway's 500 envelope from ending chats three different ways, and stop emitting the malformed tool schema that provokes it.

The gateway answers 200 and then delivers its own internal-error envelope ("Sorry,
we ran into an issue processing your request. ERROR ID: …") as an in-stream frame,
so nothing structured reaches the layer that catches it. `runAgentLoopWithResume`
dropped straight to `internal_error` without asking the shared classifier, so one
upstream failure was persisted under three codes depending on which layer caught it
— `builder_gateway_internal_error`, `internal_error`, `unknown` — and only one of
those is on the client's recoverable list. Identical gateway failures therefore
ended some chats on the first attempt and sent others into a re-dispatch chain.
Both catch sites now classify the message first; `internal_error` stays the last
resort for a message nothing recognises.

That envelope is also no longer auto-recoverable at the run level. Measured across
three production databases, 7 turns reached it and 0 of 7 ever finished, across 97
runs — one turn burned 28 runs over 16 minutes on a single "Hey", with overlapping
concurrent runs on the same turn. The engine's in-request retry still covers the
genuinely transient case, and the recovery card keeps a deliberate Retry, because
its own copy ends with "Retry in a moment".

The fallback Zod-to-JSON-Schema converter read a literal's value from `def.value`,
which Zod v4 does not define — it stores `values`. Every literal therefore emitted
`{"type":"undefined"}`, a type keyword no JSON Schema dialect defines, and an
`enum` of `[null]` instead of the real value. Literals are most often a
discriminated union's discriminator, so ordinary action schemas were affected. The
Builder gateway validates only a tool's top-level `input_schema.type`, so an
invented type on a nested field passes validation, reaches the provider, and comes
back as the opaque ERROR ID envelope — on every retry, because the same malformed
schema is resent verbatim. Literal values are now read from `values`, and no
literal can emit a type outside the seven JSON Schema names.

An action schema carrying a literal that JSON cannot represent is now rejected when
the action is defined, rather than producing a broken request later. A `bigint`
literal made `JSON.stringify` throw while the request was being built, and
`undefined`, `NaN`, and `±Infinity` serialized to `null` — advertising a value the
Zod validator still rejects, so the schema and the validator disagreed with nothing
in the output left to detect it from. The check runs against the Zod def as well as
the emitted schema, because Zod's own converter turns `z.literal(NaN)` into
`const: null` before the emitted schema can be inspected.
