Use a drawer for a task anchored to an edge, such as choosing a destination folder on a phone or inspecting history beside a canvas. Its position communicates where the surface will return when dismissed.

Set `side` on `Drawer`. The root coordinates the placement and swipe direction. `DrawerPopup` composes the portal and modal surface. Name the drawer with `DrawerTitle` and use `DrawerDescription` for relevant instructions. Include a labeled close action so the workflow works with a keyboard as well as a swipe.

For a form, keep the drawer open until submission succeeds. A Save button in `DrawerFooter` can reference the form by ID. Use `DrawerClose` for Cancel. Both `DrawerHeader` and `DrawerFooter` accept a custom element through `render`. [Try the drawer form](?path=/story/components-drawer--playground)

```tsx
import {
  Drawer,
  DrawerTrigger,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@agent-native/toolkit/ui/base-ui/drawer";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

export function FrameHistory() {
  return (
    <Drawer side="right">
      <DrawerTrigger render={<Button variant="surface" />}>
        History
      </DrawerTrigger>
      <DrawerPopup>
        <DrawerTitle>Frame history</DrawerTitle>
        <DrawerDescription>Changes to the selected frame.</DrawerDescription>
        <ol>
          <li>Width changed to 640 px</li>
        </ol>
        <DrawerFooter>
          <DrawerClose render={<Button variant="surface" />}>Done</DrawerClose>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}
```

[Try drawers from all four edges](?path=/story/components-drawer--sides)

[Base UI Drawer](https://base-ui.com/react/components/drawer)
