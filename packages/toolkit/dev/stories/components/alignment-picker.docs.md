Alignment Picker sets the distribution and cross-axis alignment of children in a flex container. A spatial choice works well when people can see the layout they are adjusting.

Pass the actual flex direction so that a cell maps to the correct axes. Use `value` and `onValueChange` when another control can change the layout. Arrow keys follow the visual grid in either reading direction. In a right-to-left theme, the rightmost column is inline start. Custom labels receive logical `start`, `center`, and `end` positions.

```tsx
import { AlignmentPicker } from "@agent-native/toolkit/ui/base-ui/alignment-picker";

<AlignmentPicker
  aria-label="Item alignment"
  direction="row"
  defaultValue={{ justify: "center", align: "start" }}
/>;
```

[Radix Themes · Flex](https://www.radix-ui.com/themes/docs/components/flex)
