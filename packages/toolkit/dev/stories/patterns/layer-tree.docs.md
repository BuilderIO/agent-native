Use `LayerTree` to browse, select and reorder layers in a document.

```tsx
import { LayerTree } from "@agent-native/toolkit/ui/base-ui/layer-tree";

<LayerTree
  aria-label="Layers"
  items={layers}
  onItemsChange={setLayers}
  selection={selectedIds}
  onSelectionChange={setSelectedIds}
  getActionLabel={layerActionLabel}
  viewportHeight={measuredHeight}
/>;
```

## Usage

Supply a flat list of layers with stable IDs and parent IDs. Apply edits in `onItemsChange`. Use `getActionLabel` to name each row action, for example “Hide Logo”. When layers share a name, use `getItemLabel` to include their group in the accessible name. Typeahead and renaming use the visible layer name. [Repeated names](?path=/story/patterns-layer-tree--repeated-names)

To share selection or expansion with another view, pass `selection` or `expanded` and its change callback. Customize rows with `renderIcon`, `renderLabel` and `renderActions`. For large documents, pass the measured panel height as `viewportHeight` to virtualize rows. Set `--layer-tree-row-height` to change their height. The tree measures it again when density changes. A `ref` points to the tree element. In a windowed panel, read or restore its `scrollTop` to preserve the user’s place. [10,000-layer document](?path=/story/patterns-layer-tree--large-document) · [Deeply nested groups](?path=/story/patterns-layer-tree--deep-hierarchy)

## Keyboard

| Key                   | Action                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------- |
| ↑ / ↓                 | Focus the previous or next visible layer. Hold Shift to extend selection.                    |
| Home / End            | Focus the first or last visible layer.                                                       |
| Page Up / Page Down   | In a windowed tree, move focus by one viewport. Hold Shift to extend the selection.          |
| → / ←                 | Expand a group or enter its first child. Collapse a group or focus its parent.               |
| Type a name prefix    | Focus a matching visible layer. Repeat one letter to cycle through matches.                  |
| Enter / Space         | Select the focused layer. Hold Shift for a range, or Control or Command to toggle one layer. |
| Control / Command + A | Select every row in the expanded tree, including offscreen rows.                             |
| F2                    | Rename the layer. Enter saves and Escape cancels.                                            |
| Tab                   | Reach the focused row’s actions.                                                             |
| Alt + ↑ / ↓           | Move the selection among siblings.                                                           |
| Alt + → / ←           | Nest under the preceding group or move out one level.                                        |

Horizontal shortcuts follow the tree’s direction. Each default layer label and rename field follows the direction of its text, so a layer can have an Arabic name in an English document or an English name in an Arabic document. If the selection anchor disappears, the next range starts at the focused row.

Double-click a layer to rename it. Drag to a row edge to reorder, or to the center of a group to nest. Use `--layer-tree-drop-line` to customize the placement indicator. In forced colors, a dashed outline marks nesting and a solid line marks insertion.

See [Design File Panel](?path=/docs/patterns-design-file-panel--docs) for a tree with page navigation and search.
