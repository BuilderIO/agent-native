---
"@agent-native/core": patch
---

A delegated call from an app with no workspace domain now runs in the person's one workspace in the receiving app, with that workspace's connections, and saves what it makes there, unless they have picked their personal space there. With no workspace or several, it stays in their personal scope. If the receiving app can't read its workspace list, the call stops with a "try again" error instead of running in the wrong place.
