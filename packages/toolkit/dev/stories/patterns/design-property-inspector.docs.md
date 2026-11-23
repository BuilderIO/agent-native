Use `DesignSelectionProperties` when a selection needs the usual frame controls, including dimensions, auto layout, fill and effects. Pass selected layer identities in `layers` and the corresponding geometries in `current`. Provide `lockedLayerIds` for locks inherited from a parent. The panel can then distinguish editable, locked and mixed selections.

The inspector infers your geometry type from `current`. Update callbacks preserve app-specific fields, and `renderCode` can read them.

Supply `apply` for discrete changes and `edit` for preview, commit and cancel. During a width scrub, apply each preview to the original geometries. Commit one undo entry on release or restore the originals on cancel. If you store a preview function, capture only its value and edit parameters. Capturing the previous render can keep every intermediate selection in memory until release. Connect `canUndo`, `canRedo`, `undo` and `redo` to the same document history used by the canvas.

If a saved aspect ratio falls outside `sizeLimits`, width and height stay readable. Release the aspect-ratio lock to resize the selection. Unlocking preserves every layer’s dimensions.

Responsive fields show **Mixed** when values differ or a layer has no rule. Adding a rule fills in missing rules. Editing a breakpoint preserves each layer’s padding, and editing padding preserves its breakpoint.

Use `renderPositionAction` to place a constraints picker beside the X and Y fields. It receives the same editable selection as the property fields.

Set `--inspector-inset-start` for the field edge and `--inspector-inset-end` for the trailing action area. Property rows share two equal field columns and a trailing action column. Position uses two equal columns between the field insets for its alignment and rotation rows. The transform group extends to the action inset. A wide field can span both field columns. Use `--inspector-gap` for field spacing and `--inspector-action-width` for each trailing button slot. Responsive rule fields share a width of up to 11rem, configurable with `--inspector-rule-width`. The remove button follows the field. The grid mirrors in RTL. [Custom grid](?path=/story/patterns-design-property-inspector--custom-grid)

Pass an element in `sections` to replace a group, or `null` to hide it. The inspector skips the built-in group’s calculations in both cases. Supply children for additional groups. For a different set of properties, assemble `DesignPropertyInspector`, `DesignSelectionHeader` and `DesignPropertySection` directly. Give each inspector a distinct accessible name when several panels share the screen.

```tsx
import { DesignSelectionProperties } from "@agent-native/toolkit/ui/base-ui/design-property-inspector";

<DesignSelectionProperties
  {...selectionProps}
  sections={{ fill: customFillSection, responsive: null }}
  exportSection={exportControls}
/>;
```

See [Layout Properties](?path=/docs/patterns-layout-properties--docs) for handling mixed dimensions and aspect-ratio locks.

Supply `radiusTokens` to enable radius bindings. Store the ID in `radiusToken` and the numeric fallback in `radius`. The picker follows token renames, shows mixed bindings across selections, and detaches each layer at its own resolved radius. Assignment and detach use the same undo history as other inspector edits. [Radius binding](?path=/story/patterns-design-property-inspector--radius-binding)
