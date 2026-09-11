---
"@agent-native/core": patch
---

Fix `open_app` embeds so a bare `view` resolves through the app's own open-route resolver instead of a synthesized `/<view>` path, which 404'd both the embed iframe and the host's "open outside the frame" fallback link.
