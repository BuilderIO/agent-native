# Interactive Components Best Practices

## Core Principle

**ALL components in Video Studio should be interactive-ready from the start.**

This means every button, card, image, text element, or custom component should:

- ✅ Be selectable when hovered (shows in Cursor Interactions panel)
- ✅ Work without animations configured (safe fallbacks)
- ✅ Accept animations added through the UI
- ✅ Provide immediate visual feedback

## Why This Matters

### User Experience Benefits

- 🎯 **Discoverable**: Users can hover to see what's interactive
- 🎨 **Immediate feedback**: Components light up in the UI panel when hovered
- ⚡ **No setup friction**: Just hover → add animation → done
- 🔧 **Graceful degradation**: Components work perfectly with or without animations

### Developer Benefits

- 🚀 **Faster development**: No need to retrofit interactivity later
- 📦 **Consistent patterns**: All components follow the same structure
- 🐛 **Fewer bugs**: Safe fallbacks prevent undefined errors
- 🔄 **Easy to maintain**: Standard patterns across the codebase

## The Complete Pattern

### 1. Import Required Dependencies

```typescript
import React from "react";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";
```

### 2. Define Component Props

```typescript
interface MyComponentProps {
  // Required interactive props
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

  // Your custom props
  backgroundColor?: string;
  textColor?: string;
  onClick?: () => void;
}
```

### 3. Call useInteractiveComponent Hook

```typescript
function MyComponent({
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
  // ... other props
}: MyComponentProps) {
  // STEP 1: Register as interactive component
  const interactive = useInteractiveComponent({
    compositionId,
    id,
    elementType: "MyComponent",
    label,
    zone: { x, y, width, height },
    cursorHistory,
    tracks,
    interactiveElementType: "button", // or "link"
  });
```

### 4. Register with Cursor System

```typescript
// STEP 2: Register with cursor system
// This makes the component appear in Cursor Interactions panel
React.useEffect(() => {
  registerForCursor(interactive);
}, [interactive.hover.isHovering, interactive.click.isClicking]);
```

### 5. Extract Animation Values with Safe Fallbacks

```typescript
// STEP 3: Extract animation values from animatedProperties with SAFE FALLBACKS
// The hook automatically combines hover and click animations!
// Values are absolute (e.g., scale: 1.0 at rest, 1.2 when hovering)
const scale = (interactive.animatedProperties?.scale as number) ?? 1; // Default: 1
const lift = (interactive.animatedProperties?.lift as number) ?? 0; // Default: 0
const glow = (interactive.animatedProperties?.glow as number) ?? 0; // Default: 0
const blur = (interactive.animatedProperties?.blur as number) ?? 0; // Default: 0
const color = (interactive.animatedProperties?.color as number) ?? 0; // Default: 0
```

### 6. Apply Animations to Styles

```typescript
  // STEP 4: Apply animations (hover + click already combined by hook)
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        // Apply scale and lift
        transform: `scale(${scale}) translateY(${-lift}px)`,
        // Apply glow to shadow
        boxShadow: `
          0 ${4 + lift / 2}px ${20 + glow}px rgba(0, 0, 0, ${0.2 + glow / 200}),
          0 0 ${glow}px rgba(99, 102, 241, ${glow / 100})
        `,
        // Apply blur and color shift
        filter: `blur(${blur}px) hue-rotate(${color}deg)`,
        // Smooth transitions
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        // Visual feedback
        cursor: interactive.hover.isHovering ? "pointer" : "default",
        opacity: interactive.click.isClicking ? 0.9 : 1,
      }}
    >
      {/* Your component content */}
    </div>
  );
}
```

## Complete Checklist

Use this checklist for EVERY interactive component:

- [ ] Import `useInteractiveComponent` hook
- [ ] Import `CursorFrame` and `AnimationTrack` types
- [ ] Accept `compositionId`, `id`, `label` props
- [ ] Accept `x`, `y`, `width`, `height` for zone
- [ ] Accept `cursorHistory`, `tracks`, `registerForCursor` props
- [ ] Call `useInteractiveComponent` with proper zone definition
- [ ] Register component in `useEffect` watching hover/click states
- [ ] Extract **all 5 animation values** from `animatedProperties` with safe defaults:
  - [ ] `scale` from `interactive.animatedProperties?.scale ?? 1`
  - [ ] `lift` from `interactive.animatedProperties?.lift ?? 0`
  - [ ] `glow` from `interactive.animatedProperties?.glow ?? 0`
  - [ ] `blur` from `interactive.animatedProperties?.blur ?? 0`
  - [ ] `color` from `interactive.animatedProperties?.color ?? 0`
- [ ] Note: Values are absolute, and hook combines hover + click automatically!
- [ ] Apply animations to `transform` property (scale + lift)
- [ ] Apply animations to `boxShadow` property (glow)
- [ ] Apply animations to `filter` property (blur + color)
- [ ] Add `transition` for smooth animation application
- [ ] Add visual feedback for hover/click states

## Reusable Component Templates

Use these pre-built components instead of creating from scratch:

### InteractiveButton

```typescript
import { InteractiveButton } from "@/remotion/ui-components/InteractiveButton";

<InteractiveButton
  id="my-button"
  compositionId="my-comp"
  label="Click Me"
  x={100}
  y={100}
  width={200}
  height={60}
  cursorHistory={context.cursorHistory}
  tracks={context.tracks}
  registerForCursor={context.registerForCursor}
/>
```

### InteractiveCard

```typescript
import { InteractiveCard } from "@/remotion/ui-components/InteractiveCard";

<InteractiveCard
  id="my-card"
  compositionId="my-comp"
  title="My Card"
  description="Hover to add animations"
  icon="🎨"
  x={100}
  y={100}
  width={300}
  height={200}
  cursorHistory={context.cursorHistory}
  tracks={context.tracks}
  registerForCursor={context.registerForCursor}
/>
```

## Composition Setup

Use `createInteractiveComposition` for all compositions:

```typescript
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";

export const MyComposition = createInteractiveComposition<MyCompositionProps>({
  fallbackTracks: FALLBACK_TRACKS,
  render: (context, props) => {
    // context includes:
    // - cursorHistory: CursorFrame[]
    // - tracks: AnimationTrack[]
    // - cameraTrack: AnimationTrack
    // - cursorTrack: AnimationTrack
    // - registerForCursor: (component) => void

    return (
      <AbsoluteFill>
        {/* Your interactive components here */}
      </AbsoluteFill>
    );
  },
});
```

## Common Mistakes to Avoid

### ❌ DON'T: Access values without safe fallbacks

```typescript
// This will crash when animations aren't configured
const scale = 1 + interactive.scale.value;
```

### ✅ DO: Always use safe fallbacks

```typescript
// This works even without animations
const scale = 1 + (interactive.scale?.value ?? 0);
```

### ❌ DON'T: Forget to register with cursor system

```typescript
// Component won't appear in Cursor Interactions panel
const interactive = useInteractiveComponent({ ... });
// Missing: registerForCursor(interactive)
```

### ✅ DO: Register in useEffect

```typescript
const interactive = useInteractiveComponent({ ... });

React.useEffect(() => {
  registerForCursor(interactive);
}, [interactive.hover.isHovering, interactive.click.isClicking]);
```

### ❌ DON'T: Hardcode animation values

```typescript
// This prevents users from customizing through UI
transform: `scale(1.2)`; // Fixed scale, no interactivity
```

### ✅ DO: Use animation values from hook

```typescript
// This respects user-configured animations
transform: `scale(${1 + (interactive.scale?.value ?? 0)})`;
```

### ❌ DON'T: Skip zone definition

```typescript
// Inaccurate hover detection
zone: { x: 0, y: 0, width: 100, height: 100 }
```

### ✅ DO: Calculate precise zones

```typescript
// Accurate hit detection based on actual position
zone: { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight }
```

## Examples

See these files for complete working examples:

- `app/remotion/ui-components/InteractiveButton.tsx` - Button template
- `app/remotion/ui-components/InteractiveCard.tsx` - Card template
- `app/remotion/compositions/BlankComposition.tsx` - Composition setup
- `app/remotion/compositions/InteractiveShowcase.tsx` - Full showcase

## Summary

**Always make components interactive from the start:**

1. Use `useInteractiveComponent` hook
2. Register with `registerForCursor`
3. Extract values with `?.value ?? 0`
4. Apply all 5 animation types (scale, lift, glow, blur, color)
5. Add visual feedback for states

This ensures a smooth, discoverable, user-friendly experience where components are immediately explorable and ready for animation!
