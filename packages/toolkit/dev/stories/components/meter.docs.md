A Meter shows where a measured value falls within a range. Use it for quota usage, capacity or a score. Use Progress for a task advancing toward completion.

Set the range to match the underlying units. Provide a visible label or accessible name that explains what is being measured. Pair warning colors with a value or text that communicates the same information.

```tsx
import {
  Meter,
  MeterLabel,
  MeterValue,
} from "@agent-native/toolkit/ui/base-ui/meter";

<Meter value={72}>
  <MeterLabel>Storage used</MeterLabel>
  <MeterValue />
</Meter>;
```

Use `format` and `locale` to show the measured value in its unit. The fill still represents its position between `min` and `max`. [Rotation example](?path=/story/components-meter--signed-range)

[Base UI · Meter](https://base-ui.com/react/components/meter)
