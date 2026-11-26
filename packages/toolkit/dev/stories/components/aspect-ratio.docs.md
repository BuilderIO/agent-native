Aspect Ratio reserves a predictable shape for images, videos, and thumbnails before their pixels arrive. Use it in a responsive card grid where the available width changes.

The ratio is width divided by height and must be positive and finite. The child owns cropping and alternative text. Use `object-contain` when cropping would remove meaningful content.

```tsx
import { AspectRatio } from "@agent-native/toolkit/ui/base-ui/aspect-ratio";

<AspectRatio ratio={16 / 9}>
  <img
    src="/cover.webp"
    alt="Paper sculpture"
    className="h-full w-full object-cover"
  />
</AspectRatio>;
```

[Radix Themes · Aspect Ratio](https://www.radix-ui.com/themes/docs/components/aspect-ratio)
