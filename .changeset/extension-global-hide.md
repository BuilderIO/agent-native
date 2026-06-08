---
"@agent-native/core": minor
---

Add global (admin) hide for extensions. The `tools` table gains additive
`hidden_at` / `hidden_by` columns (distinct from the existing per-user
`tool_hidden_extensions` hide). When set, the extension is hidden from
everyone's Extensions list/sidebar without being deleted.

- `listExtensions` now excludes globally-hidden extensions by default and
  accepts `includeGloballyHidden: true` to surface them.
- New store helpers `globalHideExtension` / `globalUnhideExtension` (require
  owner/admin access) and new agent actions `global-hide-extension` /
  `global-unhide-extension`. `list-extensions` accepts `includeGloballyHidden`
  and reports `globallyHidden` / `hiddenAt` / `hiddenBy` per extension.
- The extensions list endpoint accepts `?includeGloballyHidden=true`.
- The Extensions sidebar and list page add a "Hide from everyone" /
  "Unhide for everyone" affordance for admins plus a "Show hidden" toggle.
