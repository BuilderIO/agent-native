---
"@agent-native/core": patch
---

Fix the missing inline screenshot on PR Visual Recap comments. The `recap shot`
command runs `page.evaluate`/`addInitScript` payloads that contain named inner
functions; when the CLI is run through `tsx`/esbuild (CI's trusted-workspace
path), esbuild's `keepNames` wraps those functions in `__name(...)`, which
Playwright then serializes into the browser where `__name` is undefined —
throwing `ReferenceError: __name is not defined`, dropping the screenshot, and
falling back to a link-only comment. `runShot` now injects an identity `__name`
shim as the first browser init script, so every main-world payload is safe
regardless of how the CLI was transpiled (the tsc-built published package, which
never emits `__name`, is unaffected).
