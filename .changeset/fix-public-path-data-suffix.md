---
"@agent-native/core": patch
---

Fix public routes returning 401 on client-side navigation. React Router single-fetch requests loader data at `<route>.data`, which the auth guard's public-path matcher didn't recognize, so navigating to a public route (e.g. `/download`) 401'd until a full page refresh. The matcher now strips the `.data` suffix before checking the public path list.
