---
"@agent-native/core": patch
---

Recover chats from transient provider failures instead of ending them. A
provider transport blip reached persistence with no structured error code and
was stored as `unknown`, which the client does not list as auto-recoverable —
so the turn died where the identical failure carrying its real code resumes. In
production this was measurable: `unknown` runs averaged exactly 1.00 runs per
turn (no recovery was ever attempted), against 2.0 for `provider_network_error`
and 1.5 for `http_429` on the same underlying errors.

Four divergent copies of the connection-error predicate had drifted apart, and
they disagreed on the exact string the AI SDK actually throws — `RetryError`
reports `"Failed after 2 attempts. Last error: Cannot connect to API: …"`, which
a copy anchored with `startsWith` scored as unclassified while a copy using
`includes` scored as retryable. They are now one exported classifier in
`engine/error-detail.ts`, matched against the error's full cause chain, and
applied both where the error event is built (the code the client reads) and
where the run's terminal code is persisted. Transport and capacity failures map
to their real codes; deterministic failures stay unmapped so a broken request
still stops the chat instead of spiralling.

Also stop sending `reasoning_effort` alongside function tools for GPT models on
the Builder gateway. The gateway routes them to Chat Completions, which rejects
that combination outright, so every agent turn on a `gpt-5.x` model failed
deterministically. Omitting the field does not help — only the explicit `"none"`
clears it, matching the guard the AI SDK engine already had.
