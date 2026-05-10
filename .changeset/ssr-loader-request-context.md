---
"@agent-native/core": patch
---

Mirror Google Slides' sharing behavior in the framework `ShareButton` and SSR runtime:

- Wrap SSR loaders in `runWithRequestContext` so React Router loaders see the signed-in user via `getRequestUserEmail()` / `accessFilter()`. Fixes a bug where shared admins (and even owners) hit 404 on access-controlled SSR routes unless visibility was set to public.
- `ShareButton` now supports an optional `secondaryShareUrl` (with `secondaryShareUrlLabel` / `secondaryShareUrlDescription`) so a resource can expose two copyable URLs — e.g. an editor link and a read-only / presentation link — in the same share dialog.
- `shareUrlRequiresPublic` (and the related `shareUrlUnavailableDescription`) is now a no-op and deprecated. Access is enforced on the resource itself, not the URL shape, matching Google Slides — copying a link no longer requires flipping visibility to public.
