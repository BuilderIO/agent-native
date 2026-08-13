---
"@agent-native/core": patch
---

Action routes now fall back to the caller's stored active organization when a
cookie session resolves no org, matching what the adapter/A2A path already did.
An empty org silently narrowed every scoped read to rows with a null `org_id`,
so a user could stop seeing their own org-scoped dashboards and resources. An
explicit Personal selection still resolves to no org, and a transient database
failure propagates instead of reading as "this user has no org".
