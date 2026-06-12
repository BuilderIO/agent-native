---
"@agent-native/core": patch
---

Keep generated app SSR entries on their app-local React Router singleton by
passing the local `ServerRouter` into the shared document request handler.
