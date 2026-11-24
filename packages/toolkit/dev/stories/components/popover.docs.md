Use a popover to edit or inspect something beside its trigger. A frame's grid settings can stay next to the inspector control while the user changes them. The popup can contain buttons, fields and another popup.

Use `PopoverTrigger` with `render` to give one Button both the visual treatment and trigger behavior. `PopoverPopup` mounts and positions the surface. Give it a `PopoverTitle` or an accessible label. Keep labels on individual fields so the popup's name and each field's name are distinct.

Use a `className` callback to style a part from its current state. For example, `<PopoverArrow className={({ uncentered }) => uncentered ? "invisible" : undefined} />` hides the arrow when it cannot point at the trigger.

The root accepts `open` and `onOpenChange` when selection or navigation controls its visibility. `OverlayScope` supplies a themed portal target, and `container` on the popup overrides that target. Keep field values outside the popup when edits should survive dismissal. Inside a dialog, Escape closes the popover and returns focus to its trigger. A second Escape closes the dialog.

```tsx
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "@agent-native/toolkit/ui/base-ui/popover";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";
import { Switch } from "@agent-native/toolkit/ui/base-ui/switch";

export function GridSettings() {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="surface" />}>
        Grid settings
      </PopoverTrigger>
      <PopoverPopup>
        <PopoverTitle>Grid settings</PopoverTitle>
        <label>
          <Switch defaultChecked /> Snap to grid
        </label>
      </PopoverPopup>
    </Popover>
  );
}
```

[Edit a value inside a dialog](?path=/story/components-popover--inside-dialog)

[Base UI Popover](https://base-ui.com/react/components/popover) · [Radix Popover](https://www.radix-ui.com/themes/docs/components/popover)
