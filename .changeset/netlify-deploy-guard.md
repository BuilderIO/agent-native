---
"@agent-native/core": patch
---

Fix Netlify single-template deploy previews by keeping Nitro's `preferStatic` true (so `/assets/*` is served from `dist`) and stripping the harmful default-function URL rewrite that is incompatible with `config.path: "/*"`.
