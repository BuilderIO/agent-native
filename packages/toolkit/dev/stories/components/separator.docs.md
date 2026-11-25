A Separator marks a boundary between neighboring groups. Use it when spacing alone makes the end of one set of commands or content unclear.

Choose the orientation that matches the drawn line. A vertical separator needs height from its container. For a boundary the user can drag to resize panels, use Split Pane, which supplies focus and keyboard resizing.

```tsx
import { Inline } from "@agent-native/toolkit/ui/base-ui/layout";
import { Separator } from "@agent-native/toolkit/ui/base-ui/separator";

<Inline gap={2} render={<nav aria-label="Project" />}>
  <a href="/projects/research">Overview</a>
  <Separator orientation="vertical" />
  <a href="/projects/research/activity">Activity</a>
</Inline>;
```

[Base UI · Separator](https://base-ui.com/react/components/separator)
