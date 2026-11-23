A Callout keeps an important message beside the work it affects. Use it for guidance or a recoverable problem that people may need to read again.

Add a decorative `CalloutIcon` and put a recovery control such as Retry in `CalloutActions`. The root is a div. Choose live announcement behavior only when a newly inserted message needs immediate attention.

```tsx
import { Callout, CalloutText } from "@agent-native/toolkit/ui/base-ui/callout";

<Callout color="warning">
  <CalloutText>
    Your changes are saved locally while you are offline.
  </CalloutText>
</Callout>;
```

[Radix Themes · Callout](https://www.radix-ui.com/themes/docs/components/callout)
