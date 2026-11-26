Use a ThemeProvider for each region when one document hosts panels with different themes or densities. Overlays opened inside the region retain its styles. A dark library can sit beside a light design surface, each with its own size and spacing preferences.

```tsx
import { ThemeProvider } from "@agent-native/toolkit/ui/base-ui/theme-provider";

<ThemeProvider appTheme="design" density="compact" appearance="light">
  {children}
</ThemeProvider>;
```

Two Applications renders the same inspector twice. Each instance has its own theme, density and edited values. In Nested Overlays, open Frame settings, open Aspect ratio and choose a value from the select. Escape dismisses the active overlay first. Give each trigger an accessible name and each dialog or popover a title so keyboard users can identify the current layer. [Radix Themes setup](https://www.radix-ui.com/themes/docs/overview/getting-started)

See [Popover](?path=/docs/components-popover--docs) for composing the trigger and its portaled popup.
