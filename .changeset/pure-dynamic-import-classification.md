---
"@agent-native/core": patch
---

Separate passive chunk recovery state and error classification from browser recovery, and framework route prefix resolution from client startup, to avoid circular dependencies during client initialization.

Keep browser event handlers out of React Native startup when shared translation and chat modules load in a runtime with a non-DOM window global.
