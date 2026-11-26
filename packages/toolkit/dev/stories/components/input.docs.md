Collect a single line of text. Pair `Input` with `FieldLabel` so the label stays visible as the user types.

```tsx
import { Field, FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
import { Input } from "@agent-native/toolkit/ui/base-ui/input";

<Field name="workspace">
  <FieldLabel>Workspace name</FieldLabel>
  <Input defaultValue="Studio" required />
</Field>;
```

Use `InputSlot` for an icon, unit, or action. Decorative slots focus the input. Buttons keep their own focus and need an accessible name.

[Base UI behavior and API](https://base-ui.com/react/components/input)
