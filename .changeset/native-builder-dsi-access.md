---
"@agent-native/core": patch
---

Add personally verified Builder-account access checks and an in-place connection gate for design-system authoring in Design and Slides.

Preserve explicit Fusion dispatch, completion, failure, interruption, and timeout outcomes; a delivered message no longer implies a completed agent turn or published design system.

Stop automatically resubmitting DSI indexing after uncertain responses, and provide a scoped original-byte source reader for provider handoff.
