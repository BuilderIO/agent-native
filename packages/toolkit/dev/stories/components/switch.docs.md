Use a Switch for a setting that takes effect immediately. Keep the label stable in both states, such as “Show guides”. Wrap the switch in its label to make the text clickable.

Use `checked` and `onCheckedChange` to control the value, or `defaultChecked` to set its initial state.

```tsx
import { Switch } from "@agent-native/toolkit/ui/base-ui/switch";

<label>
  <Switch checked={showGuides} onCheckedChange={setShowGuides} />
  Show guides
</label>;
```

Pass a `SwitchThumb` as the child to customize the thumb. Its `className`, `style`, and `render` callbacks receive the switch state.

[Base UI behavior and API](https://base-ui.com/react/components/switch)
