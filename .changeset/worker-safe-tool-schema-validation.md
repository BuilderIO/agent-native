---
"@agent-native/core": patch
---

Validate agent tool input on runtimes that forbid code generation from strings

Ajv compiles a schema by building JavaScript source and handing it to
`new Function`. Cloudflare Workers refuse that, so on a Worker every
`ajv.compile` in the agent loop threw and every tool call was rejected before it
ran with "tool schema is invalid: Code generation from strings disallowed for
this context" — the agent could talk but could not do anything.

Both Ajv instances in the agent loop now go through one compile seam that
selects on the capability rather than on the host: it probes whether the runtime
allows code generation, and where it does not, interprets the schema with
`@cfworker/json-schema` instead. Where `new Function` works, Ajv is used exactly
as before — same options, same `ErrorObject`s, same error text, same union
narrowing.

The interpreted path reproduces Ajv's `coerceTypes` scalar coercion, in place,
so a model sending `"3"` for a number is accepted on both. It also checks the
schema structurally before use, because the interpreter would otherwise ignore a
malformed keyword and then accept everything — turning "this schema is
unreadable" into "this input is fine". Error wording differs between the two
paths; the accept/reject decision and the coerced value do not, and a parity
spec runs the same schemas and inputs through both to keep it that way.
