---
"@agent-native/core": patch
---

Inline `open_app` embeds in claude.ai and Claude Desktop now load. When the host sandbox blocks the transplanted document's `<base>` element, link, script and image URLs resolve against the app origin instead of the sandbox origin.
