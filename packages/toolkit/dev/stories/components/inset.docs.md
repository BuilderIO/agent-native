Inset lets one part of a padded card reach its edge. Use it for a cover image or table while keeping the surrounding text aligned to the card padding.

Choose the edge with `side`. Use the Clip story to inspect how media meets rounded corners. Keep text and focusable controls outside a clipped media region when they need their own padding.

```tsx
import { Card } from "@agent-native/toolkit/ui/base-ui/card";
import { Inset } from "@agent-native/toolkit/ui/base-ui/inset";

<Card>
  <Inset side="top">
    <img src="/cover.webp" alt="" />
  </Inset>
  <p>Paper studies</p>
</Card>;
```

[Radix Themes · Inset](https://www.radix-ui.com/themes/docs/components/inset)
