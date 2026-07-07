---
"@agent-native/core": patch
---

Force Netlify single-template SSR routing: patch the scanned server function to preferStatic false, emit a fallback redirect, and fail the build when either is missing.
