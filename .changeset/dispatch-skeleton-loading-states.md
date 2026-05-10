---
"@agent-native/dispatch": patch
---

fix(dispatch): replace inline "Loading..." with skeletons + stop `/dispatch/dispatch` redirect loop

Six dispatch loading states were rendering the literal string "Loading..." (or "Loading…", "Loading app status...") instead of skeleton placeholders. This made the UI feel cheap and inconsistent with the rest of the framework.

Now using `<Skeleton>` placeholders shaped like the content that's about to render in:

- `approval.tsx` — full-page approval preview card (was: centered "Loading...")
- `overview.tsx` — Recent activity list under Operations detail (was: small "Loading..." next to the section header)
- `vault.tsx` — Secrets tab count badge and the empty list area (was: inline "Loading...")
- `workspace.tsx` — Workspace Resources count and tab list area (was: inline "Loading...")
- `apps.$appId.tsx` — Workspace app detail card (was: "Loading app status...")
- `app-keys-popover.tsx` — App-keys grant popover list (was: "Loading…")

Also fixes a redirect loop on `/dispatch/dispatch` (the catch-all hit when something tries to navigate to dispatch from inside dispatch). The catch-all loader resolved the dispatch entry from the workspace manifest and redirected to `app.path` (`/dispatch`), but `useActionQuery`'s 2s poll re-fired the `window.location.assign(href)` effect each tick, leaving the page stuck on a "Loading…" state with the URL refreshing forever. Both `loader` and the new `clientLoader` now short-circuit to `appPath("/overview")` when `appId === "dispatch"`, and the component renders `<Navigate replace>` for the same case so SPA navigations resolve immediately.
