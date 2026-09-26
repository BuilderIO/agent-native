---
"@agent-native/core": minor
---

Add a speech-synthesis route: `POST /_agent-native/speak` turns text into
`audio/mpeg` bytes through the request's own `OPENAI_API_KEY`, and
`@agent-native/core/client/speak` exposes it to app code as `fetchSpeechClip`.

It returns 400 with `reason: "no-provider"` when no key is configured, so a
caller can fall back to the browser's speech synthesiser without mistaking an
unconfigured app for a failing one. Every other refusal carries its own reason,
and an empty 200 from the provider is reported as a failure rather than played
as silence.
