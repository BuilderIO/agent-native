ButtonLink gives a destination the visual prominence of an action. A link to a new feature in an announcement card can look like the card’s primary button while still supporting copying its URL and opening it in a new tab.

A router link can supply its own element through `render`. IconButtonLink uses the same navigation contract and needs an accessible label when its contents are only an icon.

```tsx
import { ButtonLink } from "@agent-native/toolkit/ui/base-ui/button";

<ButtonLink href="/design">Open Design</ButtonLink>;
```

[Radix Themes design reference](https://www.radix-ui.com/themes/docs/components/button)
