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

To customize a group of switches, set a styling input on their container. This changes the unchecked soft track. Checked and disabled switches retain their own colors.

```css
[data-app-theme="design"] {
  --switch-soft-track-color: var(--gray-a6);
}
```

An inherited `--switch-radius` takes precedence over the `radius` prop. When the input is unset, the prop uses the control shape and a switch without the prop uses the default pill radius.

The Switch entry in the parts catalog lists all 15 inputs and their defaults.

[Base UI behavior and API](https://base-ui.com/react/components/switch)
