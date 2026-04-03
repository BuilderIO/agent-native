---
name: animation-tracks
description: Track-based animation system. AnimationTrack, AnimatedProp types, findTrack/trackProgress/getPropValue helpers. Read before editing animations.
---

# Animation Tracks

Every visual animation in the studio is controlled by tracks. Tracks are the interface between the timeline UI and the composition code.

## Core Types (`app/types.ts`)

### AnimationTrack

```typescript
interface AnimationTrack {
  id: string;           // Unique, stable (e.g. "lr-ring"). Used by findTrack().
  label: string;        // Display name in the timeline
  startFrame: number;
  endFrame: number;
  easing: EasingKey;    // "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring"
  animatedProps?: AnimatedProp[];
}
```

### AnimatedProp

```typescript
interface AnimatedProp {
  property: string;       // e.g. "opacity", "translateY"
  from: string;           // Start value as string
  to: string;             // End value as string
  unit: string;           // CSS unit: "px", "deg", "" (none)
  description?: string;   // Plain-English explanation
  codeSnippet?: string;   // Read-only source shown in Properties panel
  programmatic?: boolean; // true -> no editable from/to
  parameters?: Array<{    // Adjustable params for programmatic animations
    name: string;
    label: string;
    default: number;
    min?: number;
    max?: number;
    step?: number;
  }>;
  parameterValues?: Record<string, number>;
}
```

## Helper Functions (`app/remotion/trackAnimation.ts`)

```typescript
// Returns 0->1 progress for the track at the given frame
trackProgress(frame, fps, track): number

// Interpolates from->to based on progress for a named property
getPropValue(progress, track, property, defaultFrom, defaultTo): number

// Finds a track by id; returns fallback if not found
findTrack(tracks, id, fallback): AnimationTrack
```

## Track Types

### Duration Tracks (startFrame != endFrame)

For animations with clear start/end: spring animations, fades, movements.

### Keyframe Tracks (startFrame === endFrame)

For instant state changes: tab switches, modal opens. Rendered as diamond markers in the timeline.

```typescript
{
  id: "switch-tab",
  label: "Switch Tab",
  startFrame: 60,
  endFrame: 60,  // Same = keyframe diamond
  easing: "linear",
}
```

Usage: `const activeTab = frame >= switchTrack.startFrame ? "B" : "A";`

## Programmatic Animations

For complex effects that can't be a simple from->to:

1. Add an `AnimatedProp` with `programmatic: true` or a `codeSnippet`
2. Provide a clear `description` in plain English
3. Consider exposing key values as `parameters` for user adjustment

Even with programmatic animations, always support common animated properties (`scale`, `opacity`, `translateX`, `translateY`, `rotation`) via `getPropValue()` so users can layer standard animations on top.

## Critical Rules

- **NEVER hardcode frame checks** -- use tracks for ALL timing
- **ALL animations must be registered** as tracks in the registry
- Update `codeSnippet` and `description` when you change programmatic animation logic
- Keyframe tracks (startFrame === endFrame) render automatically as diamonds
- Expression props (`codeSnippet` or `programmatic: true`) show a purple `fx` badge
