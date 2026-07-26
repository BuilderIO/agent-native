# Design Editor Inspector Extensions

Design editor extensions render in the right inspector slot
`design.editor.inspector`. See the root `extension-points` skill for the
general slot mechanism (`window.slotContext`, `createExtension`,
`add-extension-slot-target`, `install-extension`); this file covers what's
specific to the Design inspector slot.

## Creating one

1. `create-extension`
2. `add-extension-slot-target` with slot id `design.editor.inspector`
3. `install-extension` so it appears inline in the inspector

If creating the extension opens the standalone extension editor, return to
the same design with `navigate` and `inspectorTab: "extensions"` after
installing it.

## Context shape

Extensions installed in this slot receive `window.slotContext` with the
current design id, active screen, selected element, zoom, mode, tool, and
tweak values.

## AI-driven style/artboard changes

For AI-driven style/artboard changes triggered from the extension UI,
extension HTML should call `agentNative.chat.send(...)` with the selected
element's selector/sourceId and the request. On the agent side:

1. Call `view-screen` first.
2. Prefer `apply-visual-edit` for element style/class/text changes.
3. Use `update-design` or `generate-design` with `canvasFrames` for overview
   artboard placement changes.
