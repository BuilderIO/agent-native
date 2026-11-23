Set how a layer resizes with its parent. Use `ConstraintControls` inline or `ConstraintPicker` in a compact popover.

```tsx
import { useState } from "react";
import {
  ConstraintControls,
  type LayerConstraints,
} from "@agent-native/toolkit/ui/base-ui/constraint-controls";

export function LayerPins() {
  const [value, setValue] = useState<LayerConstraints>({
    horizontal: "left",
    vertical: "top",
  });
  return (
    <ConstraintControls
      value={value}
      onChange={(change) => setValue((current) => ({ ...current, ...change }))}
    />
  );
}
```

**Behavior**

- Pin one edge to keep its inset. Pin both edges to stretch.
- Choose **Center** to keep the offset from the center, or **Scale** to resize proportionally.
- Each edit changes one axis. Apply it to every selected layer to preserve differences on the other axis.

**Accessibility**

Each pin supports Enter and Space. Left and right always refer to physical edges. Pass translated `labels` for the controls. When composing a trigger with `ConstraintPreview`, give the trigger an accessible name.
