ToggleGroup coordinates adjacent pressed buttons. A formatting bar can use `multiple` so bold and italic can be active together, or use the default single-selection behavior for a set of alternatives.

Each Toggle has a stable value and the group has an accessible name. The root value is an array, including in single-selection mode. Size, color and variant set on the group flow to its toggles.

```tsx
import { ToggleGroup } from "@agent-native/toolkit/ui/base-ui/toggle-group";
import { Toggle } from "@agent-native/toolkit/ui/base-ui/toggle";

<ToggleGroup aria-label="Formatting" multiple defaultValue={["bold"]}>
  <Toggle value="bold">Bold</Toggle>
  <Toggle value="italic">Italic</Toggle>
</ToggleGroup>;
```

[Base UI behavior and API](https://base-ui.com/react/components/toggle-group)
