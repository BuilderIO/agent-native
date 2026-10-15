---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Links an extension opens in a new tab are now opened by the host page (http/https only, with noopener) instead of as popups of the sandboxed iframe, so pages like HubSpot records load instead of rendering blank. The extension iframe's sandbox is unchanged.
