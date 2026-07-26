---
"@agent-native/core": patch
---

Owners can now delete an organization from Settings → Organization, and portaled
menus no longer render behind raised app surfaces.

- New owner-only `DELETE /_agent-native/org` (type-to-confirm in the UI) removes
  the org's invitations, org-scoped settings, members, and the org row, then
  repoints the caller's active org to another membership or Personal.
- `@agent-native/core/styles/agent-native.css` now imports the toolkit
  stylesheet. Core's own client components render toolkit UI, so apps that
  didn't import `@agent-native/toolkit/styles.css` themselves never generated
  the classes that only appear inside toolkit components — including the
  `z-[290]` on dropdown/select/popover content, which made those menus open
  behind the app shell.
