---
"@agent-native/core": patch
---

Force Netlify single-template SSR routing by patching the scanned server function to preferStatic false, and refuse the harmful default-function URL rewrite that is incompatible with Nitro's config.path catch-all.
