---
"@agent-native/core": patch
---

Legacy (unregistered) document blocks can now supply a schema-driven form editor
via a new `renderLegacyBlockEditor` side-map hook on the registry block node,
rendering `SchemaBlockEditor` (real inputs) instead of the raw-JSON fallback.
Also right-align the Save button in the JSON fallback editor instead of
stretching it full-width.
