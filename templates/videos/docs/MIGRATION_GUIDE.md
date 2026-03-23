# Migration Guide: Converting to AnimatedElement System

Step-by-step guide to migrate existing Remotion components to use the new `AnimatedElement` wrapper system.

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Migration Steps](#migration-steps)
3. [Example: Sandbox Component](#example-sandbox-component)
4. [Common Patterns](#common-patterns)
5. [🎯 CRITICAL: Migrating Hardcoded Cursor to Track](#-critical-migrating-hardcoded-cursor-to-track)
6. [Troubleshooting](#troubleshooting)
7. [Checklist](#checklist)

---

## Before You Start

### What You'll Gain

✅ **Less boilerplate** - No manual hover zone setup  
✅ **Type safety** - Compile-time checks for props  
✅ **Automatic wiring** - Animation system handled for you  
✅ **Easier maintenance** - Centralized animation logic  
✅ **Better performance** - Optimized cursor history sharing

### Prerequisites

- Existing composition with hover/click interactions
- Animations stored in `videos-element-animations` localStorage
- Component using `useHoverAnimationSmooth` and `calculateElementAnimations`

### Estimated Time

- Simple component (1-3 elements): **15 minutes**
- Complex component (5+ elements): **30-45 minutes**

---

## Migration Steps

### Step 1: Move Animation Initialization to Module Level

**Before:**

```typescript
export const MyComposition = () => {
  useEffect(() => {
    initializeSandboxAnimations(); // ❌ Too late!
  }, []);

  // ... rest of component
};
```

**After:**

```typescript
import {
  initializeDefaultAnimations,
  AnimationPresets,
} from "@/remotion/utils/animationHelpers";

// ✅ At module level (before component)
initializeDefaultAnimations("my-composition", [
  AnimationPresets.hoverLift("Card"),
  AnimationPresets.clickPress("Card"),
  AnimationPresets.hoverGlow("Button", "#3b82f6"),
]);

export const MyComposition = () => {
  // ... component code
};
```

### Step 2: Extract Element Components

Create separate components for each interactive element.

**Before:**

```typescript
// Everything in one file
<div style={{
  transform: cardStyles.transform,
  background: cardStyles.backgroundColor,
  // ... lots of inline styles
}}>
  Card Content
</div>
```

**After:**

```typescript
// MyCard.tsx
import type { AnimatedStyles } from "@/remotion/components/AnimatedElement";

export interface MyCardProps {
  animatedStyles: AnimatedStyles;
  title: string;
  description: string;
}

export const MyCard: React.FC<MyCardProps> = ({ animatedStyles, title, description }) => {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      transform: animatedStyles.transform,
      filter: animatedStyles.filter,
      opacity: animatedStyles.opacity,
      backgroundColor: animatedStyles.backgroundColor,
      borderColor: animatedStyles.borderColor,
      borderWidth: animatedStyles.borderWidth,
      borderStyle: "solid",
      borderRadius: animatedStyles.borderRadius,
      boxShadow: animatedStyles.boxShadow,
      // ... your custom styles
    }}>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
};
```

### Step 3: Replace Manual Hover Zones with AnimatedElement

**Before:**

```typescript
// Manual hover zone setup
const hCard1 = useHoverAnimationSmooth(cursorHistory, {
  x: 100, y: 200, width: 400, height: 300, padding: 8, cursorType: "pointer"
});

const cardAnims = getAnimationsForElement("my-composition", "Card");
const cardHover = cardAnims.find(a => a.triggerType === "hover");
const cardClick = cardAnims.find(a => a.triggerType === "click");

const card1Styles = calculateElementAnimations({
  elementType: "Card",
  baseColor: "#1e293b",
  hoverProgress: hCard1.hoverProgress,
  clickProgress: getClickProgress(frame, fps, cursorTrack, clickStartFrames, {...}, 10),
  hoverAnimation: cardHover,
  clickAnimation: cardClick,
});

// Render
<div style={{ position: "absolute", left: 100, top: 200, width: 400, height: 300 }}>
  <MyCard animatedStyles={card1Styles} title="Card 1" />
</div>
```

**After:**

```typescript
// Automatic with AnimatedElement
<AnimatedElement
  id="card-1"
  elementType="Card"
  label="Card 1"
  compositionId="my-composition"
  position={{ x: 100, y: 200 }}
  size={{ width: 400, height: 300 }}
  baseColor="#1e293b"
  baseBorderColor="#334155"
  cursorHistory={cursorHistory}
  getAnimationsForElement={getAnimationsForElement}
  cursorTrack={cursorTrack}
  clickStartFrames={clickStartFrames}
>
  {(animatedStyles) => (
    <MyCard animatedStyles={animatedStyles} title="Card 1" />
  )}
</AnimatedElement>
```

### Step 4: Update Hover State Tracking

**Before:**

```typescript
const allHoverStates = [hCard1, hCard2, hCard3];
const autoCursorType = useCursorTypeFromHover(allHoverStates);

const hoveredIdx = useMemo(
  () => allHoverStates.findIndex((s) => s.hoverProgress > 0),
  [allHoverStates],
);

useEffect(() => {
  const elementMap = [
    { id: "card1", type: "Card", label: "Card 1" },
    // ...
  ];
  if (hoveredIdx >= 0) {
    setCurrentElement(elementMap[hoveredIdx]);
  } else {
    setCurrentElement(null);
  }
}, [hoveredIdx]);
```

**After:**

```typescript
const [hoveredElement, setHoveredElement] = useState<string | null>(null);

const handleHoverChange = (elementId: string, hovered: boolean) => {
  if (hovered) {
    setHoveredElement(elementId);
  } else if (hoveredElement === elementId) {
    setHoveredElement(null);
  }
};

useEffect(() => {
  const elementMap: Record<string, { type: string; label: string }> = {
    "card-1": { type: "Card", label: "Card 1" },
    "card-2": { type: "Card", label: "Card 2" },
    // ...
  };

  if (hoveredElement) {
    const element = elementMap[hoveredElement];
    if (element) {
      setCurrentElement({
        id: hoveredElement,
        ...element,
        compositionId: "my-composition"
      });
    }
  } else {
    setCurrentElement(null);
  }
}, [hoveredElement]);

// Then in AnimatedElement
<AnimatedElement
  // ... other props
  onHoverChange={handleHoverChange}
>
```

### Step 5: Consolidate Element Rendering

**Before:**

```typescript
// Lots of duplication
<div style={{ position: "absolute", left: 100, top: 200, width: 400, height: 300 }}>
  <Card1 animatedStyles={card1Styles} />
</div>
<div style={{ position: "absolute", left: 520, top: 200, width: 400, height: 300 }}>
  <Card2 animatedStyles={card2Styles} />
</div>
<div style={{ position: "absolute", left: 940, top: 200, width: 400, height: 300 }}>
  <Card3 animatedStyles={card3Styles} />
</div>
```

**After:**

```typescript
// Data-driven rendering
const CARDS = [
  { id: "card-1", x: 100, y: 200, title: "Card 1", description: "..." },
  { id: "card-2", x: 520, y: 200, title: "Card 2", description: "..." },
  { id: "card-3", x: 940, y: 200, title: "Card 3", description: "..." },
];

{CARDS.map(card => (
  <AnimatedElement
    key={card.id}
    id={card.id}
    elementType="Card"
    label={card.title}
    compositionId="my-composition"
    position={{ x: card.x, y: card.y }}
    size={{ width: 400, height: 300 }}
    baseColor="#1e293b"
    cursorHistory={cursorHistory}
    getAnimationsForElement={getAnimationsForElement}
    cursorTrack={cursorTrack}
    clickStartFrames={clickStartFrames}
    onHoverChange={handleHoverChange}
  >
    {(animatedStyles) => (
      <MyCard
        animatedStyles={animatedStyles}
        title={card.title}
        description={card.description}
      />
    )}
  </AnimatedElement>
))}
```

---

## Example: Sandbox Component

### Before (Original)

```typescript
// Sandbox.tsx (simplified)
export const Sandbox = ({ tracks }) => {
  const { getAnimationsForElement } = useCurrentElement();
  const cursorHistory = useCursorHistory(cursorTrack, 6);

  // Manual hover zones (repeated for each element)
  const hCard1 = useHoverAnimationSmooth(cursorHistory, {
    x: CONTENT_X, y: ROW1_Y, width: CARD_W, height: CARD_H, padding: 8
  });
  const hCard2 = useHoverAnimationSmooth(cursorHistory, {
    x: CONTENT_X + CARD_W + CARD_GAP, y: ROW1_Y, width: CARD_W, height: CARD_H, padding: 8
  });
  // ... repeated for all cards

  // Manual animation resolution
  const cardAnims = getAnimationsForElement("sandbox", "AutomationCard");
  const cardHover = cardAnims.find(a => a.triggerType === "hover");
  const cardClick = cardAnims.find(a => a.triggerType === "click");

  // Manual style calculation
  const card1Styles = calculateElementAnimations({
    elementType: "AutomationCard",
    baseColor: "#101B20",
    hoverProgress: hCard1.hoverProgress,
    clickProgress: getClickProgress(...), // Complex call
    hoverAnimation: cardHover,
    clickAnimation: cardClick,
  });
  // ... repeated for all cards

  // Manual hover tracking
  const allHoverStates = [hCard1, hCard2, hCard3, hCard4, hCard5];
  const hoveredIdx = useMemo(() =>
    allHoverStates.findIndex(s => s.hoverProgress > 0), [allHoverStates]
  );

  // Manual element tracking
  useEffect(() => {
    const elementMap = [...];
    if (hoveredIdx >= 0) setCurrentElement(elementMap[hoveredIdx]);
  }, [hoveredIdx]);

  return (
    <AbsoluteFill>
      <SandboxCard card={CARDS[0]} animatedStyles={card1Styles} />
      <SandboxCard card={CARDS[1]} animatedStyles={card2Styles} />
      {/* ... */}
    </AbsoluteFill>
  );
};
```

### After (With AnimatedElement)

```typescript
// Sandbox.tsx (migrated)
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { initializeDefaultAnimations, AnimationPresets } from "@/remotion/utils/animationHelpers";

// ✅ Module-level initialization
initializeDefaultAnimations("sandbox", [
  AnimationPresets.hoverLift("AutomationCard"),
  AnimationPresets.clickPress("AutomationCard"),
]);

export const Sandbox = ({ tracks }) => {
  const { getAnimationsForElement } = useCurrentElement();
  const cursorHistory = useCursorHistory(cursorTrack, 6);
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);

  // ✅ Simple hover tracking
  const handleHoverChange = (id: string, hovered: boolean) => {
    setHoveredElement(hovered ? id : null);
  };

  // ✅ Automatic element tracking
  useEffect(() => {
    if (hoveredElement) {
      const card = CARDS.find(c => c.id === hoveredElement);
      if (card) {
        setCurrentElement({
          id: hoveredElement,
          type: "AutomationCard",
          label: card.title,
          compositionId: "sandbox"
        });
      }
    } else {
      setCurrentElement(null);
    }
  }, [hoveredElement]);

  return (
    <AbsoluteFill>
      {/* ✅ Clean, declarative rendering */}
      {CARDS.map((card, i) => (
        <AnimatedElement
          key={card.id}
          id={card.id}
          elementType="AutomationCard"
          label={card.title}
          compositionId="sandbox"
          position={{ x: CARD_POSITIONS[i].x, y: CARD_POSITIONS[i].y }}
          size={{ width: CARD_POSITIONS[i].w, height: CARD_POSITIONS[i].h }}
          baseColor="#101B20"
          baseBorderColor="#22353D"
          cursorHistory={cursorHistory}
          getAnimationsForElement={getAnimationsForElement}
          cursorTrack={cursorTrack}
          clickStartFrames={clickStartFrames}
          onHoverChange={handleHoverChange}
        >
          {(animatedStyles) => (
            <SandboxCard card={card} animatedStyles={animatedStyles} />
          )}
        </AnimatedElement>
      ))}
    </AbsoluteFill>
  );
};
```

**Lines of code:**

- Before: ~250 lines
- After: ~80 lines
- **Reduction: 68%**

---

## Common Patterns

### Pattern 1: Nested Interactive Elements

For elements like buttons inside cards:

```typescript
<AnimatedElement id="card" elementType="Card" {...}>
  {(cardStyles) => (
    <div style={cardStyles}>
      <AnimatedElement id="button" elementType="Button" {...}>
        {(buttonStyles) => (
          <button style={buttonStyles}>Click</button>
        )}
      </AnimatedElement>
    </div>
  )}
</AnimatedElement>
```

### Pattern 2: Dynamic Element Lists

```typescript
const items = [/* ... */];

{items.map(item => (
  <AnimatedElement
    key={item.id}
    id={item.id}
    elementType="ListItem"
    position={{ x: item.x, y: item.y }}
    size={{ width: 200, height: 60 }}
    // ... rest of props
  >
    {(animatedStyles) => (
      <ListItem data={item} animatedStyles={animatedStyles} />
    )}
  </AnimatedElement>
))}
```

### Pattern 3: Conditional Elements

```typescript
{showButton && (
  <AnimatedElement {...}>
    {(animatedStyles) => <Button animatedStyles={animatedStyles} />}
  </AnimatedElement>
)}
```

---

## 🎯 CRITICAL: Migrating Hardcoded Cursor to Track

If your composition manually renders a cursor with `interpolate()` for x/y position, you **MUST** migrate it to use cursor tracks.

### Why This Migration is Critical

✅ **Editable in timeline** - Visual keyframe editing
✅ **Consistent pattern** - Same as camera tracks
✅ **Prevents bugs** - No manual interpolation errors
✅ **Reusable** - Copy cursor paths between compositions

### Migration Steps

**STEP 1: Find hardcoded cursor logic**

Look for patterns like this:

```typescript
// ❌ OLD PATTERN - MUST BE REMOVED
const cursorX = interpolate(frame, [0, 100], [0, 1920]);
const cursorY = interpolate(frame, [0, 100], [0, 1080]);
const cursorType = frame > 50 ? "pointer" : "default";

return (
  <AbsoluteFill>
    {/* ... your UI ... */}
    <Cursor x={cursorX} y={cursorY} type={cursorType} />
  </AbsoluteFill>
);
```

**STEP 2: Extract cursor keyframes**

Identify all cursor position changes and convert to keyframes:

```typescript
// If you had:
// Frame 0-40: x from 2100 to 860
// Frame 40-242: x stays at 860
// Frame 242-268: x from 860 to 1878

// Convert to keyframes:
{ property: "x", keyframes: [
  { frame: 0, value: "2100" },
  { frame: 40, value: "860" },
  { frame: 242, value: "860" },
  { frame: 268, value: "1878" },
]}
```

**STEP 3: Create cursor track in registry**

```typescript
// In registry.ts, add to your composition's tracks array:
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
        { frame: 0, value: "2100" },
        { frame: 40, value: "860" },
        { frame: 242, value: "860" },
        { frame: 268, value: "1878" },
        { frame: 340, value: "2200" },
      ],
    },
    {
      property: "y",
      from: "540",
      to: "540",
      unit: "px",
      keyframes: [
        { frame: 0, value: "-60" },
        { frame: 40, value: "945" },
        { frame: 56, value: "1025" },
        { frame: 284, value: "1025" },
        { frame: 340, value: "1160" },
      ],
    },
    {
      property: "type",
      from: "default",
      to: "default",
      unit: "",
      keyframes: [
        { frame: 0, value: "default" },
        { frame: 52, value: "text" },
        { frame: 264, value: "pointer" },
      ],
    },
    {
      property: "isClicking",
      from: "0",
      to: "0",
      unit: "",
      keyframes: [
        { frame: 58, value: "1" },  // click at frame 58
        { frame: 272, value: "1" }, // click at frame 272
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
        { frame: 330, value: "1" },
        { frame: 340, value: "0" },
      ],
    },
  ],
}
```

**STEP 4: Update component to use CameraHost**

```typescript
// ✅ NEW PATTERN
export const MyComposition: React.FC<MyProps> = ({ tracks = [] }) => {
  const frame = useCurrentFrame();

  // Remove all manual cursor logic!
  // Remove: cursorX, cursorY, cursorType calculations
  // Remove: <Cursor> component

  return (
    <CameraHost tracks={tracks}>
      {/* CameraHost renders cursor from track automatically */}
      <AbsoluteFill>
        {/* Your UI components */}
      </AbsoluteFill>
    </CameraHost>
  );
};
```

**STEP 5: Add hover zones for automatic cursor types**

**🎯 CRITICAL:** Instead of manually keyframing cursor type changes, define hover zones:

```typescript
import { useCursorHistory } from "@/remotion/hooks/useCursorHistory";
import { useHoverAnimationSmooth } from "@/remotion/hooks/useHoverAnimationSmooth";
import { useCursorTypeFromHover } from "@/remotion/hooks/useCursorTypeFromHover";

// In your component:
const cursorTrack = findTrack(tracks, "cursor");
const cursorHistory = useCursorHistory(cursorTrack, 6);

// Define hover zones for each interactive element
const submitBtnHover = useHoverAnimationSmooth(cursorHistory, {
  x: 500, y: 600, width: 120, height: 40, padding: 8, cursorType: "pointer"
});

const inputHover = useHoverAnimationSmooth(cursorHistory, {
  x: 300, y: 400, width: 400, height: 50, padding: 10, cursorType: "text"
});

const autoCursorType = useCursorTypeFromHover([
  submitBtnHover,
  inputHover, // Last wins
]);

// Pass to CameraHost
<CameraHost tracks={tracks} autoCursorType={autoCursorType}>
```

**Remove manual type keyframes from cursor track:**

```typescript
// Before (remove this):
{ property: "type", keyframes: [
  { frame: 50, value: "text" },
  { frame: 100, value: "pointer" },
]}

// After (hover zones handle it automatically):
{ property: "type", from: "default", to: "default", unit: "" }
```

### Real Example: FusionInputBox

See `app/remotion/compositions/FusionInputBox.tsx` for a complete example with:

**Cursor Track** (`app/remotion/registry.ts`):

- Entry/exit animations (x/y keyframes)
- Multiple click events (isClicking keyframes)
- Opacity fade in/out
- **NO manual type keyframes** (handled by hover zones)

**Hover Zones** (`FusionInputBox.tsx`):

- Textarea hover zone → `cursorType: "text"`
- Send button hover zone → `cursorType: "pointer"`
- All other buttons/icons → `cursorType: "pointer"`
- Toggle switches hover zone → `cursorType: "pointer"`

**Result**: Cursor automatically changes type when hovering over interactive elements!

---

## Troubleshooting

### Issue: Animations not triggering

**Cause**: Initialization happens in useEffect instead of module level

**Fix**: Move `initializeDefaultAnimations()` to top of file

### Issue: Styles not applied

**Cause**: Not using all properties from animatedStyles

**Fix**: Apply all 8 properties:

```typescript
{
  transform: animatedStyles.transform,
  filter: animatedStyles.filter,
  opacity: animatedStyles.opacity,
  backgroundColor: animatedStyles.backgroundColor,
  borderColor: animatedStyles.borderColor,
  borderRadius: animatedStyles.borderRadius,
  borderWidth: animatedStyles.borderWidth,
  boxShadow: animatedStyles.boxShadow,
}
```

### Issue: Type errors with AnimatedElement

**Cause**: Missing required props

**Fix**: Ensure all required props are provided:

- id, elementType, label, compositionId
- position, size
- cursorHistory, getAnimationsForElement

### Issue: Click not detected

**Cause**: Missing cursorTrack or clickStartFrames

**Fix**: Pass both props:

```typescript
<AnimatedElement
  cursorTrack={cursorTrack}
  clickStartFrames={clickStartFrames}
  {...}
>
```

---

## Checklist

Use this checklist when migrating a component:

### Pre-Migration

- [ ] Understand existing hover zones and element positions
- [ ] Identify all interactive elements
- [ ] Note animation types used (hover/click)
- [ ] 🎯 **Check if cursor is hardcoded** (if yes, plan cursor track migration)

### During Migration

- [ ] Move animation initialization to module level
- [ ] 🎯 **Migrate hardcoded cursor to track** (see [Cursor Migration](#-critical-migrating-hardcoded-cursor-to-track))
- [ ] Extract element components (accept animatedStyles)
- [ ] Replace manual hover zones with AnimatedElement
- [ ] Update hover state tracking
- [ ] Replace manual `<Cursor>` with `<CameraHost>` (renders from track)
- [ ] Test each element individually
- [ ] Consolidate with data-driven rendering

### Post-Migration

- [ ] Run validation: `npm run validate:compositions`
- [ ] 🎯 **Verify cursor track shows in timeline** (not hardcoded)
- [ ] Test hover interactions
- [ ] Test click animations
- [ ] Verify Properties panel works
- [ ] Check performance (no regressions)
- [ ] Update documentation/comments
- [ ] Delete old boilerplate code

### Quality Checks

- [ ] 🎯 **Cursor animated via track, not interpolate()** (CRITICAL)
- [ ] All animatedStyles properties applied
- [ ] No hardcoded styles (transform, opacity, etc.)
- [ ] Proper TypeScript types
- [ ] No console errors/warnings
- [ ] Animations work as before
- [ ] Code is cleaner and more maintainable

---

## Need Help?

- **Validation**: Run `npm run validate:compositions` to find issues
- **Documentation**: See [ANIMATED_COMPONENTS_GUIDE.md](./ANIMATED_COMPONENTS_GUIDE.md)
- **Examples**: Check migrated Sandbox component
- **Support**: Ask in team chat

---

**Good luck with your migration! 🚀**
