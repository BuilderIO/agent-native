TextArea gives prose room to wrap and accepts intentional line breaks. It suits comments, feedback and descriptions. The native `rows` attribute sets a useful initial writing area.

Field supplies a persistent label and can associate instructions and validation feedback. A controlled editor takes its text through `value` and updates it in `onChange`.

```tsx
import { Field, FieldLabel } from "@agent-native/toolkit/ui/base-ui/field";
import { TextArea } from "@agent-native/toolkit/ui/base-ui/text-area";

<Field name="feedback">
  <FieldLabel>Feedback</FieldLabel>
  <TextArea rows={4} placeholder="What could work better?" />
</Field>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/text-area)
