# Animated Components Guide

Complete guide to creating interactive, animated Remotion components in Video Studio.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Cursor Animation Tracks](#cursor-animation-tracks) ⭐ **CRITICAL**
4. [Component Generator](#component-generator)
5. [Manual Creation](#manual-creation)
6. [Animation System](#animation-system)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)
9. [API Reference](#api-reference)

---

## Quick Start

### Generate a New Component (Recommended)

```bash
# Generate with default elements (Button, Card)
npm run generate:component MyDashboard

# Generate with custom elements
npm run generate:component ProductShowcase --elements Hero,Feature,CTA,Testimonial
```

This creates:

- Main composition file
- Element components with animation support
- Configuration file with cursor tracks
- README with instructions

### Add to Registry

```typescript
// client/remotion/registry.ts
import { MyDashboard } from "@/remotion/compositions/MyDashboard/MyDashboard";
import { FALLBACK_TRACKS } from "@/remotion/compositions/MyDashboard/MyDashboardConfig";

{
  id: "my-dashboard",
  title: "My Dashboard",
  description: "Interactive dashboard with animations",
  component: MyDashboard,
  durationInFrames: 300,
  fps: 30,
  width: 1920,
  height: 1080,
  defaultProps: {},
  tracks: FALLBACK_TRACKS,
}
```

### Customize in Video Studio UI

1. Open composition in Video Studio
2. Hover over elements to select
3. Configure animations in Properties panel
4. Preview in real-time

---

## Architecture

### Component Flow

```
┌─────────────────────────────────────────┐
│  Composition (MyDashboard.tsx)          │
│  ┌───────────────────────────────────┐  │
│  │  AnimatedElement wrapper          │  │
│  │  • Detects hover/click            │  │
│  │  • Fetches animations             │  │
│  │  • Calculates styles              │  │
│  │  • Passes to child component      │  │
│  └────────────┬──────────────────────┘  │
│               │                          │
│  ┌────────────▼──────────────────────┐  │
│  │  Element Component (MyButton.tsx)  │  │
│  │  • Receives animatedStyles         │  │
│  │  • Applies to DOM elements         │  │
│  │  • Renders content                 │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Animation Data Flow

```
localStorage (videos-element-animations)
    │
    ▼
CurrentElementContext
    │
    ▼
getAnimationsForElement()
    │
    ▼
AnimatedElement
    │
    ▼
calculateElementAnimations()
    │
    ▼
Child Component (receives animatedStyles)
```

---

## Cursor Animation Tracks

### 🚨 CRITICAL RULES

### All Animations Must Be Visible

**NEVER create animations that users cannot see and edit.**

Every visual state change MUST be visible in:

1. **Animation Tracks** (timeline) - for ALL timed animations
2. **Cursor Interactions** (hover zones) - for cursor-driven state changes
3. **Interactive Element Registration** - ALL clickable/hoverable UI must be registered

**📘 See:** [Interactive Elements Guide](./INTERACTIVE_ELEMENTS_GUIDE.md) for complete registration patterns.

**Examples requiring tracks:**

- ✅ Button morphing (circle → square) - **FusionInputBox "sendButton" track**
- ✅ Color transitions - create a "color" or "state" track
- ✅ Text typing/clearing - use opacity or reveal tracks
- ✅ Element transforms - scale, rotate, translate tracks

**Why?** Users must be able to see, edit, and understand animations without reading code.

### Cursor Animations Must Be Defined as Tracks

**Never hardcode cursor animations in component logic.** All cursor movement, type changes, and click events must be defined as tracks in the registry.

### Why Tracks, Not Hardcoded Logic?

✅ **Editable in UI** - Timeline shows all cursor keyframes
✅ **Reusable** - Copy cursor paths between compositions
✅ **Debuggable** - Visual representation of cursor movement
✅ **Consistent** - Same pattern as camera animations
✅ **Collaborative** - Designers can edit without touching code

### Cursor Track Structure

```typescript
{
  id: "cursor",
  label: "Cursor",
  startFrame: 0,
  endFrame: 300,
  easing: "expo.inOut",
  animatedProps: [
    {
      property: "x",
      from: "960",
      to: "960",
      unit: "px",
      keyframes: [
        { frame: 0, value: "2100" },   // offscreen right
        { frame: 40, value: "500" },   // move to button
        { frame: 120, value: "800" },  // move to input
        { frame: 200, value: "900" },  // move to submit
        { frame: 280, value: "2200" }, // exit offscreen
      ],
    },
    {
      property: "y",
      from: "540",
      to: "540",
      unit: "px",
      keyframes: [
        { frame: 0, value: "-60" },    // offscreen top
        { frame: 40, value: "400" },   // at button
        { frame: 120, value: "600" },  // at input
        { frame: 200, value: "650" },  // at submit
        { frame: 280, value: "1140" }, // exit offscreen bottom
      ],
    },
    {
      property: "type",
      from: "default",
      to: "default",
      unit: "",
      keyframes: [
        { frame: 0, value: "default" },
        { frame: 115, value: "text" },    // change to text cursor
        { frame: 195, value: "pointer" }, // change to pointer
      ],
    },
    {
      property: "isClicking",
      from: "0",
      to: "0",
      unit: "",
      keyframes: [
        { frame: 45, value: "1" },  // click button
        { frame: 120, value: "1" }, // click input
        { frame: 205, value: "1" }, // click submit
      ],
    },
    {
      property: "opacity",
      from: "0",
      to: "1",
      unit: "",
      keyframes: [
        { frame: 0, value: "0" },
        { frame: 4, value: "1" },
        { frame: 276, value: "1" },
        { frame: 280, value: "0" },
      ],
    },
  ],
}
```

### Using CameraHost for Cursor

```typescript
// ✅ CORRECT: Use CameraHost to render cursor from track
export const MyComposition: React.FC<MyProps> = ({ tracks = [] }) => {
  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill>
        {/* Your UI components */}
      </AbsoluteFill>
    </CameraHost>
  );
};
```

```typescript
// ❌ WRONG: Don't manually render cursor with interpolate
export const MyComposition: React.FC<MyProps> = () => {
  const frame = useCurrentFrame();

  // ❌ DON'T DO THIS
  const cursorX = interpolate(frame, [0, 100], [0, 1920]);
  const cursorY = interpolate(frame, [0, 100], [0, 1080]);

  return (
    <AbsoluteFill>
      {/* UI */}
      <Cursor x={cursorX} y={cursorY} /> {/* ❌ WRONG */}
    </AbsoluteFill>
  );
};
```

### Hover Zones for Automatic Cursor Types

**🎯 CRITICAL: Define hover zones to automatically change cursor types based on UI elements.**

**Instead of manually keyframing cursor type changes, define hover zones that automatically transform the cursor:**

```typescript
// Get cursor history
const cursorTrack = findTrack(tracks, "cursor");
const cursorHistory = useCursorHistory(cursorTrack, 6);

// Define hover zones for each interactive element
const textareaHover = useHoverAnimationSmooth(cursorHistory, {
  x: 230,
  y: 985,
  width: 1450,
  height: 95,
  padding: 10,
  cursorType: "text", // Text cursor over input
});

const sendBtnHover = useHoverAnimationSmooth(cursorHistory, {
  x: 1850,
  y: 1010,
  width: 50,
  height: 50,
  padding: 8,
  cursorType: "pointer", // Pointer over button
});

// Aggregate all hover zones
const autoCursorType = useCursorTypeFromHover([
  textareaHover,
  sendBtnHover, // Last wins (z-index priority)
]);

// Pass to CameraHost
<CameraHost tracks={tracks} autoCursorType={autoCursorType}>
  {/* ... */}
</CameraHost>
```

**Benefits:**
✅ Cursor automatically changes to pointer over buttons
✅ Cursor automatically changes to text over inputs
✅ No manual type keyframes needed
✅ Works even if cursor path changes
✅ Realistic behavior matching real browsers

### Cursor Animation Planning

**Before coding, plan your cursor path:**

1. **Identify interaction points** - What elements will the cursor interact with?
2. **Define hover zones** - What areas should change cursor type?
3. **Determine timing** - How long should each movement take?
4. **Mark click frames** - When does the cursor click?
5. **Add enter/exit** - Cursor flies in from offscreen, exits offscreen

**Example timeline:**

```
Frame 0-40:    Cursor enters from top-right
Frame 40-45:   Cursor hovers over "Start" button
Frame 45:      Click "Start" button
Frame 50-120:  Cursor moves to input field
Frame 115:     Cursor type changes to "text"
Frame 120:     Click input field
Frame 125-200: (Typing animation happens)
Frame 200-205: Cursor moves to "Submit" button
Frame 195:     Cursor type changes to "pointer"
Frame 205:     Click "Submit" button
Frame 210-280: Cursor exits to bottom-right
```

---

## Component Generator

### Command Options

```bash
npm run generate:component <Name> [options]

Options:
  --elements <E1,E2>    Element types (comma-separated)
  --output <dir>        Output directory (default: client/remotion/compositions)

Examples:
  npm run generate:component Landing --elements Hero,Features,CTA
  npm run generate:component Dashboard --elements Card,Button,Chart,Table
```

### Generated Files

```
MyDashboard/
├── MyDashboard.tsx           # Main composition
├── MyDashboardConfig.ts      # Tracks, cursor path
├── MyDashboardButton.tsx     # Button element
├── MyDashboardCard.tsx       # Card element
└── README.md                 # Usage instructions
```

### What's Included

✅ **Automatic animation wiring** - No manual setup  
✅ **Type-safe props** - Full TypeScript support  
✅ **Default animations** - Hover lift + click press  
✅ **Cursor tracking** - Pre-configured cursor path  
✅ **Properties panel** - Ready for customization

---

## Manual Creation

If you need more control, create components manually.

### Step 1: Create Element Component

```typescript
// MyButton.tsx
import React from "react";
import type { AnimatedStyles } from "@/remotion/components/AnimatedElement";

export interface MyButtonProps {
  animatedStyles: AnimatedStyles;
  label: string;
}

export const MyButton: React.FC<MyButtonProps> = ({ animatedStyles, label }) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: animatedStyles.backgroundColor,
        borderColor: animatedStyles.borderColor,
        borderWidth: animatedStyles.borderWidth,
        borderStyle: "solid",
        borderRadius: animatedStyles.borderRadius,
        boxShadow: animatedStyles.boxShadow,
        transform: animatedStyles.transform,
        filter: animatedStyles.filter,
        opacity: animatedStyles.opacity,
        fontFamily: "Inter, sans-serif",
        fontSize: 16,
        fontWeight: 600,
        color: "white",
        padding: "12px 24px",
      }}
    >
      {label}
    </div>
  );
};
```

### Step 2: Use AnimatedElement Wrapper

```typescript
// MyComposition.tsx
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { MyButton } from "./MyButton";

export const MyComposition = () => {
  const { getAnimationsForElement } = useCurrentElement();
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  return (
    <AnimatedElement
      id="submit-button"
      elementType="Button"
      label="Submit Button"
      compositionId="my-composition"
      position={{ x: 860, y: 700 }}
      size={{ width: 200, height: 60 }}
      baseColor="#3b82f6"
      cursorHistory={cursorHistory}
      getAnimationsForElement={getAnimationsForElement}
      cursorTrack={cursorTrack}
      clickStartFrames={clickStartFrames}
    >
      {(animatedStyles) => (
        <MyButton animatedStyles={animatedStyles} label="Submit" />
      )}
    </AnimatedElement>
  );
};
```

### Step 3: Initialize Default Animations

```typescript
// At top of composition file (module level)
import {
  initializeDefaultAnimations,
  AnimationPresets,
} from "@/remotion/utils/animationHelpers";

initializeDefaultAnimations("my-composition", [
  AnimationPresets.hoverLift("Button"),
  AnimationPresets.clickPress("Button"),
  AnimationPresets.hoverGlow("Card", "#3b82f6"),
  AnimationPresets.clickBounce("Card"),
]);
```

---

## Animation System

### Animation Presets

```typescript
import { AnimationPresets } from "@/remotion/utils/animationHelpers";

// Lift on hover (card lifts up with shadow)
AnimationPresets.hoverLift("Card");

// Press on click (button press down)
AnimationPresets.clickPress("Button");

// Glow on hover (element glows with color)
AnimationPresets.hoverGlow("Panel", "#10b981");

// Bounce on click (element bounces)
AnimationPresets.clickBounce("Toggle");

// Fade on hover (element fades)
AnimationPresets.hoverFade("Image", 0.7);
```

### Custom Animations (Type-Safe Builder)

```typescript
import {
  createAnimation,
  createProperty,
} from "@/remotion/utils/animationHelpers";

const customHover = createAnimation("card-hover-custom", "Card", "hover")
  .setDuration(10)
  .setEasing("expo.out")
  .addProperty(
    createProperty("scale")
      .at(0, 1)
      .at(1, 1.1)
      .withUnit("x")
      .withBounds(0.5, 2)
      .build(),
  )
  .addProperty(
    createProperty("rotateZ")
      .at(0, 0)
      .at(1, 5)
      .withUnit("deg")
      .withBounds(-45, 45)
      .build(),
  )
  .addProperty(
    createProperty("shadowBlur")
      .at(0, 8)
      .at(1, 40)
      .withUnit("px")
      .withBounds(0, 100)
      .build(),
  )
  .build();
```

### Using the Hook Version

For more control, use the hook version:

```typescript
import { useAnimatedElement } from "@/remotion/components/AnimatedElement";

const { animatedStyles, hoverProgress, clickProgress } = useAnimatedElement({
  id: "my-button",
  elementType: "Button",
  position: { x: 100, y: 200 },
  size: { width: 200, height: 60 },
  cursorHistory,
  getAnimationsForElement,
  compositionId: "my-composition",
  cursorTrack,
  clickStartFrames,
});

// Use animatedStyles in your JSX
<div style={animatedStyles}>...</div>
```

---

## Best Practices

### ✅ DO

- **🎯 CRITICAL: Define cursor animations as TRACKS** - Never hardcode cursor movement in component logic. Always create cursor tracks in the registry with keyframes for position and clicks. Use `CameraHost` to render from track.
- **🎯 CRITICAL: Define hover zones for cursor types** - Use `useHoverAnimationSmooth` with `cursorType` option to automatically change cursor (pointer/text) over interactive elements. Never manually keyframe cursor type changes.
- **Use the generator** for new components - It's faster and less error-prone
- **Apply ALL animated styles** - transform, filter, opacity, backgroundColor, etc.
- **Initialize animations at module level** - Before component renders
- **Use type-safe builders** - Catch errors at compile time
- **Test hover/click zones** - Ensure padding is sufficient
- **Validate animations** - Use `validateAnimation()` helper
- **Use meaningful element types** - "SubmitButton" not "Button1"

### ❌ DON'T

- **🚫 CRITICAL: Hardcode cursor animations in components** - Never use manual `interpolate()` for cursor x/y or type. Always use cursor tracks.
- **Hardcode styles** - Always use `animatedStyles`
- **Initialize in useEffect** - Too late, causes race conditions
- **Skip animation properties** - Missing transform breaks animations
- **Nest AnimatedElement** - One wrapper per interactive element
- **Forget hover padding** - Cursor needs buffer zone
- **Use generic IDs** - "button" → "submit-button"

### Performance Tips

1. **Share cursor history** - Calculate once, pass to all elements
2. **Pre-calculate click frames** - Don't recalculate per element
3. **Use useMemo** - For expensive calculations
4. **Limit history length** - 6 frames is usually enough

---

## Troubleshooting

### Animations Not Working

**Problem**: Hover/click doesn't trigger animations

**Solutions**:

1. ✅ Check animations initialized at module level
2. ✅ Verify `animatedStyles` applied to DOM element
3. ✅ Confirm element type matches animation elementType
4. ✅ Check hover zone position/size is correct
5. ✅ Reload browser to clear cache

```typescript
// DEBUG: Log animation counts
console.log("Animations:", getAnimationsForElement("my-comp", "Button"));
```

### Styles Not Applied

**Problem**: Elements don't have animated styles

**Solutions**:

1. ✅ Apply ALL properties from `animatedStyles`:
   ```typescript
   <div style={{
     transform: animatedStyles.transform,
     filter: animatedStyles.filter,
     opacity: animatedStyles.opacity,
     backgroundColor: animatedStyles.backgroundColor,
     borderColor: animatedStyles.borderColor,
     borderRadius: animatedStyles.borderRadius,
     borderWidth: animatedStyles.borderWidth,
     boxShadow: animatedStyles.boxShadow,
     // ... your custom styles
   }}>
   ```
2. ✅ Don't override with hardcoded values:

   ```typescript
   // ❌ WRONG
   background: "#3b82f6"; // Overrides animatedStyles.backgroundColor

   // ✅ CORRECT
   background: animatedStyles.backgroundColor;
   ```

### Click Not Detected

**Problem**: Click animation doesn't trigger

**Solutions**:

1. ✅ Pass `cursorTrack` and `clickStartFrames` to AnimatedElement
2. ✅ Ensure cursor path intersects element at click frame
3. ✅ Check `isClicking` keyframes in cursor track
4. ✅ Verify hover zone includes element

### Properties Panel Empty

**Problem**: Element doesn't show in Properties panel

**Solutions**:

1. ✅ Call `setCurrentElement()` on hover
2. ✅ Use `onHoverChange` callback
3. ✅ Verify compositionId matches
4. ✅ Check elementType is registered

---

## API Reference

### AnimatedElement

```typescript
interface AnimatedElementProps {
  id: string; // Unique element ID
  elementType: string; // Type (e.g., "Button", "Card")
  label: string; // Display label for UI
  compositionId: string; // Composition ID
  position: { x: number; y: number }; // Canvas position
  size: { width: number; height: number }; // Element size
  baseColor?: string; // Base background color
  baseBorderColor?: string; // Base border color
  cursorHistory: CursorFrame[]; // From useCursorHistory()
  getAnimationsForElement: Function; // From useCurrentElement()
  cursorTrack?: AnimationTrack; // For click detection
  clickStartFrames?: number[]; // Pre-calculated clicks
  hoverPadding?: number; // Hover zone padding (default: 8)
  cursorType?: "default" | "pointer" | "text"; // Cursor style
  onHoverChange?: (id: string, hovered: boolean) => void;
  onClick?: (id: string) => void;
  children: (animatedStyles: AnimatedStyles) => ReactNode;
}
```

### AnimatedStyles

```typescript
interface AnimatedStyles {
  transform?: string; // CSS transform (scale, translate, rotate, etc.)
  filter?: string; // CSS filter (brightness, blur, etc.)
  opacity: number; // 0-1
  backgroundColor: string; // Hex or rgb color
  borderColor: string; // Hex or rgb color
  borderRadius: number; // Pixels
  borderWidth: number; // Pixels
  boxShadow: string; // CSS box-shadow
}
```

### Animation Helpers

```typescript
// Initialize animations
initializeDefaultAnimations(compositionId: string, animations: ElementAnimation[], options?: { force?: boolean })

// Get animations
getCompositionAnimations(compositionId: string): ElementAnimation[]

// Clear animations
clearCompositionAnimations(compositionId: string): void

// Validate animation
validateAnimation(animation: ElementAnimation): { valid: boolean; errors: string[] }

// Create animation
createAnimation(id: string, elementType: string, triggerType: "hover" | "click"): AnimationBuilder

// Create property
createProperty(property: string): AnimationPropertyBuilder
```

---

## Examples

### Example 1: Simple Button

```typescript
<AnimatedElement
  id="cta-button"
  elementType="CTAButton"
  label="Call to Action"
  compositionId="landing"
  position={{ x: 860, y: 700 }}
  size={{ width: 240, height: 70 }}
  baseColor="#3b82f6"
  cursorHistory={cursorHistory}
  getAnimationsForElement={getAnimationsForElement}
>
  {(animatedStyles) => (
    <div style={animatedStyles}>
      <span>Get Started</span>
    </div>
  )}
</AnimatedElement>
```

### Example 2: Complex Card

```typescript
<AnimatedElement
  id="feature-card-1"
  elementType="FeatureCard"
  label="Feature Card 1"
  compositionId="product-showcase"
  position={{ x: 100, y: 300 }}
  size={{ width: 400, height: 300 }}
  baseColor="#1e293b"
  baseBorderColor="#334155"
  cursorHistory={cursorHistory}
  getAnimationsForElement={getAnimationsForElement}
  cursorTrack={cursorTrack}
  clickStartFrames={clickStartFrames}
  hoverPadding={12}
>
  {(animatedStyles, hoverProgress) => (
    <FeatureCard
      animatedStyles={animatedStyles}
      hoverProgress={hoverProgress}
      title="Fast Performance"
      description="Optimized for speed"
      icon={<Lightning />}
    />
  )}
</AnimatedElement>
```

### Example 3: Using Hook

```typescript
const ButtonComponent = () => {
  const { animatedStyles, hoverProgress, clickProgress } = useAnimatedElement({
    id: "my-button",
    elementType: "Button",
    position: { x: 500, y: 400 },
    size: { width: 200, height: 60 },
    cursorHistory,
    getAnimationsForElement,
    compositionId: "demo",
  });

  return (
    <div style={{
      ...animatedStyles,
      padding: "12px 24px",
    }}>
      {clickProgress > 0 ? "Clicking..." : "Click Me"}
    </div>
  );
};
```

---

## Migration Guide

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for step-by-step instructions on migrating existing components.

---

## Support

- **Documentation**: [docs/](../docs/)
- **Examples**: See `Sandbox.tsx` for complete example
- **Issues**: Report bugs in GitHub issues
- **Questions**: Ask in team chat

---

**Happy animating! 🎬✨**
