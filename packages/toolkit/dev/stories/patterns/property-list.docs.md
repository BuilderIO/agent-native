Use `PropertyList` when several editable properties should share a label column. Each `PropertyRow` pairs a `PropertyLabel` and a `PropertyValue`. The list responds to its container width, so the same field composition fits a desktop inspector and a narrow panel.

For a single input, connect the label’s `htmlFor` to the input’s `id`. When a row contains several inputs, render the label as a span, name a group in `PropertyValue` with `aria-labelledby`, and give each input its own accessible name. The Dimensions row demonstrates this for Width and Height.

Keep values, validation and change handlers on the controls placed inside each row. Resize the Inspector Width and Narrow examples to see how the labels and controls reflow without changing their reading order.

```tsx
import {
  PropertyList,
  PropertyRow,
  PropertyLabel,
  PropertyValue,
} from "@agent-native/toolkit/ui/base-ui/property-list";

<PropertyList>
  <PropertyRow>
    <PropertyLabel htmlFor={nameId}>Layer name</PropertyLabel>
    <PropertyValue>
      <input id={nameId} defaultValue="Frame" />
    </PropertyValue>
  </PropertyRow>
</PropertyList>;
```

See [Input](?path=/docs/components-input--docs) for composing text fields and their slots.
