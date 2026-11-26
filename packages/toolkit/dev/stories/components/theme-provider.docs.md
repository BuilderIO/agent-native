Use ThemeProvider to theme an app or a region. Nested providers inherit each setting you omit.

```tsx
import "@agent-native/design-system/tokens.css";
import "@agent-native/design-system/styles.css";
import "@agent-native/design-system/themes/design.css";
import { ThemeProvider } from "@agent-native/toolkit/ui/base-ui/theme-provider";
import { Button } from "@agent-native/toolkit/ui/base-ui/button";

<ThemeProvider appTheme="design" appearance="dark" density="compact">
  <Button>Apply</Button>
  <ThemeProvider appearance="light" render={<section aria-label="Preview" />}>
    <Button>Preview changes</Button>
  </ThemeProvider>
</ThemeProvider>;
```

Load the styles once at the app entry point. The theme stylesheet must match `appTheme`. In the example, the preview switches to light mode and keeps the compact density.

Use `appearance="system"` to follow the device setting, including changes while a popup is open. The server-rendered region inherits its surrounding appearance until the browser resolves the preference. [System appearance](?path=/story/components-theme-provider--system-appearance)

## Customization

- Override a single token with `style`. For a reusable palette, register its CSS with `paletteCss(createPalette(colors), { id })` and pass the same ID to `palette`.
- Set `dir="rtl"` for right-to-left layout and keyboard navigation. Use `dir="auto"` when the region’s content determines its reading direction. [Reading direction](?path=/story/components-theme-provider--reading-direction)
- Use `render` to replace the default div with a semantic element. The provider forwards its ref and renders explicit settings in the server HTML.

## Overlays

Menus and dialogs inherit the region’s theme and update while open. Pass a popup `container` to choose a different portal host.

[Nested themes](?path=/docs/patterns-themed-inspector--docs) · [Dialog with a custom container](?path=/story/components-theme-provider--initial-dialog)
