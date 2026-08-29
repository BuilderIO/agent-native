---
"@agent-native/core": patch
---

Server stack traces in PostHog Error tracking now symbolicate against uploaded source maps.

Every frame was emitted as `platform: "custom"`, which PostHog treats as a
pre-resolved frame with no symbol store — `RawFrame::Custom.symbol_set_ref()`
returns `None`, so the frame is never looked up no matter how correctly the
app's maps were uploaded. Browser stacks resolved anyway because those come from
posthog-js (`web:javascript` + `chunk_id`); server stacks stayed minified
forever.

A frame now claims `node:javascript` — whose symbol-set reference is its
`chunk_id` — exactly when a chunk id is known for its file, and stays `custom`
otherwise, so a `node:internal/…` frame is not reported as a failed resolution.
`chunkIdsByFilename()` reads the registry `@posthog/cli sourcemap inject` leaves
on `globalThis._posthogChunkIds`, whose keys are stack strings rather than
filenames; the PostHog provider passes it on every `$exception`. Apps that do
not upload source maps for their server bundle are unaffected.
