---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Build each app faster. The resource icon picker's Tabler chunks now carry icon data instead of importing every icon component, so an app's client build handles about 3,200 modules instead of 9,200, and the picker's icon chunks are about 20% smaller. Core's stub and shim Vite plugins declare hook filters, so the bundler no longer calls into them for every import. Icons render exactly as before.
