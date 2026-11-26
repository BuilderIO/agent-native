Fieldset groups related questions under a legend. A shipping form can repeat labels such as “Street” and “City” for billing and shipping while preserving the context of each group.

FieldsetLegend gives the group its accessible name. Each editable value still needs its own FieldLabel. Disabling the fieldset makes its descendant form controls unavailable together.

```tsx
import {
  Fieldset,
  FieldsetLegend,
} from "@agent-native/toolkit/ui/base-ui/fieldset";
import { Field, FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
import { Input } from "@agent-native/toolkit/ui/base-ui/input";

<Fieldset>
  <FieldsetLegend>Shipping address</FieldsetLegend>
  <Field name="city">
    <FieldLabel>City</FieldLabel>
    <Input autoComplete="shipping address-level2" />
  </Field>
</Fieldset>;
```

[Base UI behavior and API](https://base-ui.com/react/components/fieldset)
