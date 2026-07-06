---
"@agent-native/toolkit": minor
"@agent-native/core": patch
---

Add Toolkit provider overrides, collaboration UI, and sharing UI entrypoints while preserving core client compatibility re-exports. The core re-exports are temporary migration shims; the long-term dependency direction is Toolkit composing core runtime APIs, not core permanently owning reusable app-building UI. Future behaviorful kits should be extracted one at a time, with Sharing as the first candidate to validate access checks, action-backed data, and share-link UI together.
