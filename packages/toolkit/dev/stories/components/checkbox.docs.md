Use a Checkbox for an independent choice, such as opting into a weekly digest. Wrap it in a visible label so selecting the text also toggles the choice.

Set `indeterminate` when only some children are checked. Derive that state from the children and update them together when the parent is activated.

```tsx
import { Field, FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
import { Checkbox } from "@agent-native/toolkit/ui/base-ui/checkbox";

<Field>
  <FieldLabel>
    <Checkbox name="weeklyDigest" /> Weekly digest
  </FieldLabel>
</Field>;
```

Pass a `CheckboxIndicator` as the child to draw a custom check or mixed-state mark.

[Base UI behavior and API](https://base-ui.com/react/components/checkbox)
