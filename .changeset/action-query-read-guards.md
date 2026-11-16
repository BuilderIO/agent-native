---
"@agent-native/core": patch
---

Give hand-written action queries the read rules `useActionQuery` applies. `useActionQueryCanFetch` says whether a read may start: never while the app's API is off, and, while the browser's saved results are still being tied to the signed-in user, only for a query already fetching or holding data. `runActionQueryRead` runs one read so a 401, 403 or 404 drops the rows it showed and the saved copy, and a success joins the saved results only for the binding active when it began. `useActionQuery` now uses both.
