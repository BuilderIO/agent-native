---
"@agent-native/core": minor
---

Add an in-loop processor seam (`processOutputStream` / `processOutputStep` +
`abort()` / `TripWire`) for real-time guardrails. `runAgentLoop` now accepts an
optional `processors: Processor[]`. Each processor exposes optional hooks —
`processOutputStream` (per streamed chunk), `processOutputStep` (once per model
response, around tool execution, with the requested tool calls), and
`processOutputResult` (once at run end) — and a per-processor mutable `state`
that persists across hooks and is isolated between processors. A processor can
call `abort(reason, meta?)` (throws an exported `TripWire`) to halt the run
gracefully; the loop catches it, emits a new `{ type: "tripwire"; reason;
processor? }` agent-chat event, surfaces the reason as a final message, and
stops. This is the structural prerequisite for real-time guardrails and a
proof-of-done / coverage gate. Borrowed from Mastra's output processors and
kept loop-internal configuration (processors only observe/mutate-stream/abort;
they do not define app behavior or replace actions). When no processors are
passed the loop is byte-for-byte unchanged with zero overhead.
