Field connects one control to its label, supporting description and validation feedback. For an email address, the label names the data, the description can identify who receives messages, and an error explains how to correct the address.

The label, input and feedback share a Field root. `name` supplies the field key when a Form reads or validates its values. FieldError can match a constraint such as a required value.

```tsx
import {
  Field,
  FieldLabel,
  FieldError,
} from "@agent-native/toolkit/ui/base-ui/field";
import { Input } from "@agent-native/toolkit/ui/base-ui/input";

<Field name="email">
  <FieldLabel>Billing email</FieldLabel>
  <Input type="email" required />
  <FieldError match="valueMissing">Enter a billing email.</FieldError>
</Field>;
```

[Base UI behavior and API](https://base-ui.com/react/components/field)
