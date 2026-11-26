A context menu exposes actions for the object under the pointer. Bind its callbacks to that object's stable ID so right-clicking one layer acts on that layer even when another row has focus.

Give `ContextMenuTrigger` a focusable target for the keyboard context-menu gesture. Include important commands in a visible menu or toolbar as well. Use `ContextMenuItem` for a command, `ContextMenuCheckboxItem` for a persistent flag, and `ContextMenuRadioGroup` for mutually exclusive choices. An item's `onClick` also runs on keyboard activation.

Use `ContextMenuLinkItem` with an `href` to open a destination for the selected object.

For a second level, combine `ContextMenuSubmenuRoot`, `ContextMenuSubmenuTrigger` and `ContextMenuSubmenuPopup`. The Playground demonstrates an Export submenu alongside grouped options.

```tsx
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
} from "@agent-native/toolkit/ui/base-ui/context-menu";

export function FrameCommands({
  name,
  duplicate,
}: {
  name: string;
  duplicate: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div tabIndex={0} />}>
        {name}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <ContextMenuItem onClick={duplicate}>Duplicate frame</ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
```

[Explore grouped layer commands and export formats](?path=/story/components-context-menu--playground)

[Base UI Context Menu](https://base-ui.com/react/components/context-menu) · [Radix Context Menu](https://www.radix-ui.com/themes/docs/components/context-menu)
