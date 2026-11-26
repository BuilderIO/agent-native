A menu groups commands that act on the same target. Use it for actions such as duplicating, locking, or exporting a layer.

```tsx
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
} from "@agent-native/toolkit/ui/base-ui/menu";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

<Menu>
  <MenuTrigger render={<Button variant="surface" />}>Layer actions</MenuTrigger>
  <MenuPopup>
    <MenuItem onClick={duplicate}>Duplicate</MenuItem>
    <MenuCheckboxItem checked={locked} onCheckedChange={setLocked}>
      Locked
    </MenuCheckboxItem>
  </MenuPopup>
</Menu>;
```

## Usage

- Use `MenuItem` for a command, `MenuCheckboxItem` for a flag, and `MenuRadioGroup` for mutually exclusive choices.
- Use `MenuLinkItem` with an `href` for navigation. Pass `closeOnClick` to dismiss the menu after following the link.
- Place `MenuGroupLabel` inside a group to give it an accessible name.
- Register shortcuts in the application. `MenuShortcut` displays the key combination.

## Keyboard

Arrow keys move between items. Enter activates an item. In LTR, Right Arrow opens a submenu and Left Arrow returns to its parent. In RTL, those keys reverse. Escape closes the menu and returns focus to its trigger.

[Run commands in an interactive menu](?path=/story/components-menu--interactive)

[Base UI Menu](https://base-ui.com/react/components/menu) · [Radix Dropdown Menu](https://www.radix-ui.com/themes/docs/components/dropdown-menu)
