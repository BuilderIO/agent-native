# Cursor Track Patterns & Best Practices

This document codifies the correct patterns for creating cursor tracks in Video Studio compositions.

## 🎯 Quick Start

### Use Helper Functions (Recommended)

Always use the helper functions from `registry.ts` to create tracks with the correct configuration:

```typescript
import {
  createCameraTrack,
  createCursorTrack,
  createStandardTracks,
} from "@/remotion/registry";

// Create both camera and cursor tracks
const tracks = createStandardTracks(300);

// Or create them individually
const cameraTrack = createCameraTrack(300);
const cursorTrack = createCursorTrack(300);

// Customize cursor start position
const cursorTrack = createCursorTrack(300, {
  startX: 100,
  startY: 100,
  startOpacity: 0,
  easing: "expo.inOut",
});
```

## ⚠️ Critical Pattern: Cursor Type

### ✅ CORRECT Pattern

```typescript
// Cursor type MUST be a constant "default" value
{ property: "type", from: "default", to: "default", unit: "" }
```

**NO keyframes needed!** The `autoCursorType` system will automatically override this to `"pointer"` when hovering over interactive components.

### ❌ WRONG Patterns

```typescript
// ❌ DO NOT use numeric values
{ property: "type", from: "0", to: "0", unit: "" }
{ property: "type", from: "1", to: "1", unit: "" }

// ❌ DO NOT add keyframes to switch cursor types
{
  property: "type",
  from: "default",
  to: "default",
  unit: "",
  keyframes: [
    { frame: 0, value: "default" },
    { frame: 30, value: "pointer" },  // DON'T DO THIS!
  ]
}
```

### Why This Pattern Works

1. **Standard Arrow Cursor**: When the cursor is not hovering over any interactive component, it displays as the standard arrow (`"default"`).

2. **Automatic Override**: When the cursor enters an interactive component's zone, the `autoCursorType` system (from `useInteractiveComponentsCursor`) automatically overrides the track type to show `"pointer"`.

3. **No Invisible Cursor**: The cursor remains visible at all times between components (as long as opacity > 0).

## 📋 Complete Cursor Track Structure

A properly configured cursor track has these properties:

```typescript
{
  id: "cursor",
  label: "Cursor",
  startFrame: 0,
  endFrame: 300,
  easing: "expo.inOut",
  animatedProps: [
    // Position
    { property: "x", from: "960", to: "960", unit: "px", keyframes: [] },
    { property: "y", from: "540", to: "540", unit: "px", keyframes: [] },

    // Appearance
    { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
    { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },

    // Type (constant "default" - autoCursorType handles hover state)
    { property: "type", from: "default", to: "default", unit: "" },

    // Interaction
    { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [] },
  ],
}
```

## 🎬 Adding Cursor Movement

Add keyframes to the `x` and `y` properties to animate cursor movement:

```typescript
const cursorTrack = createCursorTrack(300);

// Add movement keyframes
const xProp = cursorTrack.animatedProps.find((p) => p.property === "x")!;
xProp.keyframes = [
  { frame: 0, value: "100" }, // Start offscreen
  { frame: 30, value: "760" }, // Move to button
  { frame: 90, value: "760" }, // Hover on button
  { frame: 120, value: "960" }, // Move to center
];

const yProp = cursorTrack.animatedProps.find((p) => p.property === "y")!;
yProp.keyframes = [
  { frame: 0, value: "100" },
  { frame: 30, value: "400" },
  { frame: 90, value: "400" },
  { frame: 120, value: "540" },
];
```

## 🖱️ Adding Click Events

Add keyframes to trigger click animations:

```typescript
const clickProp = cursorTrack.animatedProps.find(
  (p) => p.property === "isClicking",
)!;
clickProp.keyframes = [
  { frame: 0, value: "0" },
  { frame: 59, value: "0" },
  { frame: 60, value: "1" }, // Click starts
  { frame: 70, value: "0" }, // Click ends (10 frames later)
];
```

## 💡 Fade In/Out Pattern

Common pattern for cursor appearance:

```typescript
const opacityProp = cursorTrack.animatedProps.find(
  (p) => p.property === "opacity",
)!;
opacityProp.keyframes = [
  { frame: 0, value: "0" }, // Hidden at start
  { frame: 20, value: "0" },
  { frame: 30, value: "1" }, // Fade in
  { frame: 280, value: "1" }, // Stay visible
  { frame: 290, value: "0" }, // Fade out
  { frame: 300, value: "0" }, // Hidden at end
];
```

## 🔧 Helper Functions Reference

### `createStandardTracks(durationInFrames)`

Creates both camera and cursor tracks with default values.

```typescript
const tracks = createStandardTracks(300);
// Returns: [cameraTrack, cursorTrack]
```

### `createCameraTrack(durationInFrames)`

Creates a camera track with no movement (static viewport).

```typescript
const cameraTrack = createCameraTrack(300);
```

### `createCursorTrack(durationInFrames, options?)`

Creates a cursor track with correct configuration.

**Options:**

- `startX` (default: 960) - Initial X position
- `startY` (default: 540) - Initial Y position
- `startOpacity` (default: 1) - Initial opacity
- `easing` (default: "expo.inOut") - Easing function

```typescript
const cursorTrack = createCursorTrack(300, {
  startX: 100,
  startY: 100,
  startOpacity: 0,
  easing: "expo.inOut",
});
```

## 📚 Examples

### Basic Composition with Static Cursor

```typescript
import { createStandardTracks } from "@/remotion/registry";

const FALLBACK_TRACKS = createStandardTracks(240);
```

### Composition with Animated Cursor

```typescript
import { createStandardTracks } from "@/remotion/registry";

const FALLBACK_TRACKS = (() => {
  const tracks = createStandardTracks(300);
  const cursorTrack = tracks[1];

  // Add movement
  const xProp = cursorTrack.animatedProps.find((p) => p.property === "x")!;
  xProp.keyframes = [
    { frame: 0, value: "100" },
    { frame: 30, value: "960" },
  ];

  return tracks;
})();
```

### Interactive Components Demo Pattern

See `client/remotion/compositions/ComponentsDemo.tsx` for a complete example with:

- Multiple interactive components
- Cursor movement between components
- Click animations
- Fade in/out
- Automatic cursor type switching on hover

## 🐛 Troubleshooting

### Problem: Cursor disappears between components

**Cause**: Cursor type is using numeric values (`"0"` or `"1"`) instead of `"default"`

**Solution**: Use helper functions or ensure type property is:

```typescript
{ property: "type", from: "default", to: "default", unit: "" }
```

### Problem: Cursor doesn't change to pointer on hover

**Cause**:

1. Interactive component not registered with `registerForCursor()`
2. Zone not configured correctly
3. `autoCursorType` not passed to `CameraHost`

**Solution**:

```typescript
// Register component
React.useEffect(() => {
  registerForCursor(button);
}, [button.hover.isHovering, button.click.isClicking, registerForCursor]);

// Pass autoCursorType to CameraHost
<CameraHost tracks={tracks} autoCursorType={autoCursorType}>
  {/* content */}
</CameraHost>
```

### Problem: Cursor appears but doesn't move

**Cause**: No keyframes added to x/y properties

**Solution**: Add keyframes as shown in "Adding Cursor Movement" section above

## 📖 See Also

- `client/remotion/registry.ts` - Helper function implementations
- `client/remotion/compositions/ComponentsDemo.tsx` - Complete example
- `client/remotion/compositions/UIShowcase.tsx` - Another working example
- `client/remotion/hooks/createInteractiveComposition.tsx` - How autoCursorType works
