Text sets body copy, labels and supporting text using the theme’s type scale. Use a semantic text style to keep related copy consistent across surfaces.

Choose the element according to its role in the document. Use `as="p"` for a paragraph and Heading for a section title. Check narrow widths before adding truncation, especially when a full name distinguishes one resource from another.

```tsx
import { Text } from "@agent-native/toolkit/ui/base-ui/text";

<Text as="p" textStyle="body">
  Your recording is ready.
</Text>;
```

[Radix Themes · Text](https://www.radix-ui.com/themes/docs/components/text)
