# Interactive Elements Guide

Complete guide for making UI elements interactive with cursor hover and click animations.

---

## 💡 Recommended Approach

**For most use cases, use the `useInteractiveComponent` helper hook** — it handles all registration, cursor types, and animation storage automatically with minimal code.

**Use the manual registration pattern below only when you need:**

- Fine-grained control over hover detection timing
- Custom cursor type logic beyond storage-based overrides
- Direct access to hover state for complex interactions

See [Interactive Component Helper Guide](./INTERACTIVE_COMPONENT_HELPER.md) for the recommended pattern.

---

## 🎯 Core Principle

**Every interactive UI element should be registered for cursor interactions.**

Even if you don't animate it immediately, registering elements as interactive:

- ✅ Makes them discoverable in the timeline
- ✅ Allows adding cursor animations later without code changes
- ✅ Provides consistent interaction patterns
- ✅ Enables hover/click state in Properties panel

---

## Quick Start

### 1. Define Interactive Elements

```typescript
import { createInteractiveElements } from "@/remotion/utils/interactiveElements";

// Define all interactive elements in your composition
const interactiveElements = createInteractiveElements([
  {
    id: "submit-btn",
    type: "button",
    label: "Submit Button",
    zone: { x: 500, y: 600, width: 120, height: 40 },
  },
  {
    id: "email-input",
    type: "input",
    label: "Email Input",
    zone: { x: 300, y: 400, width: 400, height: 60 },
  },
  {
    id: "learn-more-link",
    type: "link",
    label: "Learn More",
    zone: { x: 600, y: 800, width: 150, height: 30 },
  },
]);
```

### 2. Register with Cursor History

**⚠️ IMPORTANT: For reactive cursor types, read from storage and pass to hover zones.**

```typescript
import { useCurrentElement } from "@/contexts/CurrentElementContext";
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";
import { useRegisterInteractiveElement } from "@/remotion/hooks/useRegisterInteractiveElement";

export const MyComposition: React.FC<Props> = ({ tracks }) => {
  // Get cursor history
  const cursorTrack = findTrack(tracks, "cursor");
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Get cursor type storage (enables reactivity to user changes)
  const { getCursorType } = useCurrentElement();

  // Read stored cursor types for each element (with fallback to inferred)
  const submitBtnCursor = getCursorType("my-comp", "submit-btn") || "pointer";
  const emailInputCursor = getCursorType("my-comp", "email-input") || "text";
  const learnMoreCursor = getCursorType("my-comp", "learn-more-link") || "pointer";

  // Register each element for hover detection (pass cursor type in zone!)
  const submitBtnHover = useHoverAnimationSmooth(
    cursorHistory,
    { ...interactiveElements[0].zone, cursorType: submitBtnCursor }
  );

  const emailInputHover = useHoverAnimationSmooth(
    cursorHistory,
    { ...interactiveElements[1].zone, cursorType: emailInputCursor }
  );

  const learnMoreHover = useHoverAnimationSmooth(
    cursorHistory,
    { ...interactiveElements[2].zone, cursorType: learnMoreCursor }
  );

  // Register for properties panel (with cursor types)
  useRegisterInteractiveElement(
    {
      id: "submit-btn",
      type: "button",
      label: "Submit Button",
      compositionId: "my-comp",
      cursorType: submitBtnCursor,
    },
    submitBtnHover
  );

  // ... register other elements similarly

  // Aggregate cursor types (last hovered wins)
  const autoCursorType = useCursorTypeFromHover([
    submitBtnHover,
    emailInputHover,
    learnMoreHover,
  ]);

  return (
    <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
      {/* Your UI */}
    </CameraHost>
  );
};
```

**Critical steps for reactivity:**

1. ✅ Extract `getCursorType` from `useCurrentElement()`
2. ✅ Read cursor type for each element: `getCursorType(compId, elementType)`
3. ✅ Pass cursor type to **hover zone** (not just registration): `{ ...zone, cursorType }`
4. ✅ Pass cursor type to registration for UI display
5. ✅ Aggregate with `useCursorTypeFromHover()`
6. ✅ Pass `autoCursorType` to `<CameraHost>`

**Why cursor types must be in hover zones:**

- Hover zones compute `desiredCursorType` based on `zone.cursorType`
- `useCursorTypeFromHover()` reads `desiredCursorType` from hover results
- Without cursor type in zone, `desiredCursorType` is always undefined
- Result: cursor changes in UI won't apply to preview

### 3. Use Interaction State

```typescript
// Use hover state for visual feedback
<button
  style={{
    transform: `scale(${submitBtnHover.isHovering ? 1.05 : 1})`,
    opacity: submitBtnHover.isClicking ? 0.8 : 1,
  }}
>
  Submit
</button>
```

---

## Element Types

### Button

```typescript
{ type: "button", cursorType: "pointer" }
```

Use for: Buttons, CTAs, submit buttons, action buttons

### Input

```typescript
{ type: "input", cursorType: "text" }
```

Use for: Text inputs, textareas, search fields, editable areas

### Link

```typescript
{ type: "link", cursorType: "pointer" }
```

Use for: Links, navigation items, anchor elements

### Card

```typescript
{ type: "card", cursorType: "pointer" }
```

Use for: Clickable cards, tiles, product cards

### Toggle

```typescript
{ type: "toggle", cursorType: "pointer" }
```

Use for: Switches, checkboxes, radio buttons, toggles

### Icon

```typescript
{ type: "icon", cursorType: "pointer" }
```

Use for: Icon buttons, action icons, interactive symbols

### Image

```typescript
{ type: "image", cursorType: "pointer" }
```

Use for: Clickable images, thumbnails, galleries

### Custom

```typescript
{ type: "custom", cursorType: "pointer" } // specify your own
```

Use for: Custom interactive elements

---

## Detecting Clicks

### Method 1: Using findClickInElement Utility

```typescript
import { findClickInElement } from "@/remotion/utils/interactiveElements";

// Check if element was clicked in a frame range
const clickFrame = findClickInElement(
  cursorTrack,
  { x: 500, y: 600, width: 120, height: 40 },
  { startFrame: 100, endFrame: 200 },
);

if (clickFrame) {
  // Button was clicked at frame {clickFrame}
  const isAfterClick = frame >= clickFrame;
  const morphProgress = isAfterClick
    ? Math.min(1, (frame - clickFrame) / 12)
    : 0;
}
```

### Method 2: Using InteractiveElement Component

```typescript
import { InteractiveElement } from "@/remotion/components/InteractiveElement";

<InteractiveElement
  id="submit-btn"
  type="button"
  label="Submit Button"
  cursorHistory={cursorHistory}
  zone={{ x: 500, y: 600, width: 120, height: 40 }}
  onClick={(frame) => console.log(`Clicked at frame ${frame}`)}
>
  {({ isHovering, isClicking, hoverProgress }) => (
    <div style={{
      transform: `scale(${isClicking ? 0.95 : isHovering ? 1.05 : 1})`,
      transition: `transform ${hoverProgress * 200}ms`,
    }}>
      Submit
    </div>
  )}
</InteractiveElement>
```

---

## Best Practices

### ✅ DO: Register All Interactive Elements

```typescript
// Even if not animating now, register elements as interactive
const allInteractiveElements = createInteractiveElements([
  { id: "btn-1", type: "button", label: "Primary CTA", zone: {...} },
  { id: "btn-2", type: "button", label: "Secondary CTA", zone: {...} },
  { id: "input-1", type: "input", label: "Search", zone: {...} },
  { id: "link-1", type: "link", label: "Learn More", zone: {...} },
  { id: "icon-1", type: "icon", label: "Settings", zone: {...} },
]);
```

### ✅ DO: Use Semantic Element Types

```typescript
// Good - semantic types
{
  type: "button";
} // For buttons
{
  type: "input";
} // For text inputs
{
  type: "link";
} // For links

// Bad - everything as "custom"
{
  type: "custom";
} // Loses semantic meaning
```

### ✅ DO: Add Padding for Better UX

```typescript
// Padding makes elements easier to interact with
{
  zone: {
    x: 500, y: 600, width: 120, height: 40,
    padding: 8  // Cursor activates 8px before touching element
  }
}
```

### ✅ DO: Use Hover States for Visual Feedback

```typescript
<button style={{
  transform: `scale(${isHovering ? 1.05 : 1})`,
  backgroundColor: isHovering ? "#0066cc" : "#0052a3",
}}>
  Hover me
</button>
```

### ❌ DON'T: Hardcode Click Detection

```typescript
// Bad - hardcoded frame numbers
const wasClicked = frame >= 150;

// Good - detect clicks from cursor track
const clickFrame = findClickInElement(cursorTrack, zone);
const wasClicked = clickFrame ? frame >= clickFrame : false;
```

### ❌ DON'T: Skip Registration for "Simple" Elements

```typescript
// Bad - unregistered button
<button>Click me</button>  // No hover zone!

// Good - always register
const btnHover = useHoverAnimationSmooth(cursorHistory, btnZone, { cursorType: "pointer" });
<button style={{ transform: `scale(${btnHover.isHovering ? 1.05 : 1})` }}>Click me</button>
```

---

## Complete Example: Form Composition

```typescript
import { createInteractiveElements, findClickInElement } from "@/remotion/utils/interactiveElements";
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";

const INTERACTIVE_ELEMENTS = createInteractiveElements([
  { id: "name-input", type: "input", label: "Name", zone: { x: 300, y: 200, width: 400, height: 60 } },
  { id: "email-input", type: "input", label: "Email", zone: { x: 300, y: 280, width: 400, height: 60 } },
  { id: "submit-btn", type: "button", label: "Submit", zone: { x: 450, y: 360, width: 120, height: 45 } },
]);

export const FormComposition: React.FC<Props> = ({ tracks }) => {
  const frame = useCurrentFrame();
  const cursorTrack = findTrack(tracks, "cursor");
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Register hover zones
  const nameInputHover = useHoverAnimationSmooth(
    cursorHistory,
    INTERACTIVE_ELEMENTS[0].zone,
    { cursorType: "text" }
  );

  const emailInputHover = useHoverAnimationSmooth(
    cursorHistory,
    INTERACTIVE_ELEMENTS[1].zone,
    { cursorType: "text" }
  );

  const submitBtnHover = useHoverAnimationSmooth(
    cursorHistory,
    INTERACTIVE_ELEMENTS[2].zone,
    { cursorType: "pointer" }
  );

  // Aggregate cursor types
  const autoCursorType = useCursorTypeFromHover([
    nameInputHover,
    emailInputHover,
    submitBtnHover, // Last wins (highest z-index)
  ]);

  // Detect submit click
  const submitClickFrame = findClickInElement(
    cursorTrack,
    INTERACTIVE_ELEMENTS[2].zone,
    { startFrame: 100, endFrame: 300 }
  );

  const formSubmitted = submitClickFrame ? frame >= submitClickFrame : false;

  return (
    <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
      <AbsoluteFill>
        <input
          type="text"
          placeholder="Name"
          style={{
            position: "absolute",
            left: INTERACTIVE_ELEMENTS[0].zone.x,
            top: INTERACTIVE_ELEMENTS[0].zone.y,
            width: INTERACTIVE_ELEMENTS[0].zone.width,
            height: INTERACTIVE_ELEMENTS[0].zone.height,
            borderColor: nameInputHover.isHovering ? "#0066cc" : "#ccc",
          }}
        />

        <input
          type="email"
          placeholder="Email"
          style={{
            position: "absolute",
            left: INTERACTIVE_ELEMENTS[1].zone.x,
            top: INTERACTIVE_ELEMENTS[1].zone.y,
            width: INTERACTIVE_ELEMENTS[1].zone.width,
            height: INTERACTIVE_ELEMENTS[1].zone.height,
            borderColor: emailInputHover.isHovering ? "#0066cc" : "#ccc",
          }}
        />

        <button
          style={{
            position: "absolute",
            left: INTERACTIVE_ELEMENTS[2].zone.x,
            top: INTERACTIVE_ELEMENTS[2].zone.y,
            width: INTERACTIVE_ELEMENTS[2].zone.width,
            height: INTERACTIVE_ELEMENTS[2].zone.height,
            transform: `scale(${submitBtnHover.isClicking ? 0.95 : submitBtnHover.isHovering ? 1.05 : 1})`,
            backgroundColor: formSubmitted ? "#28a745" : "#0066cc",
          }}
        >
          {formSubmitted ? "✓ Submitted" : "Submit"}
        </button>
      </AbsoluteFill>
    </CameraHost>
  );
};
```

---

## Troubleshooting

### Cursor not changing type?

- ✅ Check `autoCursorType` is passed to `<CameraHost>`
- ✅ Verify hover zones don't overlap (last one wins)
- ✅ Ensure `cursorHistory` is from `useCursorHistory` hook

### Click not detected?

- ✅ Check cursor track has `isClicking` keyframes
- ✅ Verify click frame is within specified range
- ✅ Ensure cursor position matches element zone

### Hover state not updating?

- ✅ Confirm `cursorHistory` has 6+ frames of data
- ✅ Check element zone coordinates match visual position
- ✅ Verify padding value isn't too large/small

---

## API Reference

See:

- `app/remotion/utils/interactiveElements.ts` - Core utilities
- `app/remotion/components/InteractiveElement.tsx` - React component
- `app/remotion/hooks/useHoverAnimationSmooth.ts` - Hover detection hook
- `app/remotion/hooks/useCursorTypeFromHover.ts` - Cursor type aggregation
