---
"@agent-native/core": patch
---

`spawnTask` can now be called from app server code with no chat waiting on it. `parentSend`, `systemPrompt` and `actions` are optional, `scope` sets the task thread's scope so an app can keep it out of chat history, `allowedActionNames` limits which actions the sub-agent may call (it's required when `parentSend` is omitted, and inside a run with its own allowlist only names in that allowlist are kept), and `quiet` keeps the task out of the runs tray, the background task list and completion notifications.
