---
"@agent-native/core": minor
---

Add a "panel" edit surface for config-driven blocks. A block spec can set
`editSurface: "panel"` (the default when it ships no custom `Edit`) to render its
`Read` view with a hover corner edit button that opens its editor — the custom
`Edit` or the schema-driven auto-form — in an app-provided panel
(`ctx.renderEditSurface`, e.g. a popover), instead of always-inline fields.
Direct-manipulation blocks (prose, checklist, table, tabs) stay inline. The core
`custom-html` block opts into the panel.

Also completes the schema auto-editor (`SchemaBlockEditor`): array fields now
render as add/remove repeating rows (object elements → nested field groups,
scalar elements → per-item inputs) and object fields render as nested fieldsets,
instead of falling back to a "needs custom Edit" hint.
