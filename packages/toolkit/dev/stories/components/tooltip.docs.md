Use a tooltip for a short explanation of a control or its keyboard shortcut. An icon-only button still needs an accessible name on the button itself. Keep required instructions and links in the surrounding interface where users can read and operate them directly.

Compose `TooltipTrigger` with the actual control through `render`, then put plain text in `TooltipPopup`. The tooltip appears on hover or keyboard-visible focus and closes on Escape. Popup placement can be adjusted with `side` and `sideOffset`. Logical sides let a tooltip follow the interface direction.

Wrap related controls in `TooltipProvider` when they should share opening delay. A themed `OverlayScope` keeps portaled tooltip colors and type in the same region as the trigger.

```tsx
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@agent-native/toolkit/ui/base-ui/tooltip";
import { IconButton } from "@agent-native/toolkit/ui/base-ui/button";
import { IconEye } from "@tabler/icons-react";

export function LayerVisibility({ toggle }: { toggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton aria-label="Toggle layer visibility" onClick={toggle}>
            <IconEye aria-hidden />
          </IconButton>
        }
      />
      <TooltipPopup side="top">Toggle layer visibility</TooltipPopup>
    </Tooltip>
  );
}
```

[Compare shortcut labels and wrapping text](?path=/story/components-tooltip--states)

[Base UI Tooltip](https://base-ui.com/react/components/tooltip) · [Radix Tooltip](https://www.radix-ui.com/themes/docs/components/tooltip)
