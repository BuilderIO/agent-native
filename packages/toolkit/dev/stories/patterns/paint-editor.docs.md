Use `PaintEditor` when an object can have a stack of solid or gradient fills. Supply the ordered `value` and `onValueChange`. The first paint is on top. Use `paintBackground` to render the stack with its current visibility and opacity. Pass `tokens` to let people bind a color to a named value.

```tsx
import { PaintEditor } from "@agent-native/toolkit/ui/base-ui/paint-editor";

<PaintEditor value={paints} tokens={palette} onValueChange={changePaints} />;
```

The callback receives the next stack and an edit phase. Use the preview stack while a gradient stop moves. On commit, record the previously committed stack once so Undo restores the entire gesture. Preserve paint and stop IDs across edits so focus and selection follow the same objects during reordering.

Escape cancels an unfinished numeric edit. An interrupted stop drag restores the starting stops. Use `onCancelPreview` to discard the host’s preview without adding an undo entry. The same callback clears a pending preview when its field unmounts. Without it, canceling a mounted field sends the restored value through `onValueChange` with the commit phase.

For multi-selection, use `equalPaintStacks` to compare authored fills. Token bindings, fallback colors and stop order all count. Prepare a change once with `createPaintStackEdit(original, next)`, then call the returned function on each layer’s original stack to retain its local fill and stop IDs.

The assembled editor includes named row actions and keyboard-operable gradient stops. Use `renderFields` to extend its fields, or compose `PaintList`, `PaintRow`, `PaintColorField` and `PaintGradientStops` for a different arrangement. The examples exercise token binding, paint order and a complete stop drag.

See [Slider](?path=/docs/components-slider--docs) for keyboard interaction with multiple thumbs.

The color field shows a swatch and token name when bound. Select the name to replace the token, or detach using the picker option or Backspace on the focused picker. Detach captures the swatch’s current CSS color, including values inherited from the active theme. [Detach color](?path=/story/patterns-paint-editor--detach-color)
