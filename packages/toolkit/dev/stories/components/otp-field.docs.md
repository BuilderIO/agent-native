OTPField receives a fixed-length verification code. It advances focus during entry and distributes a pasted code across the boxes, so the application can keep a single string value, including leading zeroes.

FieldLabel names the first entry and `inputLabel` can localize the other positions. Custom OTPFieldInput and OTPFieldSeparator children can group a code visually while preserving its entry order.

```tsx
import { Field, FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
import { OTPField } from "@agent-native/toolkit/ui/base-ui/otp-field";

<Field name="code">
  <FieldLabel>Verification code</FieldLabel>
  <OTPField length={6} />
</Field>;
```

[Base UI behavior and API](https://base-ui.com/react/components/otp-field)
