---
"@agent-native/core": patch
---

Fix video playback failing in workspace dev mode. When a browser requested video bytes (range/streaming requests), the dev server was stripping the app base path prefix before Nitro's media handler could run, causing Vite to return an error page instead of the video.
