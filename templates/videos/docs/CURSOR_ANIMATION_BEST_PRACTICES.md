# Cursor Animation Best Practices

## 🚨 CRITICAL: All Animations Must Be Visible

**NEVER create animations that users cannot see and edit.**

Every visual change MUST be visible in one of these ways:

1. **Animation Tracks** (timeline) - for continuous time-based animations (camera zoom, cursor movement)
2. **Cursor Interactions** (hover zones + click detection) - for cursor-driven state changes (button hover, click responses)

### Important Distinction: Tracks vs. Cursor-Driven Changes

**Use Animation Tracks for:**

- Continuous animations over multiple frames (camera zoom, cursor movement, fade in/out)
- Animations that happen at specific times regardless of cursor

**Use Cursor Interactions for:**

- State changes triggered by cursor position (hover effects)
- State changes triggered by cursor clicks (button press, form submit)
- Visual responses to user interaction

### ❌ BAD: Hardcoded State Change

```typescript
// Hidden logic - user can't see when/why button changes!
const isSending = frame >= 276;
const buttonShape = isSending ? "square" : "circle";
```

### ✅ GOOD: Cursor-Driven State Change

```typescript
// Button morphs when cursor clicks it (visible in cursor track keyframes)
const sendButtonClickFrame =
  clickProp?.keyframes?.find(
    (kf) => kf.frame >= 270 && kf.frame <= 275 && kf.value === "1",
  )?.frame || 0;

const morphProgress =
  sendButtonClickFrame > 0 && frame >= sendButtonClickFrame
    ? Math.min(1, (frame - sendButtonClickFrame) / 12)
    : 0;
```

**Why this is better:** The state change is driven by the cursor click keyframe (visible in timeline), not a hardcoded frame number or separate track.

---

## 🎯 The Three Critical Cursor Rules

### 1. Cursor Position/Movement = Tracks (Registry)

### 2. Cursor Type Changes = Hover Zones (Component)

### 3. All Interactive UI Elements = Registered for Cursor Interactions

**Every button, input, link, card, or clickable element should be registered as interactive**, even if not immediately animated. This:

- Makes elements discoverable in timeline
- Enables adding animations later without code changes
- Provides consistent interaction patterns
- Shows hover/click state in Properties panel

See: [Interactive Elements Guide](./INTERACTIVE_ELEMENTS_GUIDE.md) for complete patterns.

---

## Rule 1: Cursor Position Must Be Defined as Tracks

**❌ NEVER DO THIS:**

```typescript
// DON'T hardcode cursor position in component
const cursorX = interpolate(frame, [0, 100], [0, 1920]);
const cursorY = interpolate(frame, [0, 100], [0, 1080]);

return (
  <AbsoluteFill>
    <Cursor x={cursorX} y={cursorY} />
  </AbsoluteFill>
);
```

**✅ ALWAYS DO THIS:**

```typescript
// In registry.ts - define cursor track
{
  id: "cursor",
  label: "Cursor",
  animatedProps: [
    {
      property: "x",
      keyframes: [
        { frame: 0, value: "2100" },   // start offscreen
        { frame: 40, value: "860" },   // arrive at input
        { frame: 242, value: "860" },  // stay at input
        { frame: 268, value: "1878" }, // move to button
      ],
    },
    {
      property: "y",
      keyframes: [
        { frame: 0, value: "-60" },
        { frame: 40, value: "1025" },
        // ...
      ],
    },
  ],
}

// In component.tsx - let CameraHost render from track
<CameraHost tracks={tracks}>
  {/* Cursor renders automatically */}
</CameraHost>
```

**Why tracks?**

- ✅ Editable in timeline UI
- ✅ Visual representation of movement
- ✅ Copy/paste between compositions
- ✅ No hardcoded logic to maintain

---

## Rule 2: Cursor Type Must Be Determined by Hover Zones

**❌ NEVER DO THIS:**

```typescript
// DON'T manually keyframe cursor type changes
{
  property: "type",
  keyframes: [
    { frame: 0, value: "default" },
    { frame: 52, value: "text" },     // ❌ Fragile! Breaks if cursor path changes
    { frame: 264, value: "pointer" }, // ❌ Hardcoded frame numbers
  ],
}
```

**✅ ALWAYS DO THIS:**

```typescript
// In component.tsx - define hover zones
const cursorHistory = useCursorHistory(cursorTrack, 6);

const textareaHover = useHoverAnimationSmooth(cursorHistory, {
  x: 230,
  y: 985,
  width: 1450,
  height: 95,
  padding: 10,
  cursorType: "text", // Text cursor when over input
});

const sendBtnHover = useHoverAnimationSmooth(cursorHistory, {
  x: 1850,
  y: 1010,
  width: 50,
  height: 50,
  padding: 8,
  cursorType: "pointer", // Pointer when over button
});

const autoCursorType = useCursorTypeFromHover([
  textareaHover,
  sendBtnHover, // Last wins (z-index priority)
]);

<CameraHost tracks={tracks} autoCursorType={autoCursorType}>
```

**Why hover zones?**

- ✅ Cursor automatically changes when hovering buttons/inputs
- ✅ Works even if you change cursor path
- ✅ Realistic browser behavior
- ✅ No fragile frame-based type changes
- ✅ Self-documenting (shows what areas are interactive)

---

## Complete Example: FusionInputBox

See `app/remotion/compositions/FusionInputBox.tsx` for reference.

### Step 1: Define Cursor Track (Registry)

```typescript
// In app/remotion/registry.ts
{
  id: "cursor",
  animatedProps: [
    {
      property: "x",
      keyframes: [
        { frame: 0, value: "2100" },   // offscreen
        { frame: 40, value: "860" },   // at textarea
        { frame: 268, value: "1878" }, // at send button
        { frame: 340, value: "2200" }, // exit offscreen
      ],
    },
    {
      property: "y",
      keyframes: [
        { frame: 0, value: "-60" },
        { frame: 56, value: "1025" },
        { frame: 340, value: "1160" },
      ],
    },
    {
      property: "isClicking",
      keyframes: [
        { frame: 58, value: "1" },  // click textarea
        { frame: 272, value: "1" }, // click send
      ],
    },
    {
      property: "opacity",
      keyframes: [
        { frame: 0, value: "0" },
        { frame: 4, value: "1" },
        { frame: 330, value: "1" },
        { frame: 340, value: "0" },
      ],
    },
    // NO type keyframes - hover zones handle it!
    { property: "type", from: "default", to: "default", unit: "" },
  ],
}
```

### Step 2: Define Hover Zones (Component)

```typescript
// In FusionInputBox.tsx
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";

export const FusionInputBox: React.FC = ({ tracks = [] }) => {
  // Get cursor history
  const cursorTrack = findTrack(tracks, "cursor");
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Define hover zones for ALL interactive elements
  const textareaHover = useHoverAnimationSmooth(cursorHistory, {
    x: 230, y: 985, width: 1450, height: 95, padding: 10, cursorType: "text"
  });

  const sendBtnHover = useHoverAnimationSmooth(cursorHistory, {
    x: 1850, y: 1010, width: 50, height: 50, padding: 8, cursorType: "pointer"
  });

  const newAutomationBtnHover = useHoverAnimationSmooth(cursorHistory, {
    x: 230, y: 318, width: 170, height: 36, padding: 6, cursorType: "pointer"
  });

  const templatesLibraryBtnHover = useHoverAnimationSmooth(cursorHistory, {
    x: 420, y: 318, width: 180, height: 36, padding: 6, cursorType: "pointer"
  });

  const startProcessBtnHover = useHoverAnimationSmooth(cursorHistory, {
    x: 935, y: 690, width: 140, height: 36, padding: 6, cursorType: "pointer"
  });

  const togglesHover = useHoverAnimationSmooth(cursorHistory, {
    x: 800, y: 520, width: 500, height: 120, padding: 8, cursorType: "pointer"
  });

  const settingsIconsHover = useHoverAnimationSmooth(cursorHistory, {
    x: 1700, y: 1010, width: 120, height: 50, padding: 6, cursorType: "pointer"
  });

  // Aggregate - last one wins (higher z-index)
  const autoCursorType = useCursorTypeFromHover([
    newAutomationBtnHover,
    templatesLibraryBtnHover,
    startProcessBtnHover,
    togglesHover,
    settingsIconsHover,
    textareaHover,  // Higher priority
    sendBtnHover,   // Highest priority
  ]);

  return (
    <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
      {/* Cursor type changes automatically when hovering UI elements */}
    </CameraHost>
  );
};
```

**STEP 6: Remove old cursor imports**

````typescript
// Remove manual Cursor rendering:
// import { Cursor } from "@/remotion/ui-components/Cursor";

// Keep these for hover zones:
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";
```"}
````
