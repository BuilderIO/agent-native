---
"@agent-native/core": patch
---

Use the Builder.io credits that Fusion injects into a project's preview, so the preview chat works without asking the project owner to connect Builder.io again. When a deployed credits pair is refused by the runtime, the agent engine status reports `builderCreditsRefused` and the server logs it once.
