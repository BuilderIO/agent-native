Use a collapsible for one optional region of a page, such as the individual padding values beneath a summary. It leaves the editing context in place and gives the region one named disclosure button.

Compose `CollapsibleTrigger` with a Button through `render`. Base UI maintains the expanded state and panel association. Keep the visible button label meaningful in both states. Enter and Space toggle the region.

Use `defaultOpen` for an initial preference. For a view that restores a saved preference, pass `open` and `onOpenChange` to `Collapsible`. The States story shows independent open and closed regions.

```tsx
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@agent-native/toolkit/ui/base-ui/collapsible";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

export function PaddingDetails() {
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" color="gray" />}>
        Individual padding
      </CollapsibleTrigger>
      <CollapsiblePanel>Top 8 · Right 16 · Bottom 8 · Left 16</CollapsiblePanel>
    </Collapsible>
  );
}
```

[Compare independent disclosure states](?path=/story/components-collapsible--states)

[Base UI Collapsible](https://base-ui.com/react/components/collapsible) · [Radix Collapsible](https://www.radix-ui.com/primitives/docs/components/collapsible)
