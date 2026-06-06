---
"@agent-native/core": minor
---

Add single-document editor primitives to the shared rich-markdown editor so the
plan app can render its whole document as one editable Notion-style ProseMirror
doc (custom blocks as inline NodeViews) while keeping its `blocks[]` format:
`gfmToProseJSON`/`proseJSONToGfm` (GFM↔ProseMirror via a headless editor), a
`RunId` extension (stable per-block prose ids), the shared `DragHandle` extension
(block grip + drag-reorder, moved from the content app and parameterized via
`wrapperSelector`), and serializer-injection props on `SharedRichEditor`
(`getMarkdown`/`setContent`/`normalizeValue`/`shouldSeed`/`wrapperClassName`).

The `DragHandle` grip now attaches lazily on first hover (re-homing to the
wrapper once it exists) instead of only at plugin init, so the grip reliably
appears even when the editor DOM mounts into its wrapper after the ProseMirror
view is constructed (the React mount order in `SharedRichEditor`).
