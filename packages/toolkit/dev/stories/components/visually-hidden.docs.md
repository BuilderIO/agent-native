Visually Hidden supplies text to assistive technology without adding a visible label. It is useful for a compact icon action whose purpose would otherwise be lost.

Keep the hidden text inside the element it names. Choose one accessible name for an icon control. Put instructions on screen when sighted keyboard users also need them.

```tsx
import { VisuallyHidden } from "@agent-native/toolkit/ui/base-ui/visually-hidden";

<button type="button">
  <span aria-hidden="true">×</span>
  <VisuallyHidden>Close preview</VisuallyHidden>
</button>;
```

[Radix Themes · Visually Hidden](https://www.radix-ui.com/themes/docs/components/visually-hidden)
