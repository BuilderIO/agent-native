---
"@agent-native/core": patch
---

Fix dragging blocks by the grip when they live inside a container block
(columns/tabs). A container block's node view runs its `onMouseDownCapture`
block-select handler in its own React root, so its `stopPropagation()` halted the
native `mousedown` before it ever reached an inner editor's drag-handle grip —
nested column blocks could not be picked up at all, so dragging a block OUT of a
column, BETWEEN columns, or onto another block to make new columns silently did
nothing. Two parts: `clickedInteractiveChild` now treats the drag handle and any
target inside a nested editor region as interactive (so the container spares a
mousedown meant for an inner grip), and the grip's icon is now
`pointer-events:none` so a real mouse-down — which lands on the SVG, not the grip
`div` — resolves to the grip itself instead of being swallowed.

Also adds an optional `onEditorReady` callback to the shared rich-markdown editor
so a host can capture the root editor view (used by the plan editor to rebuild
the document when a column move dissolves its container).
