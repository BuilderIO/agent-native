A Skeleton reserves the shape of content while it is loading. Matching the final geometry keeps nearby controls from shifting when a response arrives.

Wrap representative text or an element with the expected dimensions, then set `loading` to false when its content is ready. The loading placeholder is inert and hidden from assistive technology. Put a loading announcement on the enclosing region if needed.

```tsx
import { Skeleton } from "@agent-native/toolkit/ui/base-ui/skeleton";

<Skeleton loading={true}>Research workspace</Skeleton>;
```

[Radix Themes · Skeleton](https://www.radix-ui.com/themes/docs/components/skeleton)
