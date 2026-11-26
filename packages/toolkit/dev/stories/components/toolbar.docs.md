A toolbar gives frequently used commands one place and one entry point in the tab order. Use it for operations that act on the same selection, such as formatting selected text. Name the toolbar by its purpose.

Compose `ToolbarButton` for commands, `ToolbarLink` for destinations, and `ToolbarSeparator` between groups. For a persistent option, render a `Toggle` through `ToolbarButton` so the control exposes its pressed state and participates in toolbar focus movement. Give icon-only controls an accessible name.

The root's `size` controls its buttons. Arrow keys navigate its controls along the toolbar orientation. Connect each command to editor state so the toolbar reflects changes made from menus or shortcuts.

```tsx
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@agent-native/toolkit/ui/base-ui/toolbar";
import { Toggle } from "@agent-native/toolkit/ui/base-ui/toggle";

export function TextCommands({
  bold,
  setBold,
  clear,
}: {
  bold: boolean;
  setBold: (value: boolean) => void;
  clear: () => void;
}) {
  return (
    <Toolbar aria-label="Text formatting">
      <ToolbarButton
        render={<Toggle pressed={bold} onPressedChange={setBold} />}
      >
        Bold
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton onClick={clear}>Clear formatting</ToolbarButton>
    </Toolbar>
  );
}
```

[Compare grouped toolbar control states](?path=/story/components-toolbar--states)

[Base UI Toolbar](https://base-ui.com/react/components/toolbar) · [Radix Toolbar](https://www.radix-ui.com/primitives/docs/components/toolbar)
