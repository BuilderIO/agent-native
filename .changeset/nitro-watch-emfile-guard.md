---
"@agent-native/core": patch
---

Keep Nitro/Vite dev servers responsive when native file watchers hit EMFILE or ENOSPC by falling back to polling instead of replacing failed watches with no-ops.
