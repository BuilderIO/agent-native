---
"@agent-native/core": patch
---

Files attached in one app now reach the app it delegates to over A2A. `call-agent` takes an `attachments` list of uploaded file URLs, `callAgent()` sends them as A2A file parts, and the receiving app treats them like files attached in its own chat: its `prepareRequest` hook can save them, the model can read them, and actions see them in `ctx.attachments`.
