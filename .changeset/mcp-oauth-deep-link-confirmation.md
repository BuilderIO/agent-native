---
"@agent-native/core": patch
---

Show a friendly "You're all set" confirmation page after authorizing an MCP
client whose redirect is a native deep link (cursor://, vscode://, …). Instead
of leaving the browser tab dangling on a blank page after the OS handed the code
to the app, the tab now shows a checkmark, a "return to your agent to continue"
message, and re-fires the deep link so the client still receives the code.
https/loopback callbacks keep the standard redirect.
