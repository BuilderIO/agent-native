Use a RadioGroup when people need to see all the options and choose one, such as a billing cadence. Name the group and give each Radio a label and a distinct value. The arrow keys move selection between options.

Set `variant`, `color`, or `highContrast` on an individual option to override the group default.

```tsx
import {
  RadioGroup,
  Radio,
} from "@agent-native/toolkit/ui/base-ui/radio-group";

<RadioGroup aria-label="Billing cadence" defaultValue="monthly">
  <label>
    <Radio value="monthly" /> Monthly
  </label>
  <label>
    <Radio value="annual" /> Annual
  </label>
</RadioGroup>;
```

Place a `RadioIndicator` inside a `Radio` to customize its selection mark.

[Base UI behavior and API](https://base-ui.com/react/components/radio-group)
