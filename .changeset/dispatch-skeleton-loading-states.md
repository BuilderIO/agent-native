---
"@agent-native/dispatch": patch
---

fix(dispatch): replace inline "Loading..." text with skeleton placeholders

Six dispatch loading states were rendering the literal string "Loading..." (or "Loading…", "Loading app status...") instead of skeleton placeholders. This made the UI feel cheap and inconsistent with the rest of the framework.

Now using `<Skeleton>` placeholders shaped like the content that's about to render in:

- `approval.tsx` — full-page approval preview card (was: centered "Loading...")
- `overview.tsx` — Recent activity list under Operations detail (was: small "Loading..." next to the section header)
- `vault.tsx` — Secrets tab count badge and the empty list area (was: inline "Loading...")
- `workspace.tsx` — Workspace Resources count and tab list area (was: inline "Loading...")
- `apps.$appId.tsx` — Workspace app detail card (was: "Loading app status...")
- `app-keys-popover.tsx` — App-keys grant popover list (was: "Loading…")
