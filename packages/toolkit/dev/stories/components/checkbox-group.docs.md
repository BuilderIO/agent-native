CheckboxGroup collects several independent options into one array of selected values. It suits notification channels where email and push may both be enabled.

The root names the set and owns the selection. Each Checkbox supplies a distinct value and its own label. The group’s variant and color are inherited by its items, and individual items can override them.

```tsx
import { CheckboxGroup } from "@agent-native/toolkit/ui/base-ui/checkbox-group";
import { Checkbox } from "@agent-native/toolkit/ui/base-ui/checkbox";

<CheckboxGroup aria-label="Notifications" defaultValue={["email"]}>
  <label>
    <Checkbox value="email" /> Email
  </label>
  <label>
    <Checkbox value="push" /> Push
  </label>
</CheckboxGroup>;
```

[Base UI behavior and API](https://base-ui.com/react/components/checkbox-group)
