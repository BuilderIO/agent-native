---
"@agent-native/core": patch
---

A delegated call from an app with no workspace domain now runs where the person would be if they opened the receiving app themselves. When they belong to exactly one workspace there and haven't chosen their personal space instead, the call runs in that workspace, with its connections, and saves what it makes there. Otherwise it stays in their personal scope. If the receiving app can't read its workspace list, the call stops with a "try again" error instead of running in the wrong place.
