# AI Component Generation Guidelines

**FOR AI ASSISTANTS: Use this guide when generating Video Studio components**

## Golden Rule

**EVERY component MUST be interactive-ready from the start.**

No exceptions. No "we'll add interactivity later." Every single component should be hoverable, selectable, and ready for animations the moment it's created.

## Required Pattern (Copy This Every Time)

### 1. Imports (Always Include These)
```typescript
import React from "react";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";
```

### 2. Props Interface (Always Include These)
```typescript
interface YourComponentProps {
  // REQUIRED - Interactive system props
  id: string;
  compositionId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cursorHistory: CursorFrame[];
  tracks: AnimationTrack[];
  registerForCursor: (component: any) => void;
  
  // Your custom props here
  // ...
}
```

### 3. Component Body (Always Include This Pattern)
```typescript
function YourComponent({
  id,
  compositionId,
  label,
  x,
  y,
  width,
  height,
  cursorHistory,
  tracks,
  registerForCursor,
  // ... your custom props
}: YourComponentProps) {
  // REQUIRED: Register as interactive
  const interactive = useInteractiveComponent({
    compositionId,
    id,
    elementType: "YourComponent",
    label,
    zone: { x, y, width, height },
    cursorHistory,
    tracks,
    interactiveElementType: "button", // or "link"
  });

  // REQUIRED: Register with cursor system
  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  // REQUIRED: Extract animation values from animatedProperties with SAFE FALLBACKS
  // The hook automatically combines hover and click animations!
  // Values are absolute (e.g., scale: 1.0 at rest, 1.2 when hovering)
  const scale = (interactive.animatedProperties?.scale as number) ?? 1;  // Default: 1
  const lift = (interactive.animatedProperties?.lift as number) ?? 0;     // Default: 0
  const glow = (interactive.animatedProperties?.glow as number) ?? 0;     // Default: 0
  const blur = (interactive.animatedProperties?.blur as number) ?? 0;     // Default: 0
  const color = (interactive.animatedProperties?.color as number) ?? 0;    // Default: 0

  // REQUIRED: Apply animations to styles
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        transform: `scale(${scale}) translateY(${-lift}px)`,
        boxShadow: `0 ${4 + lift/2}px ${12 + glow}px rgba(0,0,0,0.3)`,
        filter: `blur(${blur}px) hue-rotate(${color}deg)`,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: interactive.hover.isHovering ? "pointer" : "default",
        // ... your other styles
      }}
    >
      {/* Your content */}
    </div>
  );
}
```

## Pre-Generation Checklist

Before generating ANY component, verify:

- [ ] Does it import `useInteractiveComponent`?
- [ ] Does it accept all required interactive props?
- [ ] Does it call `useInteractiveComponent` with proper zone?
- [ ] Does it register with `registerForCursor` in useEffect?
- [ ] Does it extract ALL 5 animation values from `animatedProperties` with safe defaults?
  - [ ] `scale ?? 1` (not 0!)
  - [ ] `lift ?? 0`
  - [ ] `glow ?? 0`
  - [ ] `blur ?? 0`
  - [ ] `color ?? 0`
- [ ] Does it apply animations to transform, boxShadow, filter?
- [ ] Does it have smooth transitions?
- [ ] Does it provide visual feedback for hover/click?

## Quick Reference: The 5 Animation Properties

**ALWAYS extract from animatedProperties (hover + click automatically combined):**

```typescript
const scale = (interactive.animatedProperties?.scale as number) ?? 1;  // Scale (1 = normal)
const lift = (interactive.animatedProperties?.lift as number) ?? 0;    // Lift up (pixels)
const glow = (interactive.animatedProperties?.glow as number) ?? 0;    // Shadow intensity
const blur = (interactive.animatedProperties?.blur as number) ?? 0;    // Blur (pixels)
const color = (interactive.animatedProperties?.color as number) ?? 0;  // Hue shift (degrees)
```

**IMPORTANT:**
- Values are **absolute**, not deltas (scale is 1.0 at rest, 1.2 when active)
- The hook automatically combines hover and click animations for you!
- Default scale to **1**, all others to **0**

**ALWAYS apply like this:**

```typescript
style={{
  transform: `scale(${scale}) translateY(${-lift}px)`,
  boxShadow: `0 ${4 + lift/2}px ${12 + glow}px rgba(0,0,0,0.3)`,
  filter: `blur(${blur}px) hue-rotate(${color}deg)`,
  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
}}
```

## Zone Calculation Examples

### Button in Center
```typescript
const buttonWidth = 200;
const buttonHeight = 60;
const buttonX = (width - buttonWidth) / 2;
const buttonY = (height - buttonHeight) / 2;

zone: { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight }
```

### Card in Grid
```typescript
const cardWidth = 300;
const cardHeight = 200;
const gap = 40;
const gridStartX = 100;
const gridStartY = 100;

// Card at column 1, row 0
const cardX = gridStartX + (cardWidth + gap) * 1;
const cardY = gridStartY;

zone: { x: cardX, y: cardY, width: cardWidth, height: cardHeight }
```

### Absolute Positioned Element
```typescript
// Element positioned with CSS
<div style={{ position: "absolute", left: 150, top: 250, width: 180, height: 80 }}>

// Zone matches exactly
zone: { x: 150, y: 250, width: 180, height: 80 }
```

## When to Use Reusable Components

**ALWAYS prefer reusable components when possible:**

### Use InteractiveButton for:
- CTAs (Call to Action)
- Submit buttons
- Navigation buttons
- Action triggers

```typescript
<InteractiveButton
  id="cta-button"
  compositionId={compositionId}
  label="Get Started"
  x={buttonX}
  y={buttonY}
  width={200}
  height={60}
  cursorHistory={context.cursorHistory}
  tracks={context.tracks}
  registerForCursor={context.registerForCursor}
/>
```

### Use InteractiveCard for:
- Feature showcases
- Product cards
- Info panels
- Content sections

```typescript
<InteractiveCard
  id="feature-card"
  compositionId={compositionId}
  title="Feature Name"
  description="Feature description"
  icon="✨"
  x={cardX}
  y={cardY}
  width={300}
  height={200}
  cursorHistory={context.cursorHistory}
  tracks={context.tracks}
  registerForCursor={context.registerForCursor}
/>
```

## Composition Setup

**ALWAYS use createInteractiveComposition:**

```typescript
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";

export const MyComposition = createInteractiveComposition<MyCompositionProps>({
  fallbackTracks: FALLBACK_TRACKS,
  render: (context, props) => {
    // context provides:
    // - cursorHistory
    // - tracks
    // - cameraTrack
    // - cursorTrack
    // - registerForCursor
    
    return (
      <AbsoluteFill>
        {/* Your components here */}
      </AbsoluteFill>
    );
  },
});
```

## Common User Requests → Implementation

### "Create a button"
→ Use `InteractiveButton` component

### "Add a card"
→ Use `InteractiveCard` component

### "Make this interactive"
→ It should already be interactive! Check the pattern above.

### "Add hover effect"
→ No code needed! User adds it through Cursor Interactions panel.

### "Make this clickable"
→ Already clickable if following the pattern. User configures click animations through UI.

## Anti-Patterns to Avoid

### ❌ NEVER: Static, non-interactive components
```typescript
// BAD - Not selectable, can't add animations
<div style={{ position: "absolute", left: 100, top: 100 }}>
  Click Me
</div>
```

### ✅ ALWAYS: Interactive from the start
```typescript
// GOOD - Selectable, animation-ready
<InteractiveButton
  id="my-button"
  compositionId={compositionId}
  label="Click Me"
  x={100}
  y={100}
  width={120}
  height={40}
  cursorHistory={context.cursorHistory}
  tracks={context.tracks}
  registerForCursor={context.registerForCursor}
/>
```

### ❌ NEVER: Accessing values without fallbacks
```typescript
// BAD - Will crash without animations
const scale = 1 + interactive.scale.value;
```

### ✅ ALWAYS: Safe fallbacks
```typescript
// GOOD - Works with or without animations
const scale = 1 + (interactive.scale?.value ?? 0);
```

### ❌ NEVER: Forgetting to register
```typescript
// BAD - Won't show in Cursor Interactions panel
const interactive = useInteractiveComponent({ ... });
// Missing: registerForCursor(interactive)
```

### ✅ ALWAYS: Register in useEffect
```typescript
// GOOD - Shows in panel when hovered
const interactive = useInteractiveComponent({ ... });

React.useEffect(() => {
  registerForCursor(interactive);
}, [interactive.hover.isHovering, interactive.click.isClicking]);
```

## Testing Checklist

After generating a component, verify:

1. ✅ Hover over component → Does it show in Cursor Interactions panel?
2. ✅ Add scale animation → Does the component scale on hover?
3. ✅ Add lift animation → Does the component move up on hover?
4. ✅ Add glow animation → Does the shadow intensify on hover?
5. ✅ Remove all animations → Does the component still render without errors?
6. ✅ Click the component → Does click state register?

## Summary

When generating ANY component:

1. **Import** the interactive hooks and types
2. **Accept** all required interactive props
3. **Call** useInteractiveComponent with accurate zone
4. **Register** with registerForCursor in useEffect
5. **Extract** all 5 animation values from `animatedProperties` with safe fallbacks
6. **Apply** animations to transform, boxShadow, filter
7. **Add** transitions and visual feedback

**Note:** The hook automatically combines hover and click animations!

**No shortcuts. No exceptions. Every component. Every time.**

This ensures users get a smooth, discoverable, professional experience where everything "just works" and is ready for animation out of the box.
