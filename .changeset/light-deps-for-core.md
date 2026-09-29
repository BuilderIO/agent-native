---
"@agent-native/core": minor
---

Move optional integration, ingestion, telemetry, and CLI packages out of Core's install-time dependency graph. Features now load peers on demand and report a typed install error when invoked without them. `initServerSentry` is now async and callers must await its `Promise<boolean>` result. Auth pages can use injected renderers, with a plain HTML fallback; without an injected renderer, the form is rendered after client hydration. Remove the decorative WebGPU ocean background from Core's auth and onboarding UI.
