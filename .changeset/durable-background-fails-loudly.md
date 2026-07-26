---
"@agent-native/core": patch
---

Stop deploys from silently losing the durable-background Netlify function. An
opted-in build now fails instead of warning when the function cannot be emitted,
asserts the artifact actually landed where Netlify scans for it, and the runtime
reports once per isolate when a worker that expected the background function is
running on the synchronous function instead. The keep-warm scheduled function
also pings the background function so it stops cold-starting on every dispatch,
and the workspace deploy gate now shares the runtime flag parse instead of
keeping a third, inverted copy.
