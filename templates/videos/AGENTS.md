# Videos — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based API routes (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (file watcher, file sync, auth)
  lib/        # Shared server modules (watcher instance, helpers)
```

### Adding an API Route

Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/index.post.ts   → POST /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`:

```ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return { ok: true };
});
```

### Server Plugins

Startup logic (file watcher, file sync, auth) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

### Key Imports from `@agent-native/core`

| Import                                       | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)   |
| `createFileWatcher`                          | Watch data directory for changes                  |
| `createSSEHandler`                           | Create SSE endpoint for real-time updates         |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)          |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)      |
| `agentChat`                                  | Send messages to agent from scripts (server-side) |

### Build & Dev Commands

```bash
pnpm dev        # Vite dev server + Nitro plugin (single process)
pnpm build      # Single Vite build (client SPA + Nitro server)
pnpm start      # node .output/server/index.mjs (production)
pnpm typecheck  # TypeScript validation
```

---

# Agent-Native Starter

A production-ready full-stack React application template with integrated Nitro server, featuring React Router 6 SPA mode, TypeScript, Vitest, Zod and modern tooling.

While the starter comes with a Nitro server, only create endpoint when strictly neccesary, for example to encapsulate logic that must leave in the server, such as private keys handling, or certain DB operations, db...

## Tech Stack

- **PNPM**: Prefer pnpm
- **Frontend**: React 18 + React Router 6 (spa) + TypeScript + Vite + TailwindCSS 3
- **Backend**: Nitro (via @agent-native/core) — file-based API routing
- **Testing**: Vitest
- **UI**: Radix UI + TailwindCSS 3 + Lucide React icons

## Project Structure

```
app/                      # React SPA frontend
├── pages/                # Route components (Index.tsx = home)
├── components/ui/        # Pre-built UI component library
├── root.tsx               # HTML shell + global providers setup
└── global.css            # TailwindCSS 3 theming and global styles

server/                   # Nitro API server
├── routes/               # File-based API routes (auto-discovered by Nitro)
├── plugins/              # Server plugins (startup logic)
└── lib/                  # Shared server modules

shared/                   # Types used by both client & server
└── api.ts                # Shared API interfaces
```

## Routing System

The routing system uses React Router v7 framework mode with file-based routing:

- Routes are auto-discovered from `app/routes/` via `flatRoutes()`.
- `app/routes/_index.tsx` is the home page (`/`).
- Create a file to add a route (e.g. `app/routes/settings.tsx` → `/settings`).
- Dynamic params use `$` prefix (e.g. `app/routes/c.$compositionId.tsx` → `/c/:compositionId`).

### Styling System

- **Primary**: TailwindCSS 3 utility classes
- **Theme and design tokens**: Configure in `app/global.css`
- **UI components**: Pre-built library in `app/components/ui/`
- **Utility**: `cn()` combines `clsx` + `tailwind-merge` for conditional classes

### Path Aliases

- `@shared/*` — Shared folder
- `@/*` — Client folder

## Development Commands

```bash
pnpm dev        # Start dev server (client + server)
pnpm build      # Production build
pnpm start      # Start production server
pnpm typecheck  # TypeScript validation
pnpm test       # Run Vitest tests
```

---

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable key (or legacy `SUPABASE_ANON_KEY`)      |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

**How sync works:**

- `createFileSync()` factory reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**

- Read `data/.sync-status.json` for current sync state
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**

- When `application-state/sync-conflict.json` appears, resolve the conflict
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**

- Prefix temporary files with `_tmp-` to exclude from sync

---

## Animation Studio Architecture

This project is a **Remotion-based animation studio** — a web UI for composing, editing, and previewing programmatic video compositions. Understanding this system thoroughly is essential before creating or modifying any animation-related code.

### Key Files

| File                                      | Role                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `app/remotion/registry.ts`                | Single source of truth for all compositions and their default track data  |
| `app/remotion/trackAnimation.ts`          | Pure helpers: `trackProgress()`, `getPropValue()`, `findTrack()`          |
| `app/remotion/compositions/*.tsx`         | Individual Remotion composition components                                |
| `app/types.ts`                            | `AnimationTrack`, `AnimatedProp`, `EasingKey`, `COMMON_PROP_TEMPLATES`    |
| `app/components/Timeline.tsx`             | Timeline UI — controlled by `viewStart`/`viewEnd` from parent             |
| `app/components/VideoPlayer.tsx`          | Remotion `<Player>` wrapper with range-constrained playback               |
| `app/components/TrackPropertiesPanel.tsx` | Sidebar panel for editing selected track properties                       |
| `app/components/CompSettingsEditor.tsx`   | Sidebar panel for duration, fps, and size overrides (Square/Wide presets) |
| `app/components/PropsEditor.tsx`          | Sidebar panel for composition-level user props                            |
| `app/pages/CompositionView.tsx`           | Owns `viewStart`/`viewEnd` state; connects Timeline ↔ VideoPlayer         |
| `app/routes/_index.tsx`                   | Home route — renders Studio shell                                         |

---

### Core Data Types (`app/types.ts`)

#### `AnimationTrack`

```typescript
interface AnimationTrack {
  id: string; // Unique, stable — e.g. "lr-ring". Used by findTrack().
  label: string; // Display name in the timeline
  startFrame: number;
  endFrame: number;
  easing: EasingKey; // "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring"
  animatedProps?: AnimatedProp[];
}
```

#### `AnimatedProp`

```typescript
interface AnimatedProp {
  property: string; // Property name — e.g. "opacity", "translateY", "radius"
  from: string; // Numeric start value as string — e.g. "0"
  to: string; // Numeric end value as string — e.g. "1"
  unit: string; // CSS unit appended on output — e.g. "px", "deg", "" (none)

  // Optional transparency / documentation fields:
  description?: string; // Plain-English explanation shown in the Properties panel
  codeSnippet?: string; // Read-only source shown in the Properties panel code viewer
  programmatic?: boolean; // true → no editable from/to; only description + code shown
  isCustom?: boolean; // true → from/to are raw CSS value strings, not plain numbers

  // Adjustable parameters for programmatic animations:
  parameters?: Array<{
    name: string; // Key for accessing value (e.g., "avgCharWidth")
    label: string; // UI label (e.g., "Character Width")
    default: number; // Default value
    min?: number; // Minimum allowed value
    max?: number; // Maximum allowed value
    step?: number; // Increment step (e.g., 0.05)
  }>;
  parameterValues?: Record<string, number>; // User-adjusted parameter values
}
```

**Rule:** Every `animatedProps` entry that has a `codeSnippet` or `programmatic: true` will render as an **expression** (`fx`) in the timeline and Properties panel. Always provide a `description` alongside a `codeSnippet` so users understand what the code does.

**Note:** For programmatic animations, expose internal values as `parameters` to give users control without code editing. See "Exposing Adjustable Parameters" section below for details.

---

### The Registry (`app/remotion/registry.ts`)

`compositions` is the authoritative array of `CompositionEntry` objects. Each entry has:

```typescript
type CompositionEntry = {
  id: string; // URL slug — e.g. "logo-reveal" → /c/logo-reveal
  title: string;
  description: string;
  component: React.FC<any>; // The Remotion composition component
  durationInFrames: number; // Default duration (overrideable per-user in localStorage)
  fps: number; // Default fps (overrideable per-user in localStorage)
  width: number;
  height: number;
  defaultProps: Record<string, any>; // Passed as inputProps to <Player>
  tracks: AnimationTrack[]; // Default track data (overrideable per-user in localStorage)
};
```

**Important:** `defaultProps` is shown in `PropsEditor` as editable fields. Do **not** include `tracks` in `defaultProps` — tracks are passed separately and merged in `CompositionView`.

#### Adding a new composition

1. Create `app/remotion/compositions/MyComp.tsx` — the Remotion component
2. Export it from `app/remotion/compositions/index.ts`
3. Add a `CompositionEntry` to the `compositions` array in `app/remotion/registry.ts`
4. Define `tracks` with meaningful IDs, labels, frame ranges, and `animatedProps`

---

### Composition Components (`app/remotion/compositions/*.tsx`)

Each composition:

- Receives `tracks?: AnimationTrack[]` as a prop alongside its own visual props
- Declares `FALLBACK_TRACKS` — a local copy of the default tracks used when the prop is absent (prevents crashes during development or if the registry changes)
- Uses `findTrack(tracks, "track-id", FALLBACK_TRACKS[n])` to locate each track
- Uses `trackProgress(frame, fps, track)` to get a 0→1 progress value
- Uses `getPropValue(progress, track, "property", defaultFrom, defaultTo)` to read interpolated numeric values from `animatedProps`

#### Template pattern for a new composition

```tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationTrack } from "@/types";
import { trackProgress, getPropValue, findTrack } from "../trackAnimation";

export type MyCompProps = {
  title: string;
  // ... other visual props
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = [
  {
    id: "mc-intro",
    label: "Intro",
    startFrame: 0,
    endFrame: 30,
    easing: "spring",
    animatedProps: [
      { property: "opacity", from: "0", to: "1", unit: "" },
      { property: "translateY", from: "40", to: "0", unit: "px" },
    ],
  },
];

export const MyComp: React.FC<MyCompProps> = ({
  title,
  tracks = FALLBACK_TRACKS,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const introTrack = findTrack(tracks, "mc-intro", FALLBACK_TRACKS[0]);
  const p = trackProgress(frame, fps, introTrack);
  const opacity = getPropValue(p, introTrack, "opacity", 0, 1);
  const transY = getPropValue(p, introTrack, "translateY", 40, 0);

  return (
    <AbsoluteFill>
      <div style={{ opacity, transform: `translateY(${transY}px)` }}>
        {title}
      </div>
    </AbsoluteFill>
  );
};
```

---

### `trackAnimation.ts` — Helper Reference

```typescript
// Returns 0→1 progress for the track at the given frame.
// Handles spring (Remotion spring()) and polynomial easings.
trackProgress(frame, fps, track): number

// Looks up track.animatedProps by property name and interpolates from→to.
// Falls back to defaultFrom/defaultTo if the property isn't defined.
getPropValue(progress, track, property, defaultFrom, defaultTo): number

// Finds a track by id; returns fallback if not found.
findTrack(tracks, id, fallback): AnimationTrack
```

**Never** hard-code animation values in a composition when those values should be user-editable via the timeline. Use `getPropValue()` instead.

---

### ⚠️ CRITICAL RULE: Register ALL Animations as Tracks

**Every single animation or timing-dependent behavior MUST be registered as a track.** No hardcoded frame checks allowed.

#### ❌ NEVER do this:

```typescript
// BAD: Hardcoded frame check - user can't adjust timing in UI
const activeTab = frame < 60 ? "compositions" : "properties";
const panelOpen = frame >= 180;
const toolActive = frame >= 240 && frame < 300 ? "pan" : null;
```

#### ✅ ALWAYS do this:

```typescript
// GOOD: Read from tracks - user can adjust timing via timeline
const tabSwitchTrack = findTrack(
  tracks,
  "switch-to-properties",
  FALLBACK_TRACKS[2],
);
const cameraPanelTrack = findTrack(
  tracks,
  "camera-panel-open",
  FALLBACK_TRACKS[3],
);
const panToolTrack = findTrack(tracks, "pan-tool-active", FALLBACK_TRACKS[4]);

const activeTab =
  frame >= tabSwitchTrack.startFrame ? "properties" : "compositions";
const cameraPanelP = trackProgress(frame, fps, cameraPanelTrack);
const panelOpen = cameraPanelP > 0;
const panToolP = trackProgress(frame, fps, panToolTrack);
const toolActive = panToolP > 0 && panToolP < 1 ? "pan" : null;
```

#### Track Types by Animation Complexity

**1. Resizable Tracks** — For animations with clear start/end durations:

- Camera panel opening (spring animation over time)
- Tool activation states (active during track range)
- Timeline playback progress (continuous interpolation)
- Any animation where both start frame AND duration matter

```typescript
{
  id: "camera-panel-open",
  label: "Camera Panel Open",
  startFrame: 180,
  endFrame: 240,  // ← User can drag to adjust duration
  easing: "spring",
  animatedProps: [
    { property: "panelOpen", from: "0", to: "1", unit: "" }
  ]
}
```

**2. Keyframe-Style Tracks** — For instant state changes or complex multi-element behaviors:

- Tab switches (instant state change at specific frame)
- Modal opens/closes (single trigger point)
- Complex sequences where multiple elements animate together

**Visual Appearance:**

- Shows as a **diamond marker** (◆) in the timeline instead of a duration bar
- Has a **diamond indicator** in the label column instead of a circle dot
- Can be **dragged** to adjust timing (maintains startFrame === endFrame)
- Cannot be resized (no handles)

```typescript
{
  id: "switch-to-properties",
  label: "Switch to Properties",
  startFrame: 60,
  endFrame: 60,  // ← Same as startFrame = renders as keyframe diamond
  easing: "linear",
  animatedProps: [
    {
      property: "tab state",
      from: "",
      to: "",
      unit: "",
      programmatic: true,
      description: "Instantly switches sidebar to Properties tab. Drag this keyframe to adjust when the switch happens."
    }
  ]
}
```

**Usage:** `const activeTab = frame >= tabSwitchTrack.startFrame ? "properties" : "compositions";`

**Timeline Implementation Note:**

In `Timeline.tsx`, keyframe-style tracks (where `startFrame === endFrame`) are automatically rendered differently:

- Detection: `const isKeyframeTrack = track.startFrame === track.endFrame;`
- Renders as diamond marker instead of duration bar
- Supports box selection and click-to-deselect (same as camera/cursor tracks)
- Diamond size: `w-2 h-2` (8px, matching camera/cursor keyframes)
- Label column shows diamond indicator instead of circle dot

This is **automatic** - no special code needed in compositions. Just set `startFrame === endFrame` in the registry.

#### Benefits of Track-Based Animation

✅ **User Control** — Every timing can be adjusted in the timeline UI
✅ **Visibility** — Users see what animations exist and when they happen
✅ **Consistency** — All animations follow the same pattern
✅ **No Mysteries** — No hidden hardcoded behaviors

**See:** `UIShowcase.tsx` for a complete example of track-based state management

---

### ⚠️ CRITICAL: CSS Filter Units

When implementing CSS filter properties in `AnimatedElement.tsx`, use the correct units:

**❌ WRONG - These filters do NOT use percentage units:**

```typescript
filters.push(`brightness(${value}%)`); // WRONG - makes value 1 = 1% brightness (almost black!)
filters.push(`contrast(${value}%)`); // WRONG
filters.push(`saturate(${value}%)`); // WRONG
```

**✅ CORRECT - Unitless multipliers:**

```typescript
filters.push(`brightness(${value})`); // CORRECT - value 1 = normal, 1.5 = 50% brighter
filters.push(`contrast(${value})`); // CORRECT - value 1 = normal, 2 = 2x contrast
filters.push(`saturate(${value})`); // CORRECT - value 1 = normal, 0.5 = 50% saturation
```

**Only `blur()` and `hue-rotate()` use units:**

```typescript
filters.push(`blur(${value}px)`); // ✅ Correct - blur uses pixels
filters.push(`hue-rotate(${value}deg)`); // ✅ Correct - hue-rotate uses degrees
```

---

### ⚠️ CRITICAL: Cursor Detection Precision

In `useHoverAnimationSmooth.ts`, cursor hover and click detection must use the **cursor tip only**, not the full cursor visual size.

**Problem:** The cursor graphic is 32×32px, but the actual pointer is at the top-left corner. Using the full cursor size causes:

- Accidental hovers when cursor is near but not pointing at element
- Accidental clicks from the cursor's bottom-right area
- Elements reacting when cursor is visually over them but the pointer tip is elsewhere

**Solution:** Use a small 4×4px detection area at the cursor tip position:

```typescript
// ❌ WRONG - Uses full 32px cursor size
const wasHovering =
  x + cursorSize > hoverZone.x - padding && // cursorSize = 32
  x < hoverZone.x + hoverZone.width + padding &&
  y + cursorSize > hoverZone.y - padding &&
  y < hoverZone.y + hoverZone.height + padding;

// ✅ CORRECT - Uses 4px tip area
const tipSize = 4; // Small 4px area around cursor tip
const wasHovering =
  x + tipSize > hoverZone.x - padding &&
  x < hoverZone.x + hoverZone.width + padding &&
  y + tipSize > hoverZone.y - padding &&
  y < hoverZone.y + hoverZone.height + padding;
```

Apply this to **both hover and click detection** in `useHoverAnimationSmooth.ts`.

---

### Interactive Component Registration Requirements

**All interactive UI elements in showcase compositions must be registered** using `useInteractiveComponent()`:

**Examples of elements that MUST be registered:**

- ✅ Buttons (toolbar buttons, play button, keyframe markers)
- ✅ Tabs (Compositions, Properties)
- ✅ Accordions (Camera, Cursor, Animation Track headers)
- ✅ Input fields (when shown as interactive demos)
- ✅ Cards, panels, modals

**Registration pattern:**

```typescript
const element = useInteractiveComponent({
  id: "unique-id",
  elementType: "Button",  // Button, Tab, Accordion, Input, Card, etc.
  label: "Display Name",
  compositionId: "composition-id",
  zone: { x, y, width, height },  // Precise hit area
  cursorHistory,
  interactiveElementType: "button",  // Controls cursor type
  hoverAnimation: AnimationPresets.scaleHover(0.1),
});

registerForCursor(element);  // Don't forget to aggregate for cursor

// Render with AnimatedElement
<AnimatedElement interactive={element} as="button">
  ...
</AnimatedElement>
```

**Why this matters:**

- Shows in Properties panel when cursor hovers
- Cursor automatically changes type (pointer, text, etc.)
- Hover/click animations work correctly
- User can customize cursor type per element

---

### UI Spacing Guidelines

When building UI mockups in showcase compositions:

**Toolbar/Button Groups:**

- Gap between elements: `gap-3` (12px) minimum
- Button padding: `px-3 py-1.5` minimum for comfortable touch targets
- Icon-to-text gap: `gap-2` (8px)
- Divider height: Match button height (`h-5` for 20px buttons)

**Panels/Accordions:**

- Content padding: `px-4 py-3` for panels
- Vertical spacing between sections: `space-y-3` (12px)
- Border radius: `rounded-lg` (8px) for panels

**Alignment:**

- Toolbars should align to content edge (not centered over content)
- Ensure spacing between overlapping elements (toolbar vs video: 12px minimum)

**See:** `UICameraToolbar.tsx` and `UISidebar.tsx` for examples

---

### Programmatic (Expression) Animations

**⚠️ RULE: ALL animations MUST be registered to a track (continuation from above).**

Every animation effect in a composition — whether simple from→to, keyframed, or programmatic — must be documented in the track's `animatedProps`. This includes:

- Visual effects (typing reveals, particle systems, stagger effects)
- Transform animations (drift, rotation, scaling)
- Opacity fades, color shifts, layout changes
- Any code-driven animation logic

**Why?** Transparency and discoverability. Users should be able to see what's animating by looking at the track in the Properties panel. Hidden animations break trust and make the system feel like a black box.

Some animations can't be expressed as a simple from→to pair — e.g. staggered particle bursts, typing reveals, or drift calculations. For these:

1. Add an `AnimatedProp` with `programmatic: true` **or** a `codeSnippet`
2. Provide a clear `description` in plain English explaining what the animation does and how its parameters work
3. Keep the actual logic in the composition source file
4. When the particle count, stagger timing, or other baked-in parameters change **in the source**, also update the `codeSnippet` and `description` in `registry.ts` to stay in sync

**In the timeline**, tracks with any expression prop display a purple `fx` badge instead of the easing color dot. The track bar also uses purple border/highlight. This is automatic — no extra code needed.

**In the Properties panel**, expression props render as a collapsible card with the description prominently shown, then a read-only code block below. Users cannot edit expression values directly; they must edit the source file.

Examples of correctly documented expression props in the registry:

**Example 1: Particle Burst**

```typescript
{
  property: "burst layout",
  from: "", to: "", unit: "",
  programmatic: true,
  description:
    "24 particles are placed evenly around 360° using trigonometry. Each launches 2 frames after the previous, creating a ripple. The count and stagger are baked in code — edit LogoReveal.tsx to change them.",
  codeSnippet:
`Array.from({ length: 24 }).map((_, i) => {
  const angle = (i / 24) * Math.PI * 2;
  const delay = startFrame + i * 2;
  x = cx + Math.cos(angle) * radius;
  y = cy + Math.sin(angle) * radius;
});`,
}
```

**Example 2: Typing Reveal with Drift**

```typescript
{
  property: "typing reveal",
  from: "", to: "", unit: "",
  programmatic: true,
  description:
    "Letters appear one by one using character slicing based on track progress. As each letter appears, the entire phrase drifts left (via translateX) to counteract flex centering, creating a smooth 'settling into place' effect. The drift is calculated as: (remainingChars × avgCharWidth × fontSize) / 2.",
  codeSnippet:
`const charsToShow = Math.floor(titleP * title.length);
const visibleTitle = title.slice(0, charsToShow);
const remainingChars = title.length - charsToShow;
const driftX = (remainingChars * pixelsPerChar) / 2;
transform: \`translateX(\${driftX}px)\``,
}
```

**⚠️ BEST PRACTICE: Always support common animated properties**

Even when an element has custom/programmatic animation logic, **always read and apply common animated properties** from the track. This lets users layer standard animations on top of custom effects.

**Common properties to support:**

- `scale` — uniform scaling
- `opacity` — fade in/out
- `translateX` / `translateY` — positional offsets
- `rotation` — 2D rotation in degrees

**Implementation pattern:**

```typescript
// Always read common properties (even for scripted elements)
const scale = getPropValue(progress, track, "scale", 1, 1);
const opacity = getPropValue(progress, track, "opacity", 1, 1);
const translateX = getPropValue(progress, track, "translateX", 0, 0);
const translateY = getPropValue(progress, track, "translateY", 0, 0);
const rotation = getPropValue(progress, track, "rotation", 0, 0);

// Combine scripted values with user values
// Example: scripted drift + user's translateX
const finalX = scriptedDriftX + translateX;

// Apply all transforms together
style={{
  transform: `translateX(${finalX}px) translateY(${translateY}px) scale(${scale}) rotate(${rotation}deg)`,
  opacity: opacity,
}}
```

**Why this matters:**

- Users can add scale, fade, or movement to ANY element without editing source code
- Programmatic animations become more flexible and composable
- UI remains consistent — all tracks support the same property set

**See:** `KineticText.tsx` for a complete example of this pattern

---

### Exposing Adjustable Parameters in Programmatic Animations

For programmatic animations (`programmatic: true`), you can expose internal hardcoded values as user-adjustable parameters. This gives users control over behavior without needing to edit source code or re-prompt.

#### Type Definition

```typescript
interface AnimatedProp {
  property: string;
  programmatic?: boolean;
  description?: string;
  codeSnippet?: string;
  parameters?: Array<{
    name: string; // Key used to access value (e.g., "avgCharWidth")
    label: string; // Display label in UI (e.g., "Character Width")
    default: number; // Default value
    min?: number; // Minimum value (for validation)
    max?: number; // Maximum value (for validation)
    step?: number; // Step increment (e.g., 0.05)
  }>;
  parameterValues?: Record<string, number>; // User-adjusted values
  // ... other fields
}
```

#### Registry Definition

**Example: Typing animation with adjustable character width and drift distance**

```typescript
{
  id: "kt-title",
  label: "Title Appear",
  startFrame: 0,
  endFrame: 110,
  easing: "sine.out",
  animatedProps: [
    {
      property: "typing reveal",
      from: "",
      to: "",
      unit: "",
      programmatic: true,
      description: "Letters appear one by one linearly while the text position drifts from right to left with quartic (power4) easing. Text starts offset to the right and smoothly drifts left to center as characters appear, creating an inertia effect.",
      parameters: [
        {
          name: "avgCharWidth",
          label: "Character Width",
          default: 0.6,
          min: 0.1,
          max: 2,
          step: 0.05
        },
        {
          name: "offsetScale",
          label: "Drift Distance",
          default: 0.125,
          min: 0,
          max: 0.5,
          step: 0.025
        },
      ],
      codeSnippet: `const charsToShow = Math.floor(titleP * title.length);
const visibleTitle = title.slice(0, charsToShow);

// Drift with quartic easing (power4.out)
const avgCharWidth = params.avgCharWidth ?? 0.6;
const offsetScale = params.offsetScale ?? 0.125;
const pixelsPerChar = fontSize * avgCharWidth;
const totalWidth = title.length * pixelsPerChar;
const startOffset = totalWidth * offsetScale;
const easedProgress = 1 - Math.pow(1 - titleP, 4);
const driftX = startOffset * (1 - easedProgress);

transform: \\\`translateX(\${driftX}px)\\\``
    }
  ]
}
```

#### Composition Implementation

**Reading and using parameter values:**

```typescript
// Find the programmatic property by name
const typingProp = titleTrack?.animatedProps?.find(
  (p) => p.property === "typing reveal",
);

// Read parameter values with fallback to defaults
const avgCharWidth = typingProp?.parameterValues?.avgCharWidth ?? 0.6;
const offsetScale = typingProp?.parameterValues?.offsetScale ?? 0.125;

// Use them in calculations
const fontSize = Math.min(width * 0.08, 80);
const pixelsPerChar = fontSize * avgCharWidth;
const totalWidth = title.length * pixelsPerChar;
const startOffset = totalWidth * offsetScale;
const easedProgress = 1 - Math.pow(1 - titleP, 4);
const driftX = startOffset * (1 - easedProgress);
```

#### UI Behavior

**In the Properties Panel (TrackPropertiesPanel):**

- **Parameters section is always visible** — immediately accessible without expanding
- **Description and code are collapsed by default** — click "CODE" button to expand
- Expression code is **greyed out and marked read-only** to indicate it can't be edited
- Number inputs appear for each parameter with proper min/max/step constraints
- Values update in real-time as users type
- Changes are **auto-saved to localStorage**
- Click **Save button** to persist to the registry file

**Visual hierarchy:**

```
┌─────────────────────────────────────┐
│ fx  typing reveal         [CODE] [X]│
├─────────────────────────────────────┤
│ PARAMETERS                          │
│ Character Width  [0.6    ]          │
│ Drift Distance   [0.125  ]          │
└─────────────────────────────────────┘
```

Expanded (after clicking CODE):

```
┌─────────────────────────────────────┐
│ fx  typing reveal         [HIDE] [X]│
├─────────────────────────────────────┤
│ PARAMETERS                          │
│ Character Width  [0.6    ]          │
│ Drift Distance   [0.125  ]          │
├─────────────────────────────────────┤
│ ✨ HOW IT WORKS                     │
│ Letters appear one by one...        │
├─────────────────────────────────────┤
│ EXPRESSION (read-only)              │
│ ┌─────────────────────────────────┐ │
│ │ const charsToShow = Math.floor…│ │
│ │ ...                            │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### Best Practices

**When to expose parameters:**

- ✅ Values that significantly affect visual behavior (speeds, distances, scales, counts)
- ✅ "Magic numbers" that users might want to tweak (timing offsets, easing powers, physics constants)
- ✅ Values that change the "feel" of the animation (drift distances, bounce strength, particle spread)
- ❌ Values tied to the animation's core identity (would break the effect if changed arbitrarily)
- ❌ Computed values that don't make sense to adjust independently

**Parameter design:**

- Keep it focused: **2-5 parameters is ideal** — too many becomes overwhelming
- Use **clear, non-technical labels**: "Character Width" not "avgCharWidth"
- Set **sensible min/max bounds** to prevent breaking the animation
- Use appropriate **step values**: 0.05 for fine-tuning, 1 for integers, etc.
- **Update codeSnippet** to reference parameter names for transparency

**codeSnippet tips:**

- Reference parameters as `params.paramName` or show them being read from the prop
- Include comments explaining what each parameter controls
- Show the actual calculation logic using the parameters
- Keep it concise — focus on parameter usage, not entire component

**Full example pattern:**

```typescript
// 1. In registry.ts - define parameters
parameters: [
  { name: "speed", label: "Animation Speed", default: 1, min: 0.1, max: 3, step: 0.1 },
  { name: "distance", label: "Travel Distance", default: 100, min: 0, max: 500, step: 10 },
],
codeSnippet: `const speed = params.speed ?? 1;
const distance = params.distance ?? 100;
const position = interpolate(progress, [0, 1], [0, distance * speed]);`

// 2. In composition - read and use
const myProp = track?.animatedProps?.find(p => p.property === "my-animation");
const speed = myProp?.parameterValues?.speed ?? 1;
const distance = myProp?.parameterValues?.distance ?? 100;
const position = interpolate(progress, [0, 1], [0, distance * speed]);
```

**See:** `app/remotion/registry.ts` (kt-title track) and `app/remotion/compositions/KineticText.tsx` for a complete implementation

---

### Timeline System

The timeline (`app/components/Timeline.tsx`) is **fully controlled** — it owns no state itself.

#### Props it requires

```typescript
{
  currentFrame: number;
  durationInFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
  tracks: AnimationTrack[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  // View window — controlled by CompositionView
  viewStart: number;
  viewEnd: number;
  onViewChange: (start: number, end: number) => void;
}
```

#### View window (`viewStart` / `viewEnd`)

- State lives in `CompositionView` and is shared with both `Timeline` and `VideoPlayer`
- Drives the **range navigator bar** at the bottom of the timeline (AE/C4D-style triangular handles)
- Dragging the handles or panning the highlighted region zooms/pans the visible time window
- Minimum window size: 5% of total duration (prevents collapsing to zero)
- Double-clicking the range bar resets to full view
- Ruler ticks, track bar positions, and the playhead all render relative to the view window
- **Playback in VideoPlayer is constrained to `[viewStart, viewEnd]`** — the player stops (or loops if repeat is on) when the frame reaches `viewEnd`

#### UI Conventions & Polish

**Time formatting:**

- Use `fmtSec()` helper for consistent 1-decimal formatting: `0.0s`, `1.2s`, `3.0s`
- Track bar labels: `0.3s–1.8s` (seconds, not frames)
- Timeline bottom bar: `0.00s / 3.0s` (current / total)
- When zoomed, show range pill: `0.50s–2.0s` in muted text

**Expression (programmatic) track styling:**

- Purple `fx` badge replaces easing color dot in timeline label column
- Track bars use purple border (`border-purple-400`) and purple highlight on hover
- Properties panel shows expression props in purple cards with collapsible code viewer
- This styling is **automatic** when `animatedProps` contains any prop with `codeSnippet` or `programmatic: true`

**Range navigator visual states:**

- Default: Gray handles and border
- Zoomed (viewStart > 0 or viewEnd < durationInFrames): Purple handles and "zoom" indicator text
- Only the playhead within the view window is rendered; outside the window it's hidden

**Frame labels:**

- In Properties panel, Start/End inputs show unit suffix: `Start (f)` and `End (f)` for clarity
- Timing summary shows both frames and seconds: `0.8s → 2.1s · 1.3s (39f)`

---

### VideoPlayer Playback (`app/components/VideoPlayer.tsx`)

Wraps Remotion `<Player>` with:

- **`viewStart` / `viewEnd` props** — playback range. Defaults to full duration.
- **Range enforcement** — `frameupdate` event handler pauses and seeks to `viewStart` when `frame >= viewEnd`
- **Repeat mode** — toggle button (↻) next to play. When on, loops within the range instead of stopping.
- **⏮ restart** — seeks to `viewStart`, not frame 0
- **Progress bar** — shows position within `[viewStart, viewEnd]`, not the full timeline
- **Time display** — shows current time; when a non-full range is active, shows the range bounds in brackets

#### Implementation Details

**Refs to avoid stale closures:**

- `rangeRef` — always holds latest `{ start: viewStart, end: viewEnd }`
- `repeatRef` — always holds latest `repeat` boolean state
- These prevent re-registering the `frameupdate` event listener on every prop change

**Repeat button styling:**

- Uses `cn()` for conditional classes
- Active state: `text-primary` (purple text when repeat is on)
- Hover: `hover:bg-secondary` (consistent with other controls)

**Range pill badge:**

- Only shown when `viewStart > 0 || viewEnd < durationInFrames`
- Format: `0.50s–2.0s` in muted text
- Positioned next to the time display in the bottom control bar

---

### Composition Settings (`durationInFrames` / `fps` / `width` / `height` / `renderQuality`)

Users can override duration, fps, dimensions, and render quality per composition via the **Properties panel → Composition section** (`CompSettingsEditor`).

- Overrides are stored in `localStorage` under `videos-comp-settings:<compositionId>`
- The effective composition (registry defaults merged with overrides) is computed in `Index.tsx` as `effectiveComposition`
- `effectiveComposition` flows to `CompositionView`, `Timeline`, and `VideoPlayer` — everything adapts reactively
- When fps changes, wall-clock duration is preserved and `durationInFrames` is recalculated automatically
- **Size presets**: Square (1080×1080) and Wide (1920×1080) buttons set both width and height
- **Render Quality** (supersampling): Multiplies internal render resolution to prevent pixelation during camera zoom
  - **1× (Normal)**: Renders at output size (e.g., 1920×1080)
  - **2× (High)**: Renders at 2× resolution (e.g., 3840×2160) — supports clean 2× camera zoom
  - **3× (Ultra)**: Renders at 3× resolution (e.g., 5760×3240) — supports clean 3× camera zoom
  - Higher quality = sharper text/vectors when zooming, but slower rendering
- The registry is never mutated — it always holds the shipped defaults

---

### State & Persistence (`app/pages/Index.tsx` / `app/routes/_index.tsx`)

All studio state lives in `Index.tsx` and is persisted to `localStorage`:

| Key                         | Stores                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| `videos-tracks:<id>`        | User-edited `AnimationTrack[]` for that composition (includes `parameterValues`) |
| `videos-props:<id>`         | User-edited `defaultProps` overrides                                             |
| `videos-comp-settings:<id>` | `{ durationInFrames, fps, width, height }` overrides                             |

When a composition changes, tracks are loaded with `loadTracks()` which **deep-merges** stored user edits onto the current registry defaults. This means:

- New tracks added to the registry appear automatically
- Registry metadata on `animatedProps` (`codeSnippet`, `description`, `programmatic`, `parameters`) always reflects the latest code
- User `from`/`to` values and `parameterValues` are preserved across registry updates
- **Automatic deduplication** filters duplicate track IDs from localStorage on load and cleans corrupted data
- **Cross-tab sync**: Changes in one tab automatically sync to other open tabs via `storage` event listeners

#### Save Button (`/api/save-composition-defaults`)

The **Save** button in the top-right of `CompositionView` persists current studio state back to the registry file (`app/remotion/registry.ts`):

**What it saves:**

- Current track structure (including parameter values)
- Current composition settings (duration, fps, dimensions)
- Current defaultProps

**How it works:**

1. Gathers current tracks, props, and settings from state
2. Shows confirmation dialog with summary
3. POSTs to `/api/save-composition-defaults` endpoint
4. Server reads registry file, finds composition by ID using brace-counting
5. Replaces entire composition object with formatted TypeScript code
6. Writes back to file

**Important:**

- Parameter values (`parameterValues`) are saved with the track
- Duplicates are automatically filtered before saving
- Server properly escapes backticks and dollar signs in `codeSnippet`
- Changes take effect immediately for new users/sessions

**See:** `server/routes/save-composition.ts` for server-side implementation

---

### Checklist: Creating a New Composition

- [ ] Create `app/remotion/compositions/MyComp.tsx` — Remotion component accepting `tracks?: AnimationTrack[]`
- [ ] Declare `FALLBACK_TRACKS` inside the component file (mirrors registry defaults)
- [ ] Use `findTrack` / `trackProgress` / `getPropValue` — never hard-code animated values
- [ ] Export from `app/remotion/compositions/index.ts`
- [ ] Add `CompositionEntry` to `app/remotion/registry.ts` with `tracks` array
- [ ] Set `width` and `height` (default: 1920×1080 or 1080×1080)
- [ ] For each track, populate `animatedProps` with correct `property`, `from`, `to`, `unit`
- [ ] For any programmatic animation: add `description` + `codeSnippet` + `programmatic: true`
- [ ] **If programmatic**: consider exposing key values as `parameters` array for user adjustment
- [ ] **If parameters added**: read them in composition using `prop?.parameterValues?.paramName ?? defaultValue`
- [ ] Ensure `defaultProps` does **not** include `tracks`
- [ ] Run `pnpm typecheck` — zero errors required

### Checklist: Editing an Existing Animation

- [ ] To change baked-in parameters (particle count, stagger, etc.): edit the composition `.tsx` file AND update the matching `codeSnippet` + `description` in `registry.ts`
- [ ] **To expose hardcoded values as adjustable parameters**: add `parameters` array to the animated prop in registry, then read `parameterValues` in composition
- [ ] To add a new animatable property: add to `animatedProps` in `registry.ts` AND read it in the composition using `getPropValue()`
- [ ] To add a new track: add to both the registry `tracks` array and the composition's `FALLBACK_TRACKS`
- [ ] Never mutate `registry.ts` defaults at runtime — overrides go through `Index.tsx` state
- [ ] After significant changes, test the **Save button** to ensure it writes valid TypeScript

---

## Camera System

The camera system provides global transform controls (zoom, pan, 3D tilt) that affect the entire composition. It uses a dedicated `camera` track with multi-keyframe support.

### Architecture

**CameraHost Component** (`app/remotion/CameraHost.tsx`)

- Wraps composition content with CSS 3D transforms
- Reads camera track using `getPropValueKeyframed()` for smooth interpolation
- Transform chain: `perspective(N) → translate3d(x,y,0) → rotateX(deg) → rotateY(deg) → scale(s)`
- Properties: `translateX`, `translateY`, `scale`, `rotateX`, `rotateY`, `perspective`

**Camera Track Structure**

```typescript
{
  id: "camera",
  label: "Camera",
  startFrame: 0,
  endFrame: <composition.durationInFrames>,
  easing: "linear",
  animatedProps: [
    { property: "translateX", from: "0", to: "0", unit: "px" },
    { property: "translateY", from: "0", to: "0", unit: "px" },
    { property: "scale", from: "1", to: "1", unit: "" },
    { property: "rotateX", from: "0", to: "0", unit: "deg" },
    { property: "rotateY", from: "0", to: "0", unit: "deg" },
    { property: "perspective", from: "800", to: "800", unit: "px" },
  ]
}
```

**Camera Toolbar** (`app/components/CameraToolbar.tsx`)

- **Primary UI**: Interactive toolbar above video player with click-and-drag tools
- **Pan Tool** (Move icon): Click and drag to move camera — cursor position directly controls camera X/Y
- **Zoom Tool** (ZoomIn icon): Click and drag up/down to zoom in/out — vertical movement controls scale
- **Tilt Tool** (RotateCw icon): Click and drag to rotate 3D — horizontal controls rotateY, vertical controls rotateX
- **Auto-keyframing**: All drag adjustments automatically create/update keyframes at current frame
- **Visual feedback**: Active tool highlights in blue, "Adjusting..." indicator while dragging
- **Professional workflow**: Similar to After Effects camera tools

**Advanced Camera Controls** (`app/components/CameraControls.tsx`)

- Located in Properties panel under collapsible "Advanced Camera Controls" section
- Numeric sliders for precise value input when needed
- Keyframe management: Remove keyframe, Prev/Next navigation, Reset
- Secondary to toolbar — most users will use toolbar for intuitive interaction

**Timeline Integration**

- Camera track appears first (top) in timeline
- Blue camera icon (🎥) instead of easing color dot
- Blue accent color for track bar, labels, and borders
- Keyframe markers (◆) rendered on track bar at keyframe positions
- Clicking a keyframe marker seeks to that frame

### Keyframe System

Extends `AnimatedProp` with optional multi-keyframe support:

```typescript
interface AnimatedProp {
  property: string;
  from: string; // Used when no keyframes
  to: string; // Used when no keyframes
  unit: string;
  keyframes?: Array<{
    frame: number; // Absolute frame number
    value: string; // Numeric value as string
  }>;
}
```

**Interpolation Behavior** (`getPropValueKeyframed()` in `trackAnimation.ts`):

- Before first keyframe → hold first value
- Between keyframes → linear interpolation
- After last keyframe → hold last value
- No keyframes → fall back to `from`/`to` with `trackProgress()`

**User Workflow:**

1. **Scrub playhead** to desired frame (e.g., frame 0)
2. **Click a camera tool** above the video (Pan, Zoom, or Tilt)
3. **Drag the mouse** — camera adjusts in real-time:
   - **Pan**: Drag anywhere to move camera position
   - **Zoom**: Drag up to zoom in, down to zoom out
   - **Tilt**: Drag to rotate camera in 3D space
4. **Release mouse** — keyframe automatically created at current frame
5. **Scrub to another frame** (e.g., frame 60) and repeat
6. **Play** → Smooth interpolation between all keyframes!
7. **Click diamond markers** on timeline to navigate between keyframes
8. **Optional**: Expand "Advanced Camera Controls" in Properties panel for precise numeric input

**Backward Compatibility:**

- Existing tracks with `from`/`to` continue to work
- Keyframes only activate when the `keyframes` array exists and has entries
- Track data persists to localStorage like other tracks

**Render Quality & Camera Zoom:**

- To prevent pixelation when zooming, increase **Render Quality** in Composition settings
- **2× quality** renders composition at double resolution → clean zoom up to 2×
- **3× quality** renders at triple resolution → clean zoom up to 3×
- Supersampling maintains crisp vector text and shapes at any camera zoom level
- Trade-off: Higher quality = slower rendering (especially during preview)

### Integration Checklist

**To add camera to a composition:**

- [ ] Wrap composition content with `<CameraHost tracks={tracks}>`
- [ ] Add camera track to registry `tracks` array (at index 0 for top position)
- [ ] Camera controls automatically appear in Properties panel

**Camera track is already integrated in:**

- ✅ KineticText
- ✅ LogoReveal
- ✅ Slideshow

---

## Interactive Elements & Cursor System

The cursor system enables hover detection, cursor type changes, and click animations for interactive UI elements (buttons, inputs, links, cards, etc.).

### 🎯 Recommended Patterns (Choose Best Fit)

**1. Ultimate Pattern: `createInteractiveComposition()` + `InteractiveCard`** ⭐ **BEST**

- **80% code reduction** vs manual pattern (145 lines vs 729 lines)
- Zero boilerplate - automatic cursor history, track setup, CameraHost wrapping
- Pre-built card components with animation variants
- See: `ModernPlayground.tsx`

**2. Helper Hook Pattern: `useInteractiveComponent()` + `InteractiveCard`**

- **76% code reduction** vs manual pattern (177 lines vs 729 lines)
- Automatic cursor type management with reactivity
- Pre-built card components
- See: `SimplifiedPlayground.tsx`

**3. Manual Registration Pattern** — ⚠️ **REMOVED**

- Legacy manual pattern (729 lines) has been removed from codebase
- Was verbose, error-prone, and required deep knowledge of system internals
- Use modern patterns (#1 or #2) instead for all new code

### Modern Pattern Example (Recommended)

**Using `createInteractiveComposition()` - The simplest approach:**

```tsx
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import {
  useInteractiveComponent,
  AnimationPresets,
} from "@/remotion/hooks/useInteractiveComponent";
import { InteractiveCardVariants } from "@/remotion/ui-components/InteractiveCard";

export const MyComp = createInteractiveComposition<MyCompProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    // One line per interactive element!
    const card = useInteractiveComponent({
      id: "card",
      elementType: "Card",
      label: "My Card",
      compositionId: "my-comp",
      zone: { x: 100, y: 100, width: 200, height: 150 },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: AnimationPresets.scaleHover(0.15),
    });

    registerForCursor(card); // Automatic cursor aggregation

    // One line to render!
    return InteractiveCardVariants.scale(
      card,
      "📐",
      "Card Title",
      "Description",
      "99, 102, 241",
    );
  },
});
```

**Result:** ~100 lines for 6 interactive cards vs 729 lines manual pattern!

### Component APIs

**`createInteractiveComposition(config)`** - Composition wrapper

- Automatically sets up: cursor history, track finding, cursor aggregation, CameraHost
- Config: `{ fallbackTracks, render, cursorHistorySize? }`
- Render receives: `{ cursorHistory, tracks, registerForCursor }`
- Returns: React component ready to export

**`useInteractiveComponent(options)`** - One-line element registration

- Handles: hover detection, cursor types, animation storage, sidebar registration
- Fully reactive to cursor type changes in UI
- Returns: `{ hover, click, combinedProgress, zone, cursorType }`

**`InteractiveCard`** - Reusable animated card component

- Props: `state, icon, title, description, accentColor`
- Optional: `customTransform, customBoxShadow, customFilter, customBackground`
- Eliminates 20-30 lines of styling per card

**`InteractiveCardVariants`** - Pre-built animation patterns

- `.scale(state, icon, title, desc, color)` - Scale on hover
- `.rotate(state, icon, title, desc, color)` - 3D rotate on click
- `.lift(state, icon, title, desc, color)` - Lift with shadow
- `.glow(state, icon, title, desc, color)` - Glow effect
- `.blur(state, icon, title, desc, color)` - Blur on click
- `.color(state, icon, title, desc, fromColor, toColor)` - Color shift

### Architecture

### Architecture

**Storage** (`CurrentElementContext`)

- `getCursorType(compositionId, elementType)` — Reads from localStorage
- `setCursorType(compositionId, elementType, cursorType)` — Saves override
- `deleteCursorType(compositionId, elementType)` — Resets to inferred
- Storage key: `"videos-element-cursor-types"` (JSON map)

**Priority System** (highest to lowest):

1. **Stored cursor type** — User override from Properties panel
2. **Explicit cursorType** — Passed to hook/component
3. **Inferred from element type** — `getCursorTypeForElement(type)`
4. **Default** — `"pointer"`

**Cursor Rendering** (`CameraHost` + `Cursor`)

- `CameraHost` renders `<Cursor>` component from cursor track
- `autoCursorType` prop overrides cursor appearance based on hover zones
- `useCursorTypeFromHover()` aggregates hover states (last hovered wins)

### Legacy Manual Pattern (Removed)

**⚠️ The legacy manual pattern has been completely removed from the codebase.**

The old manual registration pattern required:

- 6-8 imports per composition
- Manual `getCursorType()` calls for reactive cursor types
- Manual `useHoverAnimationSmooth()` + `useRegisterInteractiveElement()` for each element
- Manual cursor type aggregation with `useCursorTypeFromHover()`
- Manual `<CameraHost>` wrapper

This resulted in 729 lines for a 6-card interactive composition.

**For all new code:** Use `createInteractiveComposition()` (145 lines) or `useInteractiveComponent()` (177 lines) patterns instead.

### User Workflow

1. **Hover element** in preview → Properties panel shows element
2. **Cursor Type section** displays current cursor with dropdown
3. **Change cursor** → immediately updates in preview (reactive)
4. **Click trash icon** → resets to inferred type
5. **Changes persist** across sessions (localStorage)

### Type Definitions

```typescript
type CursorType = "default" | "pointer" | "text";

interface HoverZone {
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: number;
  cursorType?: CursorType; // ← Pass here for reactive cursor
}

interface HoverAnimationResult {
  isHovering: boolean;
  hoverProgress: number;
  desiredCursorType?: CursorType; // ← Read by useCursorTypeFromHover
  // ... other fields
}
```

### Integration Checklist

**When adding interactive elements:**

- [ ] **Preferred:** Use `createInteractiveComposition()` + `useInteractiveComponent()` + `InteractiveCard`
- [ ] Create cards with `InteractiveCardVariants` for standard patterns
- [ ] Register components with `registerForCursor()` (automatic aggregation)
- [ ] **Register ALL interactive elements** including buttons, tabs, accordions, inputs
- [ ] Test: hover element → change cursor type in UI → verify preview updates

**Only if you need custom rendering:**

- [ ] Use `useInteractiveComponent()` directly with custom JSX
- [ ] Aggregate with `useInteractiveComponentsCursor()`
- [ ] Pass `autoCursorType` to `<CameraHost>`

**Avoid manual pattern unless maintaining legacy code.**

**See also:**

- `ModernPlayground.tsx` — Ultimate pattern example (145 lines, 80% reduction)
- `SimplifiedPlayground.tsx` — Helper hook pattern example (177 lines, 76% reduction)

---

## ⚠️ Critical Fixes Checklist (Avoid Regressions)

**Before committing any composition or UI component, verify:**

### Animation System

- [ ] **No hardcoded frame checks** - all timing uses track-based animation (`findTrack` / `trackProgress`)
- [ ] **Keyframe tracks** use `startFrame === endFrame` for instant state changes
- [ ] **All animations registered** - every visual change appears in timeline

### Interactive Components

- [ ] **All clickable elements registered** with `useInteractiveComponent()`
- [ ] **Zones accurately positioned** - test hover detection in preview
- [ ] **Elements aggregated** with `registerForCursor()` for cursor type changes

### Cursor Detection

- [ ] **Cursor tip detection** - `useHoverAnimationSmooth` uses `tipSize = 4` (not full cursor size)
- [ ] **Applied to both** hover AND click detection

### CSS Filters

- [ ] **Brightness/contrast/saturate** are unitless: `brightness(${value})` NOT `brightness(${value}%)`
- [ ] **Blur** uses pixels: `blur(${value}px)`
- [ ] **Hue-rotate** uses degrees: `hue-rotate(${value}deg)`

### UI Spacing & Layout

- [ ] **Toolbar gaps**: `gap-3` minimum (12px) for breathing room
- [ ] **Button padding**: `px-3 py-1.5` minimum for comfortable targets
- [ ] **Toolbars aligned** to content edges (not floating centered)
- [ ] **No overlapping elements** - 12px minimum clearance between stacked UI

### Accordion Animations

- [ ] **Fast chevron rotation** - Use CSS `transition: transform 0.3s` not spring progress
- [ ] **Content uses spring** - Panel expansion can use spring animation
- [ ] **Decouple visual states** - Chevron rotation (instant boolean) vs panel height (animated progress)

**If any item fails, fix before committing. These patterns prevent repeated bugs.**

---

## Production Deployment

- **Standard**: `pnpm build`
- **Cloud**: Use Netlify or Vercel via their MCP integrations

## Architecture Notes

- Single-port development with Vite + Nitro integration
- TypeScript throughout (client, server, shared)
- Full hot reload for rapid development
- Comprehensive UI component library included

---

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Learnings

### Icons

- **Never use the Sparkles icon** — it is reserved and must not be used anywhere in the UI.

### Agent Chat Integration

To submit a prompt to the agent for code generation, use `@agent-native/core`:

```typescript
import {
  sendToAgentChat,
  useAgentChatGenerating,
} from "@agent-native/core/client";

// Auto-submit to the agent
sendToAgentChat({
  message: "The visible user prompt",
  context: "Hidden context for the agent...",
  submit: true,
});

// Hook for tracking generation state
const [isGenerating, send] = useAgentChatGenerating();
// isGenerating is true while the agent is processing
// send({ message, context, submit: true }) to submit and track state
```

From scripts (Node.js context):

```typescript
import { agentChat } from "@agent-native/core";
agentChat.submit("Processing complete", "Optional context...");
```

### Brand Assets

| Asset                                   | Path                       | Notes                                             |
| --------------------------------------- | -------------------------- | ------------------------------------------------- |
| Builder.io logo (white, on transparent) | `/builder-logo-white.webp` | Use when users request Builder.io logo animations |
