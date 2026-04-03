---
name: composition-management
description: How to create and register compositions. The registry pattern, CompositionEntry type, track system. Read before adding or modifying compositions.
---

# Composition Management

Compositions are the core unit of the animation studio. Each composition is a Remotion component registered in the central registry.

## Registry (`app/remotion/registry.ts`)

The `compositions` array is the single source of truth. Each entry:

```typescript
type CompositionEntry = {
  id: string;              // URL slug: "logo-reveal" -> /c/logo-reveal
  title: string;
  description: string;
  component: React.FC<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, any>;  // Editable in PropsEditor
  tracks: AnimationTrack[];           // Default track data
};
```

**Important:** `defaultProps` is shown in `PropsEditor` as editable fields. Do NOT include `tracks` in `defaultProps` -- tracks are passed separately.

## Adding a New Composition

1. Create `app/remotion/compositions/MyComp.tsx`
2. Export it from `app/remotion/compositions/index.ts`
3. Add a `CompositionEntry` to the `compositions` array in `registry.ts`
4. Define `tracks` with meaningful IDs, labels, frame ranges, and `animatedProps`

### Component Template

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack } from "@/types";
import { trackProgress, getPropValue, findTrack } from "../trackAnimation";

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "mc-intro",
    label: "Intro",
    startFrame: 0,
    endFrame: 30,
    easing: "spring",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "" },
    ],
  },
];

export const MyComp: React.FC<{ tracks?: AnimationTrack[] }> = ({
  tracks = FALLBACK_TRACKS,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const introTrack = findTrack(tracks, "mc-intro", FALLBACK_TRACKS[0]);
  const p = trackProgress(frame, fps, introTrack);
  const opacity = getPropValue(p, introTrack, "opacity", 0, 1);

  return (
    <AbsoluteFill>
      <div style={{ opacity }}>Content</div>
    </AbsoluteFill>
  );
};
```

## Key Rules

- Every animation MUST be registered as a track -- no hardcoded frame checks
- Always declare `FALLBACK_TRACKS` in the component file
- Use `findTrack()` / `trackProgress()` / `getPropValue()` -- never hardcode values
- Registry is never mutated at runtime -- overrides go through localStorage
- Run `pnpm typecheck` after changes

## Using the create-composition Script

```bash
pnpm script create-composition --id "my-comp" --title "My Composition"
```

This scaffolds the component file, exports, and registry entry.
