# Cursor Integration - Quick Reference

## 🎯 Automatic Cursor Handling

The `useInteractiveComponent` hook now handles cursor types automatically!

---

## Basic Usage

```tsx
const myButton = useInteractiveComponent({
  id: "submit-btn",
  elementType: "Button",
  label: "Submit Button",
  compositionId: "my-comp",
  zone: { x: 100, y: 100, width: 200, height: 50 },
  cursorHistory,

  // ✨ Smart cursor inference
  interactiveElementType: "button", // → cursor: "pointer"

  hoverAnimation: AnimationPresets.scaleHover(0.1),
});
```

---

## Cursor Type Inference

### Automatic (Recommended)

Use `interactiveElementType` for smart defaults:

| Element Type | Cursor Type |
| ------------ | ----------- |
| `"button"`   | `"pointer"` |
| `"card"`     | `"pointer"` |
| `"link"`     | `"pointer"` |
| `"toggle"`   | `"pointer"` |
| `"icon"`     | `"pointer"` |
| `"image"`    | `"pointer"` |
| `"input"`    | `"text"` ✏️ |
| `"custom"`   | `"default"` |

### Manual Override

```tsx
useInteractiveComponent({
  // ... other options
  cursorType: "text", // Explicit override
});
```

---

## Cursor Aggregation

### Old Way ❌

```tsx
// Manual array building - tedious!
const autoCursorType = useCursorTypeFromHover([
  { isHovering: card1.hover.isHovering, cursorType: "pointer" },
  { isHovering: card2.hover.isHovering, cursorType: "pointer" },
  { isHovering: input.hover.isHovering, cursorType: "text" },
]);
```

### New Way ✅

```tsx
// One line - automatic!
const autoCursorType = useInteractiveComponentsCursor([card1, card2, input]);
```

---

## Complete Example

```tsx
import {
  useInteractiveComponent,
  useInteractiveComponentsCursor,
  AnimationPresets,
} from "@/remotion/hooks/useInteractiveComponent";

export const MyComp = ({ tracks }) => {
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Create interactive elements
  const submitBtn = useInteractiveComponent({
    id: "submit",
    elementType: "SubmitButton",
    label: "Submit",
    compositionId: "my-form",
    zone: { x: 400, y: 600, width: 120, height: 40 },
    cursorHistory,
    interactiveElementType: "button", // → "pointer"
    hoverAnimation: AnimationPresets.scaleHover(0.1),
    clickAnimation: AnimationPresets.pressClick(0.95),
  });

  const emailInput = useInteractiveComponent({
    id: "email",
    elementType: "EmailInput",
    label: "Email",
    compositionId: "my-form",
    zone: { x: 400, y: 500, width: 300, height: 40 },
    cursorHistory,
    interactiveElementType: "input", // → "text"
    hoverAnimation: AnimationPresets.glowHover(20),
  });

  // Aggregate cursor types
  const autoCursorType = useInteractiveComponentsCursor([
    submitBtn,
    emailInput,
  ]);

  return (
    <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
      {/* Your UI */}
    </CameraHost>
  );
};
```

---

## Benefits

✅ **No manual cursor type mapping** - inferred from element type  
✅ **One-line aggregation** - replaces verbose array building  
✅ **Type-safe** - TypeScript catches incorrect cursor types  
✅ **Consistent** - follows standard UI cursor conventions  
✅ **Flexible** - override when needed with explicit `cursorType`

---

## Priority Order

```
Explicit cursorType
    ↓
interactiveElementType inference
    ↓
Default: "pointer"
```

---

## See Also

- [Interactive Component Helper Guide](./INTERACTIVE_COMPONENT_HELPER.md) - Full documentation
- [SimplifiedPlayground.tsx](../app/remotion/compositions/SimplifiedPlayground.tsx) - Working example
- [Cursor Animation Best Practices](./CURSOR_ANIMATION_BEST_PRACTICES.md) - Cursor system guide
