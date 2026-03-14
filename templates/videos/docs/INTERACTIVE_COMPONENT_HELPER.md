# Interactive Component Helper Guide

The `useInteractiveComponent` hook dramatically simplifies creating interactive elements by bundling all registration steps into a single API call.

---

## 🎯 The Problem It Solves

### Before (Manual Registration - ~50 lines per element):

```tsx
// Step 1: Define zone
const interactiveElements = createInteractiveElements([
  {
    id: "my-card",
    type: "card",
    label: "My Card",
    zone: { x: 100, y: 100, width: 200, height: 150 },
  },
]);

// Step 2: Get hover state
const myCardHover = useHoverAnimationSmooth(
  cursorHistory,
  interactiveElements[0].zone,
);

// Step 3: Register element
useRegisterInteractiveElement(
  { id: "my-card", type: "MyCard", label: "My Card", compositionId: "my-comp" },
  myCardHover,
);

// Step 4: Get context
const { getAnimationsForElement, addAnimation } = useCurrentElement();

// Step 5: Register animations
useEffect(() => {
  const existing = getAnimationsForElement("my-comp", "MyCard");
  if (existing.length === 0) {
    addAnimation("my-comp", {
      id: "mycard-hover-default",
      elementType: "MyCard",
      triggerType: "hover",
      duration: 6,
      easing: "expo.out",
      properties: [
        {
          property: "scale",
          keyframes: [
            { progress: 0, value: 1 },
            { progress: 1, value: 1.15 },
          ],
          unit: "",
        },
      ],
    });
  }
}, []);

// Step 6: Use the state
<div style={{ transform: `scale(${1 + myCardHover.hoverProgress * 0.15})` }}>
  My Card
</div>;
```

### After (Recommended with AnimatedElement! ✨):

```tsx
import { AnimatedElement } from "@/remotion/components/AnimatedElement";

const myCard = useInteractiveComponent({
  id: "my-card",
  elementType: "MyCard",
  label: "My Card",
  compositionId: "my-comp",
  zone: { x: 100, y: 100, width: 200, height: 150 },
  cursorHistory,
  interactiveElementType: "card", // Auto-infers cursor: "pointer"
  hoverAnimation: AnimationPresets.scaleHover(0.15),
});

registerForCursor(myCard);

<AnimatedElement interactive={myCard} as="div">
  My Card
</AnimatedElement>;
```

**Result:** ~50 lines → ~10 lines (**80% reduction**)
**Benefit:** ALL properties added via UI work automatically—no code changes needed!

---

## 📚 API Reference

### `useInteractiveComponent(options)`

Creates a fully-registered interactive element with automatic:

- Hover/click detection
- Sidebar registration
- Animation storage
- **Cursor type handling with reactivity** (user changes apply immediately!)

**Key Advantage:** Cursor types stored in localStorage are automatically read on every render via `useMemo`, making the hook fully reactive to user changes in the Properties panel. No manual `getCursorType()` calls needed!

#### Options

```typescript
{
  id: string;                    // Unique ID (e.g., "submit-btn")
  elementType: string;           // Type for animation lookup (e.g., "Button")
  label: string;                 // Display name in sidebar
  compositionId: string;         // Composition ID (e.g., "my-comp")
  zone: HoverZone;              // Hit area { x, y, width, height }
  cursorHistory: CursorFrame[]; // From useCursorHistory()
  hoverAnimation?: Animation;   // Optional hover animation
  clickAnimation?: Animation;   // Optional click animation

  // Cursor type handling (auto-managed!)
  cursorType?: "pointer" | "text" | "default";     // Override cursor type
  interactiveElementType?: InteractiveElementType; // Smart cursor inference
  // Examples: "button", "card", "input", "link", "toggle", "icon", "image"
}
```

**Cursor Type Inference:**

- If `cursorType` is provided → uses that
- Else if `interactiveElementType` is provided → infers from type:
  - `"button"`, `"card"`, `"link"`, `"toggle"`, `"icon"`, `"image"` → `"pointer"`
  - `"input"` → `"text"`
  - `"custom"` → `"default"`
- Else → defaults to `"pointer"`

#### Returns

```typescript
{
  hover: {
    isHovering: boolean;    // Currently hovering?
    progress: number;       // 0→1 smooth transition
  },
  click: {
    isClicking: boolean;    // Currently clicking?
    progress: number;       // 0→1→0 animation
  },
  combinedProgress: number; // max(hover, click)
  cursorType: string;       // Cursor type (e.g., "pointer")
  zone: HoverZone;         // Zone definition
}
```

---

## 🎨 Animation Presets

Built-in presets for common animation patterns:

### Scale Hover

```tsx
hoverAnimation: AnimationPresets.scaleHover(0.15);
// Scale from 1 → 1.15 on hover
```

### Lift Hover

```tsx
hoverAnimation: AnimationPresets.liftHover(20);
// Lifts up 20px with shadow on hover
```

### 3D Rotate Click

```tsx
clickAnimation: AnimationPresets.rotateClick(360);
// Rotates 360° on Y-axis when clicked
```

### Glow Hover

```tsx
hoverAnimation: AnimationPresets.glowHover(40);
// Adds 40px glowing shadow on hover
```

### Blur Click

```tsx
clickAnimation: AnimationPresets.blurClick(8);
// Applies 8px blur on click
```

### Color Shift Hover

```tsx
hoverAnimation: AnimationPresets.colorHover("#1e1e28", "#e64673");
// Shifts background color on hover
```

### Press Click

```tsx
clickAnimation: AnimationPresets.pressClick(0.95);
// Scales down to 0.95 on click (button press effect)
```

---

interactiveElementType: "button", // Auto cursor: "pointer"
hoverAnimation: AnimationPresets.scaleHover(0.1),
clickAnimation: AnimationPresets.pressClick(0.95),
});

return (
<button
style={{
      transform: `scale(${1 + submitBtn.hover.progress * 0.1})`,
      opacity: submitBtn.click.isClicking ? 0.8 : 1,
    }}

>

    Submit

  </button>
);
```

### Example 2: Text Input with Smart Cursor

````tsx
const emailInput = useInteractiveComponent({
  id: "email-input",
  elementType: "Input",
  label: "Email Input",
  compositionId: "form",
  zone: { x: 400, y: 500, width: 300, height: 40 },
  cursorHistory,
  interactiveElementType: "input", // Auto cursor: "text" ✨
  hoverAnimation: AnimationPresets.glowHover(20)lementType: "CustomCard",
  label: "Custom Card",
  compositionId: "demo",
  zone: { x: 200, y: 200, width: 300, height: 200 },
  cursorHistory,
  hoverAnimation: {
    duration: 12,
    easing: "back.out",
    properties: [
      { property: "scale", from: 1, to: 1.2, unit: "" },
      { propertCursor Aggregation (Automatic!)

```tsx
const card1 = useInteractiveComponent({
  id: "card-1",
  elementType: "Card",
  label: "Card 1",
  compositionId: "demo",
  zone: { x: 100, y: 100, width: 200, height: 150 },
  cursorHistory,
  interactiveElementType: "card",
  hoverAnimation: AnimationPresets.liftHover(15),
});

const card2 = useInteractiveComponent({
  id: "card-2",
  elementType: "Card",
  label: "Card 2",
  compositionId: "demo",
  zone: { x: 350, y: 100, width: 200, height: 150 },
  cursorHistory,
  interactiveElementType: "card",
  hoverAnimation: AnimationPresets.scaleHover(0.1),
});

// Aggregate cursor types - ONE LINE! ✨
const autoCursorType = useInteractiveComponentsCursor([card1, card2]);

return (
  <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
    {/* Your content */}
  </CameraHost>
     left: card.zone.x,
      top: card.zone.y,
      transform: `translateY(${-card.hover.progress * 15}px)`,
    }}
  >
    Card {i + 1}
  </div>
));
````

### Example 4: Empty State (No Initial Animations)

```tsx
// Registering element without initial animations
// User can add them later via the sidebar UI
const emptyCard = useInteractiveComponent({
  id: "empty-card",
  elementType: "EmptyCard",
  label: "Empty Card",
  compositionId: "demo",
  zone: { x: 400, y: 300, width: 200, height: 150 },
  cursorHistory,
  // No hoverAnimation or clickAnimation specified
});

// Element will appear in sidebar when hovered
// User can click "Add Hover" or "Add Click" to configure
```

---

## 🔧 Advanced Usage

### �️ API Reference

### Custom Cursor Types

```tsx
// Override with explicit cursor type
const customElement = useInteractiveComponent({
  id: "custom",
  elementType: "Custom",
  label: "Custom Element",
  compositionId: "demo",
  zone: { x: 400, y: 300, width: 200, height: 100 },
  cursorHistory,
  cursorType: "text", // Explicit override
  hoverAnimation: AnimationPresets.glowHover(30),
});
```

### `useInteractiveComponent(options)`

Returns `InteractiveComponentState`

### `useInteractiveComponentsCursor(components[])`

**Aggregates cursor types from multiple components** - replaces manual `useCursorTypeFromHover` calls!

```tsx
const autoCursorType = useInteractiveComponentsCursor([card1, card2, button1]);
// Returns: "pointer" | "text" | "default" | undefined
```

Pass to `CameraHost` for automatic cursor type switching:

```tsx
<CameraHost tracks={tracks} autoCursorType={autoCursorType}>
  {content}
</CameraHost>
```

---ations

```tsx
const dynamicCard = useInteractiveComponent({
  id: "dynamic-card",
  elementType: "DynamicCard",
  label: "Dynamic Card",
  compositionId: "demo",
  zone: { x: 300, y: 300, width: 200, height: 150 },
  cursorHistory,
  // Only add hover animation if condition is met
  hoverAnimation: shouldAnimate ? AnimationPresets.scaleHover(0.2) : undefined,
});
```

##Cursor handling | Manual (6+ lines) | Automatic (1 param) |
| Cursor aggregation | Manual array building | One function call |
| # Reading Stored Animations

```tsx
const { getAnimationsForElement } = useCurrentElement();

const card = useInteractiveComponent({
  id: "smart-card",
  elementType: "SmartCard",
  label: "Smart Card",
  compositionId: "demo",
  zone: { x: 200, y: 200, width: 250, height: 180 },
  cursorHistory,
  hoverAnimation: AnimationPresets.liftHover(20),
});

// Later, retrieve the stored animations
const storedAnimations = getAnimationsForElement("demo", "SmartCard");
console.log("User has configured:", storedAnimations);
```

---

## ⚡ Performance Considerations

### ✅ Do:

- Reuse `cursorHistory` across all components (call `useCursorHistory` once)
- Use animation presets when possible (pre-optimized)
- Define zones outside the component if they're static

### ❌ Don't:

- Call `useCursorHistory` multiple times (wasteful)
- Create new animation objects on every render (use useMemo if dynamic)
- Define zones inside loops without memoization

---

interactiveElementType: "card", // Auto cursor!
hoverAnimation: AnimationPresets.scaleHover(0.15),
});

// Cursor aggregation - one line!
const autoCursorType = useInteractiveComponentsCursor([element, ...others]# 🆚 Comparison Table

| Feature             | Manual Registration | useInteractiveComponent |
| ------------------- | ------------------- | ----------------------- |
| Lines of code       | ~50 per element     | ~10 per element         |
| Boilerplate         | High                | Minimal                 |
| Type safety         | Manual              | Automatic               |
| Animation presets   | Manual definition   | Built-in library        |
| Sidebar integration | Manual (6 steps)    | Automatic (1 call)      |
| Error-prone         | Yes                 | No                      |
| Beginner-friendly   | No                  | Yes                     |
| Flexibility         | Full                | Full                    |

---

## 🚀 Migration Guide

### Converting Existing Code

**Before:**

```tsx
// 1. Define interactive elements
const interactiveElements = createInteractiveElements([...]);

// 2. Get hover state
const hover = useHoverAnimationSmooth(cursorHistory, zone);

// 3. Register element
useRegisterInteractiveElement(info, hover);

// 4-5. Store animations in useEffect
useEffect(() => { /* ... */ }, []);
```

**After:**

```tsx
const element = useInteractiveComponent({
  id: "my-element",
  elementType: "MyElement",
  label: "My Element",
  compositionId: "my-comp",
  zone: { x: 100, y: 100, width: 200, height: 150 },
  cursorHistory,
  hoverAnimation: AnimationPresets.scaleHover(0.15),
});
```

**Steps:**

1. Remove `createInteractiveElements` call
2. Remove `useHoverAnimationSmooth` call
3. Remove `useRegisterInteractiveElement` call
4. Remove manual animation registration `useEffect`
5. Replace with single `useInteractiveComponent` call
6. Update references from `hover.hoverProgress` → `element.hover.progress`

---

## 📖 See Also

- [Cursor Type Editing](./CURSOR_TYPE_EDITING.md) - How to view and change cursor types in the UI
- [Cursor Integration Quick Reference](./CURSOR_INTEGRATION_QUICK_REF.md) - Quick guide to cursor handling
- [Interactive Elements Guide](./INTERACTIVE_ELEMENTS_GUIDE.md) - Detailed interactive elements documentation
- [Animation System Overview](./ANIMATION_SYSTEM_OVERVIEW.md) - How the animation system works
- [Cursor Animation Best Practices](./CURSOR_ANIMATION_BEST_PRACTICES.md) - Cursor system guidelines
- [SimplifiedPlayground.tsx](../client/remotion/compositions/SimplifiedPlayground.tsx) - Full working example

---

## 🎉 Summary

`useInteractiveComponent` reduces boilerplate by **80%** while maintaining full flexibility and type safety. Use it for all new interactive elements, and consider migrating existing code for improved maintainability.

**One line to rule them all!** ✨

---

## 🎨 AnimatedElement - Automatic Property Application

### The Problem with Manual Extraction

Even with `useInteractiveComponent`, manually extracting and applying properties is tedious:

```tsx
// ❌ OLD WAY - Manual extraction (verbose, error-prone)
const scale = (interactive.animatedProperties?.scale as number) ?? 1;
const lift = (interactive.animatedProperties?.lift as number) ?? 0;
const glow = (interactive.animatedProperties?.glow as number) ?? 0;
const bgColor = interactive.animatedProperties?.backgroundColor ?? "blue";

<div
  style={{
    transform: `scale(${scale}) translateY(${-lift}px)`,
    backgroundColor: bgColor,
    boxShadow: `0 ${lift}px ${glow}px rgba(0,0,0,0.3)`,
  }}
>
  Content
</div>;
```

**Problems:**

- Need to add code for every new property
- Users can't customize via UI without developer intervention
- Easy to forget properties or use wrong fallbacks
- Doesn't support ALL CSS properties

### The Solution: AnimatedElement

```tsx
import { AnimatedElement } from "@/remotion/components/AnimatedElement";

// ✅ NEW WAY - Automatic (works with ANY property!)
<AnimatedElement interactive={interactive} as="div">
  Content
</AnimatedElement>;
```

**Benefits:**

- ✅ **Zero property extraction code needed**
- ✅ **ALL properties work automatically** (scale, backgroundColor, borderRadius, blur, etc.)
- ✅ **Users can add ANY CSS property via UI** without code changes
- ✅ **Handles transforms, filters, and complex properties intelligently**
- ✅ **Avoids React shorthand/longhand conflicts**

### Supported Properties

AnimatedElement automatically applies **ALL** CSS properties:

**Transform:**

- `scale`, `translateX`, `translateY`, `rotate`, `rotateX`, `rotateY`, `skewX`, `skewY`

**Colors:**

- `backgroundColor`, `color`, `borderColor`, `borderTopColor`, `borderBottomColor`, etc.

**Filters:**

- `blur`, `brightness`, `contrast`, `saturate`, `hueRotate`

**Size & Spacing:**

- `width`, `height`, `padding`, `margin`, `paddingTop`, `marginLeft`, etc.

**Borders:**

- `borderWidth`, `borderRadius`, `borderTopWidth`, `borderStyle`, etc.

**Effects:**

- `boxShadow`, `opacity`

**+ ANY other CSS property!**

### Usage Pattern

```tsx
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";

export const MyComponent = ({ cursorHistory, registerForCursor }) => {
  const button = useInteractiveComponent({
    id: "my-button",
    elementType: "Button",
    label: "My Button",
    compositionId: "my-comp",
    zone: { x: 100, y: 100, width: 200, height: 60 },
    cursorHistory,
    interactiveElementType: "button",
  });

  React.useEffect(() => {
    registerForCursor(button);
  }, [button.hover.isHovering, button.click.isClicking]);

  return (
    <AnimatedElement
      interactive={button}
      as="button"
      style={{
        position: "absolute",
        left: 100,
        top: 100,
        backgroundColor: "#6366f1",
        // AnimatedElement automatically applies scale, translateY, etc. from animations!
      }}
    >
      Click Me
    </AnimatedElement>
  );
};
```

### When to Use Manual Extraction

Only extract properties manually when you need custom logic:

```tsx
// Extract glow for child element effects
const glow = (interactive.animatedProperties?.glow as number) ?? 0;

<AnimatedElement interactive={interactive} as="div">
  <div
    style={{
      // Use glow value for icon shadow
      filter: `drop-shadow(0 0 ${glow}px blue)`,
    }}
  >
    🎨
  </div>
</AnimatedElement>;
```

### Best Practices

1. **Always use AnimatedElement by default** - manual extraction is the exception, not the rule
2. **Avoid shorthand properties** in static styles (use `borderWidth` not `border`)
3. **Let users customize via UI** - don't hardcode what could be animated
4. **Provide sensible base styles** - AnimatedElement enhances, doesn't replace them

---

## 🚀 Recommended Pattern (2024+)

**This is the current best practice for ALL interactive components:**

```tsx
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";

export const MyInteractiveElement = ({
  cursorHistory,
  registerForCursor,
  ...props
}) => {
  // 1. Create interactive component
  const interactive = useInteractiveComponent({
    id: props.id,
    elementType: "MyElement",
    label: props.label,
    compositionId: props.compositionId,
    zone: { x: props.x, y: props.y, width: props.width, height: props.height },
    cursorHistory,
    interactiveElementType: "button",
  });

  // 2. Register for cursor
  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  // 3. Render with AnimatedElement - ALL properties work automatically!
  return (
    <AnimatedElement
      interactive={interactive}
      as="div"
      style={{ ...baseStyles }}
    >
      {props.children}
    </AnimatedElement>
  );
};
```

**See Examples:**

- `client/remotion/ui-components/InteractiveButton.tsx` - Updated example
- `client/remotion/ui-components/InteractiveCard.tsx` - Updated example
- `.builder/ANIMATED_PROPERTIES.md` - Full property documentation
