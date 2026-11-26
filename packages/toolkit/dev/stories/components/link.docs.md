Link marks a destination inside prose, a help panel or a list. The link text should identify the destination when read on its own. Its underline treatment can follow the surrounding typography.

An `href` preserves browser navigation, focus and the link context menu. The `render` prop can integrate a router component that forwards those anchor props.

```tsx
import { Link } from "@agent-native/toolkit/ui/base-ui/link";

<Link href="/settings/billing">Billing settings</Link>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/link)
