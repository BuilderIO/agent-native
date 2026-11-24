Use a Toggle for a reversible action, such as bold formatting. Keep its accessible name stable and label icon-only toggles.

Bind `pressed` to the current selection so keyboard shortcuts and toolbar actions stay in sync. For a mixed selection, set `aria-pressed="mixed"` and `pressed={false}`. The first activation applies the option to the whole selection.

```tsx
import { Toggle } from "@agent-native/toolkit/ui/base-ui/toggle";
import { IconBold } from "@tabler/icons-react";

<Toggle aria-label="Bold" pressed={bold} onPressedChange={setBold}>
  <IconBold aria-hidden />
</Toggle>;
```

[Base UI behavior and API](https://base-ui.com/react/components/toggle)
