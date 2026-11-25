Grid Size Picker sets columns and rows from a compact popover. The matrix gives a quick spatial preview, and number fields allow precise input.

Use `rows: "auto"` when content determines the row count. Controlled hosts receive the full pair through `onValueChange`. Arrow keys preview a size. Home and End move to the first and last columns in the row. Ctrl+Home and Ctrl+End reach the corners. Enter or Space applies the size.

The `labels` prop translates the popup and its controls. Supply `onOpenSettings` when more grid options are available.

```tsx
import { GridSizePicker } from "@agent-native/toolkit/ui/base-ui/grid-size-picker";

<GridSizePicker
  aria-label="Grid size"
  defaultValue={{ columns: 3, rows: "auto" }}
/>;
```

[Base UI · Popover](https://base-ui.com/react/components/popover)
