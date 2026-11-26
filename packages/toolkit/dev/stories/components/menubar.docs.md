Use a menubar for a persistent command strip in a workbench. Group commands by the user's mental model, such as File, Edit and View. It suits an editor where people repeatedly move among neighboring menus with the keyboard.

Place one `MenubarMenu` per group inside a named `Menubar`. Pair each `MenubarTrigger` with its popup, then compose commands, checkbox items or radio groups. Base UI coordinates focus between neighboring triggers and handles arrow-key navigation within each menu.

Use `MenubarLinkItem` for destinations such as settings or documentation.

Keep each command callback in the editor's command layer. A displayed `MenubarShortcut` is a visual hint. Its keyboard shortcut needs to call the same command separately.

```tsx
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarPopup,
  MenubarItem,
} from "@agent-native/toolkit/ui/base-ui/menubar";

export function DocumentCommands({
  save,
  undo,
}: {
  save: () => void;
  undo: () => void;
}) {
  return (
    <Menubar aria-label="Document commands">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarPopup>
          <MenubarItem onClick={save}>Save version</MenubarItem>
        </MenubarPopup>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarPopup>
          <MenubarItem onClick={undo}>Undo</MenubarItem>
        </MenubarPopup>
      </MenubarMenu>
    </Menubar>
  );
}
```

[Explore neighboring command menus](?path=/story/components-menubar--playground)

[Base UI Menubar](https://base-ui.com/react/components/menubar) · [Radix Menubar](https://www.radix-ui.com/primitives/docs/components/menubar)
