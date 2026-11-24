Use `PropertyNumber` for a single editable measure and `LayoutDimensions` for a width and height that can share an aspect-ratio lock. Supply `null` for a mixed dimension and `"mixed"` for differing lock states. A mixed value stays distinguishable from zero.

```tsx
import { LayoutDimensions } from "@agent-native/toolkit/ui/base-ui/layout-properties";

<LayoutDimensions
  width={width}
  height={height}
  locked={locked}
  onLockChange={setLocked}
  onEdit={editSelection}
/>;
```

Both axes must fit the size limits at the chosen ratio. A zero-width or zero-height frame can keep an existing ratio but cannot define a new one. For mixed dimensions, pass `lockDisabled` when any unlocked target fails `canLockAspectRatio(width, height, limits)`.

Drag a numeric prefix one pixel per step for fine adjustments. In `onEdit`, apply previews to the geometries captured at the start of the gesture. Use `resizeLayout` on each target so a locked frame keeps its own aspect ratio. Write one history entry on commit and discard the preview on cancel. When switching selections, key the fields by selection identity so an unfinished edit cannot affect a new target.

Compose `AutoLayoutControls` when the selection also supports flow, alignment, gaps and padding. Provide full field labels for short visual prefixes such as W and H. The validation example keeps invalid input editable so someone can correct it from the keyboard.

See [Number Field](?path=/docs/components-number-field--docs) for numeric input, stepping and scrubbing.

Pass `locale` to match the user's number format. With `de-DE`, typing `-8,75` commits the number `-8.75`. [Try localized input](?path=/story/patterns-layout-properties--localized-position-field).
