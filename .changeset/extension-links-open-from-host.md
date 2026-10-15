---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Links in an extension that open a new tab (`target="_blank"`, Cmd/Ctrl/Shift-click, or middle-click) are now opened by the host page, http/https only and with noopener, instead of as popups of the sandboxed iframe, so pages like HubSpot records load instead of rendering blank. The extension iframe's sandbox and `window.open` are unchanged.
