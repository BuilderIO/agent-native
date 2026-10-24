---
"@agent-native/core": patch
---

Keep an app without a `CHANGELOG.md` from breaking its Settings page in dev. The changelog `?raw` import now loads as an empty changelog instead of asking Vite to watch a file that does not exist, which failed the page's client import and sent React Router into a reload loop.
