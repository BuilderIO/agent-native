---
"@agent-native/core": patch
---

Registry block-node legacy-block editing. Legacy (unregistered) document blocks
can now either:

- render their own self-contained edit overlay via a `legacyBlockSelfEdits`
  side-map predicate — the node view renders the block in edit mode and adds NO
  separate corner edit surface (no pencil/JSON/form popover), so the block owns a
  single control overlay (e.g. an image block with one hover toolbar); or
- supply a schema-driven form editor via the `renderLegacyBlockEditor` side-map
  hook, rendered in the block-edit popover instead of the raw-JSON fallback.

The raw-JSON fallback editor's Save button is also right-aligned instead of
stretching full-width.
