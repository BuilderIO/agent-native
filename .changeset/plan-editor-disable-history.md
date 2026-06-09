---
"@agent-native/core": patch
---

`SharedRichEditor` / `createSharedEditorExtensions` gain an optional
`disableHistory` flag that turns off StarterKit's built-in undo/redo
(prosemirror-history) for a controlled, non-collaborative editor whose host owns
its own undo authority. Defaults to `false`, so every existing embedder is
unchanged; when a collaborative `ydoc` is present, undo/redo stays disabled
regardless (Yjs owns history, as before). The plan editor uses this so a single
app-level undo stack — over its authoritative `blocks[]` tree, which holds block
data the ProseMirror doc never stores — can be the sole cmd+z authority, fixing
undo/redo for block drag-reorder, cross-region moves, and block option/config
edits (none of which PM history could see or reliably revert).
