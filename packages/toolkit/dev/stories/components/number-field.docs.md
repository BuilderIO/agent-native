Use NumberField for a quantity people can type, step through, or drag to adjust. Set the bounds and step on the root.

```tsx
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldIncrement,
} from "@agent-native/toolkit/ui/base-ui/number-field";

<NumberField aria-label="Seats" defaultValue={4} min={1} max={50} step={1}>
  <NumberFieldDecrement />
  <NumberFieldIncrement />
</NumberField>;
```

Fields display numbers without digit grouping (`1280`) and step in whole numbers by default. Typed decimals round to at most two places on commit. Set `step` for fractional increments or `format` for a different precision. Use `unit="degree"` to display the symbol beside the value, as in `3.86°`.

## Handling changes

Use `onValueChange` for live previews and `onValueCommitted` to save a completed edit. For a controlled field, update `value` on each change. A cleared field can report `null`.

## Scrubbing

Scrub labels default to horizontal. Set `direction="vertical"` on `NumberFieldScrubArea` to increase the value by dragging upward. [Try both directions](?path=/story/components-number-field--with-scrub-area).

Discard the drag preview in `onScrubCancel`. This runs if the gesture is interrupted, the window loses focus, or the field becomes disabled or read-only.

[Base UI behavior and API](https://base-ui.com/react/components/number-field)
