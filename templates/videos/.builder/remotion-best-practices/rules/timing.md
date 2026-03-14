---
name: timing
description: Interpolation curves in Remotion - linear, easing, spring animations
metadata:
  tags: spring, bounce, easing, interpolation
---

A simple linear interpolation is done using the `interpolate` function.

```ts
import {interpolate} from 'remotion';

const opacity = interpolate(frame, [0, 100], [0, 1]);
```

By default, the values are not clamped, so the value can go outside the range [0, 1].
Here is how they can be clamped:

```ts
const opacity = interpolate(frame, [0, 100], [0, 1], {
  extrapolateRight: 'clamp',
  extrapolateLeft: 'clamp',
});
```

## Spring animations

Spring animations have a more natural motion. They go from 0 to 1 over time.

```ts
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';

const frame = useCurrentFrame();
const {fps} = useVideoConfig();

const scale = spring({
  frame,
  fps,
});
```

### Physical properties

The default configuration is: `mass: 1, damping: 10, stiffness: 100`.
This leads to the animation having a bit of bounce before it settles.

Here are some common configurations:

```tsx
const smooth = {damping: 200}; // Smooth, no bounce (subtle reveals)
const snappy = {damping: 20, stiffness: 200}; // Snappy, minimal bounce (UI elements)
const bouncy = {damping: 8}; // Bouncy entrance (playful animations)
const heavy = {damping: 15, stiffness: 80, mass: 2}; // Heavy, slow, small bounce
```

### Delay

Use the `delay` parameter to delay the animation by a number of frames.

### Duration

Use `durationInFrames` to stretch the animation to a specific duration.

### Combining spring() with interpolate()

Map spring output (0-1) to custom ranges:

```tsx
const springProgress = spring({ frame, fps });
const rotation = interpolate(springProgress, [0, 1], [0, 360]);
<div style={{rotate: rotation + 'deg'}} />;
```

## Easing

```ts
import {interpolate, Easing} from 'remotion';

const value1 = interpolate(frame, [0, 100], [0, 1], {
  easing: Easing.inOut(Easing.quad),
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```
