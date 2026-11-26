Form coordinates validation and submission across named fields. A profile editor can validate an email locally, then surface a server response against the same field name.

The `onFormSubmit` callback receives the collected values after validation. Key server errors by Field name in `errors` and use FieldError beside the relevant control. The submit Button should declare its type.

```tsx
import { Form } from "@agent-native/toolkit/ui/base-ui/form";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@agent-native/toolkit/ui/base-ui/field";
import { Input } from "@agent-native/toolkit/ui/base-ui/input";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

<Form onFormSubmit={saveProfile}>
  <Field name="email">
    <FieldLabel>Email</FieldLabel>
    <Input type="email" required />
    <FieldError />
  </Field>
  <Button type="submit">Save profile</Button>
</Form>;
```

[Base UI behavior and API](https://base-ui.com/react/components/form)
