A Color Swatch displays a paint value against a transparency grid. Use it beside a color name or input when alpha is meaningful.

The value accepts a CSS color, including a token or translucent color. A swatch inside a labeled button can be decorative. The button owns focus and opens the color picker.

```tsx
import { ColorSwatch } from "@agent-native/toolkit/ui/base-ui/color-swatch";

<ColorSwatch value="var(--brand-9)" role="img" aria-label="Brand accent" />;
```

[Radix Themes · Color](https://www.radix-ui.com/themes/docs/theme/color)
