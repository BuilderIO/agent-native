# Quick Start: Creating Your First Composition

This guide will walk you through creating a new video composition with all the powerful features available in Video Studio.

## Features You Get Out of the Box

Every new composition includes:

✅ **Camera Controls** - Pan, zoom, rotate with 6 animatable properties  
✅ **Cursor System** - Interactive cursor with position tracking and click detection  
✅ **Cursor Interactions** - Add hover/click animations to any component  
✅ **Multi-Keyframe Selection** - Select and move multiple keyframes at once  
✅ **View Range** - Focus on specific timeline sections  
✅ **Playback Speed Control** - 0.25× to 2× speed adjustment  
✅ **Track Properties** - Visual easing selector and property editor  
✅ **Auto-Save** - Changes persist to localStorage  
✅ **Save as Default** - Persist to code registry  

---

## Method 1: AI-Powered Generation (Easiest)

### Step 1: Click "+ New Composition"

In the sidebar, click the **"+ New Composition"** button (dashed border with plus icon).

### Step 2: Describe Your Video

A popover opens with a textarea. Type what you want to create:

**Examples:**
- `"Animated text that types in character by character"`
- `"Logo reveal with particle burst effect"`
- `"Product showcase with smooth camera movements"`
- `"Interactive button demo with hover effects"`

### Step 3: Attach References (Optional)

Click **"+ Attach"** to add:
- Logo images (PNG, SVG, JPG)
- Reference videos
- Brand assets
- Design mockups

The agent will use these to generate accurate content.

### Step 4: Submit

Press **Enter** (or click the ↑ arrow button).

**What Happens:**
1. A new composition is created at `/c/new`
2. Loading spinner appears: "Generating..."
3. The agent analyzes your prompt and attachments
4. Creates a new React component in `client/remotion/compositions/`
5. Registers it in `client/remotion/registry.ts`
6. Sets up camera, cursor, and animation tracks
7. New composition appears in sidebar when complete

### Step 5: Customize

Once generated:
- **Edit Properties**: Click Properties tab to modify colors, text, etc.
- **Adjust Timing**: Click tracks in timeline to edit duration and easing
- **Add Keyframes**: Click camera icon or click on video to add cursor positions
- **Test Interactions**: Play the video to see cursor hover/click effects
- **Save Changes**: Click green "Save" button to persist to code

---

## Method 2: Manual Creation (Advanced)

### Step 1: Create the Component

Create a new file: `client/remotion/compositions/MyVideo.tsx`

```typescript
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraHost } from "@/remotion/CameraHost";
import { Cursor } from "@/remotion/ui-components/Cursor";
import { findTrack, getPropValueKeyframed } from "@/remotion/trackAnimation";
import type { AnimationTrack } from "@/types";

export type MyVideoProps = {
  tracks?: AnimationTrack[];
  title?: string;
  backgroundColor?: string;
};

export const MyVideo: React.FC<MyVideoProps> = ({
  tracks = [],
  title = "Hello World",
  backgroundColor = "#0a0a0a",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Get cursor data
  const cursorTrack = findTrack(tracks, "cursor");
  const cursorX = getPropValueKeyframed(frame, fps, cursorTrack, "x", 960);
  const cursorY = getPropValueKeyframed(frame, fps, cursorTrack, "y", 540);
  const cursorOpacity = getPropValueKeyframed(frame, fps, cursorTrack, "opacity", 1);
  const cursorScale = getPropValueKeyframed(frame, fps, cursorTrack, "scale", 1);
  const isClicking = getPropValueKeyframed(frame, fps, cursorTrack, "isClicking", 0) > 0.5;

  // Get click frames
  const clickStartFrames: number[] = [];
  const isClickingProp = cursorTrack?.animatedProps?.find(p => p.property === "isClicking");
  if (isClickingProp?.keyframes) {
    for (const kf of isClickingProp.keyframes) {
      if (parseFloat(kf.value) > 0.5) {
        clickStartFrames.push(kf.frame);
      }
    }
  }

  return (
    <CameraHost tracks={tracks}>
      <AbsoluteFill style={{ backgroundColor }}>
        {/* Your content here */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
          }}
        >
          <h1 style={{ color: "#ffffff", fontSize: 64 }}>
            {title}
          </h1>
        </div>

        {/* Cursor (required for interactions) */}
        <Cursor
          x={cursorX}
          y={cursorY}
          opacity={cursorOpacity}
          scale={cursorScale}
          type="default"
          isClicking={isClicking}
          clickStartFrames={clickStartFrames}
          currentFrame={frame}
        />
      </AbsoluteFill>
    </CameraHost>
  );
};
```

### Step 2: Register the Composition

Add to `client/remotion/registry.ts`:

```typescript
import { MyVideo, type MyVideoProps } from "./compositions/MyVideo";

export const compositions: CompositionEntry[] = [
  // ... existing compositions
  {
    id: "my-video",
    title: "My Video",
    description: "My custom video composition",
    component: MyVideo,
    durationInFrames: 240, // 8 seconds
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      title: "Hello World",
      backgroundColor: "#0a0a0a",
    } satisfies MyVideoProps,
    tracks: [
      // Camera track (REQUIRED)
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 240,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [] },
        ],
      },
      // Cursor track (REQUIRED for interactions)
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 240,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "960", to: "960", unit: "px", keyframes: [] },
          { property: "y", from: "540", to: "540", unit: "px", keyframes: [] },
          { property: "opacity", from: "1", to: "1", unit: "", keyframes: [] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [] },
          { property: "type", from: "default", to: "default", unit: "" },
          { property: "isClicking", from: "0", to: "0", unit: "" },
        ],
      },
    ],
  },
];
```

### Step 3: Export the Component

Add to `client/remotion/compositions/index.ts`:

```typescript
export { MyVideo, type MyVideoProps } from "./MyVideo";
```

### Step 4: Navigate to Your Composition

Open: `http://localhost:8080/c/my-video`

Or click it in the sidebar!

---

## Method 3: Use Helper Functions

For more streamlined creation, use the helper utilities:

```typescript
import {
  createCameraTrack,
  createCursorTrack,
  createFadeInTrack,
  createSlideInTrack,
  createCursorPath,
  createClickEvents,
  addKeyframes,
  validateComposition,
} from "@/utils/compositionHelpers";
import { addComposition } from "@/remotion/registry";
import { MyComponent } from "./compositions/MyComponent";

// Create tracks using helpers
const duration = 240;

const tracks = [
  createCameraTrack(duration),
  createCursorTrack(duration),
  createFadeInTrack("title", "Title Fade", 0, 30),
  createSlideInTrack("subtitle", "Subtitle", 20, 30, "left"),
];

// Validate before adding
const validation = validateComposition(tracks);
if (!validation.valid) {
  console.error("Invalid composition:", validation.errors);
} else {
  // Add to registry
  addComposition({
    id: "my-comp",
    title: "My Composition",
    description: "Created with helpers",
    component: MyComponent,
    durationInFrames: duration,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {},
    tracks,
  });
}
```

---

## Adding Cursor Interactions

### Step 1: Ensure Cursor Track Exists

All compositions created with `createBlankComposition()` or AI generation include a cursor track by default.

### Step 2: Add Interactive Components

In your composition component, use the hover/click hooks:

```typescript
import { useHoverAnimation } from "@/remotion/hooks/useHoverAnimation";
import { useClickAnimation } from "@/remotion/hooks/useClickAnimation";

function MyButton() {
  const bounds = { x: 400, y: 300, width: 200, height: 80 };
  
  // Get cursor data from context
  const { x: cursorX, y: cursorY, isClicking } = useCursorData();
  const clickStartFrames = useClickStartFrames();
  
  // Apply hover animation
  const { isHovered, animation: hoverAnim } = useHoverAnimation(
    "MyButton",
    bounds,
    { x: cursorX, y: cursorY },
    frame,
    fps
  );
  
  // Apply click animation
  const { animation: clickAnim } = useClickAnimation(
    "MyButton",
    bounds,
    { x: cursorX, y: cursorY, isClicking },
    clickStartFrames,
    frame,
    fps
  );
  
  // Combine transforms
  const scale = 1 + (hoverAnim?.scale || 0) + (clickAnim?.scale || 0);
  const translateY = (hoverAnim?.translateY || 0) + (clickAnim?.translateY || 0);
  
  return (
    <div
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        transform: `scale(${scale}) translateY(${translateY}px)`,
      }}
    >
      Click Me
    </div>
  );
}
```

### Step 3: Configure in UI

1. Open composition
2. Go to **Properties → Cursor Interactions**
3. Click **"+ Add Hover Animation"**
4. Set **Component Type**: `MyButton`
5. Configure **scale**, **translateY**, **rotate**, **duration**
6. Click **"+ Add Click Animation"** for click effects

**Result:** All instances of `MyButton` will animate when the cursor hovers or clicks!

---

## Common Patterns

### Pattern 1: Text Reveal Animation

```typescript
createAnimationTrack(
  "text-reveal",
  "Text Reveal",
  0,
  30,
  [
    { property: "opacity", from: "0", to: "1", unit: "" },
    { property: "scale", from: "0.8", to: "1", unit: "" },
    { property: "translateY", from: "20", to: "0", unit: "px" },
  ],
  "spring"
)
```

### Pattern 2: Logo Entrance

```typescript
createAnimationTrack(
  "logo-entrance",
  "Logo Entrance",
  15,
  45,
  [
    { property: "scale", from: "0.5", to: "1", unit: "" },
    { property: "opacity", from: "0", to: "1", unit: "" },
    { property: "rotateY", from: "-180", to: "0", unit: "deg" },
  ],
  "spring"
)
```

### Pattern 3: Cursor Movement Path

```typescript
import { createCursorPath, createClickEvents, addKeyframes } from "@/utils/compositionHelpers";

// Define path
const frames = [0, 60, 120, 180];
const positions = [
  { x: 400, y: 300 },  // Start
  { x: 800, y: 400 },  // Move right
  { x: 600, y: 600 },  // Move down-left
  { x: 400, y: 300 },  // Return to start
];

const pathKeyframes = createCursorPath(frames, positions, "expo.inOut");

// Add clicks at specific frames
const clickKeyframes = createClickEvents([70, 130]);

// Apply to cursor track
const cursorTrack = tracks.find(t => t.id === "cursor");
if (cursorTrack) {
  const xProp = cursorTrack.animatedProps.find(p => p.property === "x");
  const yProp = cursorTrack.animatedProps.find(p => p.property === "y");
  const clickProp = cursorTrack.animatedProps.find(p => p.property === "isClicking");
  
  if (xProp) xProp.keyframes = pathKeyframes[0].keyframes;
  if (yProp) yProp.keyframes = pathKeyframes[1].keyframes;
  if (clickProp) clickProp.keyframes = clickKeyframes;
}
```

---

## Best Practices

### ✅ DO

1. **Use AI generation first** - it's the fastest way to get started
2. **Always include camera and cursor tracks** - enables all features
3. **Use spring easing** for natural motion (except camera, use linear)
4. **Add descriptive track labels** - makes timeline easier to navigate
5. **Test on different playback speeds** - catch timing issues early
6. **Save as default** when you're happy with the result
7. **Use the helpers** in `compositionHelpers.ts` for manual creation

### ❌ DON'T

1. **Don't skip validation** - use `validateComposition()` for manual creation
2. **Don't hardcode cursor positions** - use helpers to calculate centers
3. **Don't forget to export** components in `compositions/index.ts`
4. **Don't modify IDs** after creation - breaks URLs and persistence
5. **Don't use variable fps** - always 30fps for consistency
6. **Don't nest CameraHost** - use only at composition root level

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Space** | Play/pause video |
| **C** | Add camera keyframe at current frame |
| **Click Video** | Add cursor position keyframe |
| **Shift+Click** | Multi-select keyframes |
| **Drag Timeline** | Box-select keyframes |
| **Enter** | Submit new composition prompt |

---

## Troubleshooting

### "Cursor not showing"
- Check cursor track exists
- Verify `opacity` is not 0
- Ensure cursor position is within viewport (0-1920, 0-1080)

### "Hover animations not working"
- Confirm cursor track exists in composition
- Add `<Cursor>` component to render tree
- Check component type matches interaction config
- Verify cursor keyframes are set

### "Playback is slow"
- Adjust playback speed dropdown (try 0.5× or 0.75×)
- Large compositions may render slower than 30fps
- This is normal - playback speed compensates

### "Changes not saving"
- Changes auto-save to localStorage per-session
- Click "Save" button to persist to code registry
- Check console for save confirmation

---

## Next Steps

1. **Create Your First Video**: Click "+ New Composition" and try it!
2. **Explore Examples**: Check Kinetic Text, Logo Reveal, Interactive Demo
3. **Read Full Guide**: See `COMPOSITION_GUIDE.md` for advanced features
4. **Watch Video**: [Tutorial] How to Create Animated Videos with Video Studio _(coming soon)_

---

**Need Help?**
- 📚 [Full Documentation](COMPOSITION_GUIDE.md)
- 💬 [Get Support](#reach-support)
- 🐛 [Report Issue](#feedback-negative)
- ✨ [Share Feedback](#feedback-positive)
