---
"@agent-native/core": patch
---

Routes that only accept same-origin requests (voice transcription and cleanup, speech, realtime voice, Builder.io disconnect) now accept a desktop app's `tauri://localhost` page on a hosted server, as they were meant to. WebKit marks those requests `Sec-Fetch-Site: cross-site`, and the check returned 403 on that header before it looked at the desktop origin, so desktop AI polish silently kept the raw text.
