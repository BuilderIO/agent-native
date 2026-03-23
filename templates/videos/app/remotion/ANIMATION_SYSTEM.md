# Video Studio Animation System

## Core Principle: Duration-Based Animation Progress

**CRITICAL**: All animations MUST respect the `animation.duration` setting from the UI. Animation progress should be calculated based on **elapsed frames since interaction start**, NOT cursor history length or arbitrary frame counts.

## The Correct Pattern

### ✅ DO: Frame-Based Duration Tracking

```typescript
// 1. Get current frame
const frame = useCurrentFrame();

// 2. Track when interaction started using refs
const hoverStartFrameRef = useRef<number | null>(null);
const clickStartFrameRef = useRef<number | null>(null);

// 3. Update refs on state changes
if (hoverState.isHovering && hoverStartFrameRef.current === null) {
  hoverStartFrameRef.current = frame;
} else if (!hoverState.isHovering) {
  hoverStartFrameRef.current = null;
}

// 4. Calculate elapsed frames
const hoverElapsedFrames =
  hoverStartFrameRef.current !== null ? frame - hoverStartFrameRef.current : 0;

// 5. Compute progress based on animation.duration
const animationProgress = Math.min(1, elapsedFrames / animation.duration);
```

### ❌ DON'T: Cursor History-Based Progress

```typescript
// WRONG - ignores duration setting!
const progress = hoverFrames / cursorHistory.length;
```

### ❌ DON'T: Fixed Frame Counts

```typescript
// WRONG - doesn't respect UI-configured duration!
const progress = Math.min(1, frame / 30);
```

## Implementation Checklist

When creating or modifying interactive components:

- [ ] Import `useCurrentFrame` from Remotion
- [ ] Create refs to track interaction start frames
- [ ] Update refs when hover/click state changes
- [ ] Calculate elapsed frames since interaction start
- [ ] Compute progress as `Math.min(1, elapsedFrames / animation.duration)`
- [ ] Apply progress to all animated properties
- [ ] Return duration-based progress values in hook results

## Why This Matters

**User Expectation**: When a user sets animation duration to 10 frames in the UI, the animation should complete in exactly 10 frames.

**Before Fix**: Animations would complete based on cursor history length or hardcoded frame counts, completely ignoring the UI setting.

**After Fix**: Animations complete in the exact duration specified, making the UI controls meaningful and predictable.

## Color Animation Best Practices

When animating colors (backgroundColor, borderColor, etc.):

1. **Blend from current prop value to target**, not from hardcoded "from" keyframe:

   ```typescript
   // Get target from last keyframe
   const animatedTargets = useMemo(() => {
     const result: Record<string, number | string> = {};
     animations.forEach((animation) => {
       animation.properties.forEach((prop) => {
         if (prop.keyframes.length > 0) {
           const lastKeyframe = prop.keyframes[prop.keyframes.length - 1];
           result[prop.property] = lastKeyframe.value;
         }
       });
     });
     return result;
   }, [animations]);
   ```

2. **Use interpolateColors() for smooth RGB blending**:

   ```typescript
   const blendedColor = interpolateColors(
     currentStaticColor,
     targetColor,
     progress,
   );
   ```

3. **Ignore animation "from" keyframes for dynamic props** to prevent color flashing when user changes component props

## Reference Implementation

See `app/remotion/hooks/useInteractiveComponent.ts` for the complete, correct implementation of:

- Duration-based progress calculation
- Frame tracking with refs
- Animated targets for color blending
- Safe integration with AnimatedElement

## Testing Your Animation

To verify your animation respects duration:

1. Set hover animation duration to 10 frames in the UI
2. Hover over the element and watch the preview
3. Count frames - animation should complete in exactly 10 frames
4. Try different durations (5, 20, 30) and verify each works correctly

If the animation takes longer/shorter than specified, you're not using duration-based progress correctly.
