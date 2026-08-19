# Editor commands

Editor _behavior_ lives here, not in `DesignEditor.tsx`. Each module exports one
`run<Name>(args, ...)` function; `DesignEditor.tsx` holds only the `useCallback`
that gathers `args` and calls it.

**To change what an editor action does, edit the module — not the call site.**

Sibling directories: `../effects/` (subscriptions and autosave loops),
`../derive/` (pure derivations), `../domains/` (whole-domain hooks that own
state + refs + effects + handlers together), and the flat `../*.ts` helpers
(`../history.ts`, `../selection-state.ts`, `../pending-edits.ts`,
`../editor-state.ts`, …).

Many specs assert against these files directly rather than against
`DesignEditor.tsx`, via a `commandSource("<file>.ts")` helper. Moving code out of
a module breaks those — re-point the spec in the same commit.

## History

| Module    | Does                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `undo.ts` | Undo one step, routing across pending live edits, clipboard pastes, structure replays, and content history |
| `redo.ts` | Redo the last undone step, mirroring undo routing                                                          |

## Clipboard

| Module                                  | Does                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `copy-selection.ts`                     | Copy selected layers to the design clipboard and the system clipboard    |
| `paste-selection.ts`                    | Paste clipboard layers into the target screen with cascade placement     |
| `paste-over-selection.ts`               | Paste clipboard layers alongside the current selection                   |
| `paste-copied-screens.ts`               | Paste whole copied screens as new files                                  |
| `paste-to-replace.ts`                   | Replace the selected layer with the clipboard payload                    |
| `editor-paste.ts`                       | Top-level paste router: image files vs Figma payload vs design clipboard |
| `pasted-image-files.ts`                 | Upload pasted or dropped image files and insert them as layers           |
| `import-figma-clipboard-into-design.ts` | Convert a Figma clipboard payload into design layers                     |
| `get-selected-layer-snapshots.ts`       | Snapshot selected layers (HTML + geometry) for copy/duplicate            |
| `duplicate-selection.ts`                | Duplicate selected layers with offset cascade                            |

## Structure

| Module                              | Does                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `delete-selection.ts`               | Delete selected layers; writes a scoped `display:none` instead while a breakpoint is active |
| `delete-files.ts`                   | Delete screens/files and clean up selection and overview state                              |
| `group-selection.ts`                | Wrap the selection in a group container                                                     |
| `ungroup-selection.ts`              | Unwrap a group, hoisting its children                                                       |
| `frame-selection.ts`                | Wrap the selection in a frame                                                               |
| `cross-screen-element-drop.ts`      | Move an element from one screen to another by canvas drag                                   |
| `overview-primitive-reparent.ts`    | Reparent a primitive dropped on the overview board                                          |
| `visual-structure-change.ts`        | Apply a canvas structural change to the focused screen                                      |
| `screen-visual-structure-change.ts` | Same, addressed by explicit `screenId` (overview/board)                                     |
| `visual-duplicate-change.ts`        | Canvas-initiated duplicate on the focused screen                                            |
| `screen-visual-duplicate-change.ts` | Same, addressed by explicit `screenId`                                                      |

## Styles

| Module                                              | Does                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `commit-visual-styles.ts`                           | The central style write — resolves base vs breakpoint-scoped content, then persists |
| `commit-styles-to-selected-layers.ts`               | Apply a style map to every selected layer                                           |
| `commit-relative-style-delta-to-selected-layers.ts` | Apply a relative (delta) style change across the selection                          |
| `style-change.ts`                                   | Inspector single-property change (`property`, `value`)                              |
| `styles-change.ts`                                  | Inspector multi-property change (`styles` map)                                      |
| `screen-visual-style-change.ts`                     | Canvas style change addressed by explicit `screenId`                                |
| `record-pending-visual-style-edit.ts`               | Record an uncommitted style gesture, stamped with breakpoint scope                  |
| `change-selected-z-index.ts`                        | Raise or lower the selection's z-order                                              |

## Text

| Module                             | Does                                      |
| ---------------------------------- | ----------------------------------------- |
| `text-content-change.ts`           | Commit text content on the focused screen |
| `screen-text-content-change.ts`    | Same, addressed by explicit `screenId`    |
| `record-pending-live-text-edit.ts` | Record an uncommitted live text edit      |

## Pending live edits

| Module                                      | Does                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `record-pending-live-structure-edit.ts`     | Record an uncommitted live structure change from the runtime canvas   |
| `record-pending-live-layer-state-edit.ts`   | Record an uncommitted live lock/hide layer-state change               |
| `apply-pending-visual-styles-with-agent.ts` | Hand the pending visual-style batch to the agent to write into source |
| `apply-to-source.ts`                        | Write pending edits back to a localhost/fusion source file            |

## Layers panel

| Module                              | Does                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| `layer-move.ts`                     | Reorder or reparent a layer within a screen                          |
| `layer-move-to-screen.ts`           | Move a layer into a different screen                                 |
| `can-move-layer.ts`                 | Predicate guarding a layer move (lock, ownership, source capability) |
| `layer-rename.ts`                   | Rename a layer                                                       |
| `layer-selection-change.ts`         | Apply a layers-panel selection change                                |
| `layer-marquee-selection-change.ts` | Apply a layers-panel marquee selection                               |
| `toggle-layer-locked.ts`            | Toggle a layer's locked state                                        |
| `toggle-layer-hidden.ts`            | Toggle a layer's hidden state                                        |

## Selection and input

| Module                     | Does                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `screen-element-select.ts` | Select an element on a screen from the canvas                                 |
| `iframe-context-menu.ts`   | Build the canvas context menu for a right-click inside the iframe             |
| `enter-hotkey.ts`          | Enter key: start text edit, enter a group, or enter vector edit               |
| `escape-hotkey.ts`         | Escape key: exit text edit, vector edit, tool, or selection in priority order |

## Layout and geometry

| Module                             | Does                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `align-selection.ts`               | Align selected layers on an axis                            |
| `distribute-selection.ts`          | Distribute selected layers evenly                           |
| `nudge-selection.ts`               | Arrow-key nudge, coalescing auto-repeat into one undo entry |
| `tidy-up.ts`                       | Tidy overview screen positions into a grid                  |
| `suggest-auto-layout.ts`           | Compute an auto-layout suggestion for the selection         |
| `add-auto-layout.ts`               | Apply auto-layout (flex) to the selection                   |
| `geometry-commit.ts`               | Commit a canvas frame move/resize                           |
| `write-frame-geometry-snapshot.ts` | Write a frame-geometry snapshot into design data            |
| `persist-frame-geometry-save.ts`   | Flush the debounced frame-geometry save to the server       |

## Screens and view

| Module                   | Does                                                      |
| ------------------------ | --------------------------------------------------------- |
| `add-screen.ts`          | Create a new screen                                       |
| `create-screen-frame.ts` | Create a screen by drawing a frame on the overview canvas |
| `duplicate-screen.ts`    | Duplicate an existing screen                              |
| `enter-single-screen.ts` | Zoom from overview into a single screen                   |
| `mode-change.ts`         | Switch edit/annotate/interact, routing view mode with it  |

## Primitives

| Module                 | Does                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `create-primitive.ts`  | Insert a drawn primitive (rect, ellipse, line, arrow, text, pen)  |
| `primitive-created.ts` | Post-insert follow-up: select, enter text edit, prune empty nodes |

## Persistence

| Module                           | Does                                            |
| -------------------------------- | ----------------------------------------------- |
| `save-file-content.ts`           | Perform one file-content save request           |
| `apply-file-content-update.ts`   | Apply a server-confirmed file content update    |
| `apply-local-content-update.ts`  | Apply a local content update and record history |
| `apply-design-editor-command.ts` | Execute a URL/agent-driven editor command       |
| `persist-tweak-save.ts`          | Persist the debounced tweak-selection save      |

## Export

| Module                        | Does                                      |
| ----------------------------- | ----------------------------------------- |
| `render-png-blob.ts`          | Rasterize a capture target to a PNG blob  |
| `download-pdf.ts`             | Export the active screen as PDF           |
| `download-all-screens-pdf.ts` | Export every screen as a multi-page PDF   |
| `download-svg.ts`             | Export the active screen as SVG           |
| `copy-as-figma-svg.ts`        | Copy the selection as Figma-pasteable SVG |

## Agent handoff

| Module                                         | Does                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `send-runtime-layer-semantic-handoff.ts`       | Send a runtime layer edit to the agent as a semantic instruction |
| `send-runtime-layer-move-semantic-handoff.ts`  | Same, for a layer move                                           |
| `send-runtime-layer-state-semantic-handoff.ts` | Same, for a lock/hide state change                               |
| `send-overview-annotations.ts`                 | Submit the overview annotation batch to the agent                |

## Generation

| Module                      | Does                                       |
| --------------------------- | ------------------------------------------ |
| `start-retry-generation.ts` | Retry a failed or stale generation run     |
| `tweak-prompt-submit.ts`    | Submit the tweak prompt to the agent       |
| `confirm-make-real.ts`      | Confirm the "make this a real app" handoff |

## Components

| Module                           | Does                                                |
| -------------------------------- | --------------------------------------------------- |
| `detach-instance-menu-action.ts` | Detach a component instance from its main component |

## Motion

| Module                      | Does                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `toggle-motion-keyframe.ts` | Toggle a keyframe at the playhead for the selected element |

## Chrome

| Module                    | Does                                |
| ------------------------- | ----------------------------------- |
| `start-sidebar-resize.ts` | Begin a sidebar drag-resize gesture |
