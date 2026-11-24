A Card groups content that describes a single thing, such as a project or saved view. Decide whether the surface is for reading, navigation or a command before choosing its element.

The default surface is static. A linked card uses native link navigation and needs a meaningful name. When a card has independent actions, keep the container static and place links or buttons inside. Compose `Inset` for edge-to-edge media.

```tsx
import { Card } from "@agent-native/toolkit/ui/base-ui/card";

<Card render={<a href="/projects/research" />}>Research workspace</Card>;
```

[Radix Themes · Card](https://www.radix-ui.com/themes/docs/components/card)
