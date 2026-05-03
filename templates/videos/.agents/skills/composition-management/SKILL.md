---
name: composition-management
description: How to create and register video compositions. Covers SQL-backed composition records, Remotion component generation, registry defaults, and the track system.
---

# Composition Management

Compositions are the core unit of the animation studio. There are two related storage surfaces:

- **SQL composition records** in the `compositions` table, managed by actions such as `save-composition`, `update-composition`, `get-composition`, and `list-compositions`.
- **Code-backed Remotion defaults** in `app/remotion/registry.ts` plus component files in `app/remotion/compositions/`. These are the shipped examples and default track definitions.

Use the action surface for app data. Edit component and registry files only when creating or changing code-backed Remotion defaults.

## SQL-Backed Compositions

Create or update a composition record with `save-composition`:

```bash
pnpm action save-composition --id "my-comp" --title "My Composition" --type custom --data '{"tracks":[]}'
```

Use this when the user wants a saved composition entry, metadata changes, or JSON composition data. The action handles upsert behavior and sharing-aware access checks.

## Registry Defaults

`app/remotion/registry.ts` contains the default `CompositionEntry[]` shipped with the template. Each entry:

```typescript
type CompositionEntry = {
  id: string; // URL slug: "logo-reveal" -> /c/logo-reveal
  title: string;
  description: string;
  component: React.FC<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, any>;
  tracks: AnimationTrack[];
};
```

`defaultProps` is shown in `PropsEditor` as editable fields. Do not include `tracks` in `defaultProps`; tracks are passed separately.

## Adding a Code-Backed Composition

For a new Remotion component:

1. Create `app/remotion/compositions/MyComp.tsx`.
2. Export it from `app/remotion/compositions/index.ts`.
3. Add a `CompositionEntry` to `app/remotion/registry.ts`.
4. Define `tracks` with meaningful IDs, labels, frame ranges, and `animatedProps`.
5. Run `pnpm typecheck` and `pnpm action validate-compositions`.

For boilerplate component generation, use:

```bash
pnpm action generate-animated-component --name MyComp --elements Button,Card
```

This generates component files. It does not replace the need to review tracks, registry metadata, and exported symbols.

## Component Template

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
    animatedProps: [{ property: "opacity", from: "0", to: "1", unit: "" }],
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

- Every animation must be registered as a track; avoid hardcoded frame checks.
- Always declare `FALLBACK_TRACKS` in the component file.
- Use `findTrack()`, `trackProgress()`, and `getPropValue()`.
- Registry defaults are not runtime storage. User edits and overrides are SQL/localStorage backed depending on the workflow.
- Use `save-composition` for SQL records; creation and updates share that action.
