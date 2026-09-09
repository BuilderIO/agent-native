---
"@agent-native/core": patch
---

Fix a crash on the auth/signup page (`NotFoundError: removeChild`) caused by the ocean background's dynamically-loaded renderer chunk sharing tuning/color modules with the auth entry chunk, which made the browser re-import and re-execute the entry chunk's hydration a second time. The shared values now live in their own module, and hydration is guarded to run only once as a backstop.
