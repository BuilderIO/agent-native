An IconButton gives a compact action a full button target. It suits repeated row actions such as archiving a thread, where a text label on every row would compete with the content.

The accessible name describes the action and, when needed, its target. A tooltip can explain an unfamiliar icon to a sighted reader. Loading and disabled states keep the action unavailable to both pointer and keyboard users.

```tsx
import { IconButton } from "@agent-native/toolkit/ui/base-ui/button";
import { IconArchive } from "@tabler/icons-react";

<IconButton aria-label="Archive thread" variant="ghost" onClick={archiveThread}>
  <IconArchive aria-hidden />
</IconButton>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/icon-button)
