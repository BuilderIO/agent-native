---
"@agent-native/core": patch
---

Include actions whose default export comes from a `define…Action` wrapper (such as `export default defineAppAction({...})`) in the generated action registry and route discovery, instead of silently dropping them.
