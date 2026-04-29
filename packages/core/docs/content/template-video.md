---
title: "Video"
description: "A programmatic video studio for motion graphics, product demos, and kinetic text. Generate animations from a prompt and tune them on a timeline."
---

# Video

A programmatic video studio for the kind of motion graphics, product demos, and kinetic-text videos that are a pain to keyframe by hand. Ask the agent for "a 6-second logo reveal that fades in at 2 seconds" and it builds the animation. Tune timing, easing, and camera moves on a timeline, then render to MP4 or WebM.

When you open the studio, you'll see a list of compositions on the home screen. Click into one and you get a player on top, a timeline at the bottom, and a properties panel on the right. The agent always knows which composition you have open.

## What you can do with it

- **Generate animations from a prompt.** "Add a title card that fades in at 2 seconds and holds until 5." The agent edits the composition.
- **Tune timing on a timeline.** Drag and resize animation tracks, scrub through frames, set easing curves visually.
- **Animate the camera.** Pan, zoom, and tilt with on-screen tools. Click the tool, drag in the preview, and a keyframe is auto-created.
- **Built-in compositions to start from.** Twelve examples ship: kinetic text, logo reveals, particle bursts, interactive UI demos, slideshows.
- **Edit easing curves visually.** 30+ curves shipped — power, back, bounce, circ, elastic, expo, sine, plus spring physics.
- **Render to MP4 or WebM** at 1x, 2x, or 3x supersampling for crisp text and vectors during camera zoom.

This is more of a developer-flavored tool than other templates — compositions are React components, so power users (or the agent) can write whole new animation types from scratch. But everyday tweaks ("make the typing slower," "drop the particle count to 12") are just chat.

## Getting started

Live demo: [videos.agent-native.com](https://videos.agent-native.com).

When you open the studio:

1. Pick a composition from the home screen.
2. Try the agent: "add a logo reveal that fades in at 2 seconds." Watch the timeline update.
3. Drag tracks to retime, click the camera tool, scrub the player.

### Useful prompts

- "Add a title card that fades in at 2 seconds and holds until 5."
- "Change the camera to zoom 2x on the logo between frames 60 and 90."
- "Make the typing reveal slower — 40% longer."
- "The particle burst is too dense. Drop the count to 12."
- "Create a new composition called intro-loop, 1080x1080, 6 seconds."
- "Add a click animation on the button zone and animate the cursor to it."
- "Give this track a spring easing instead of ease-out."

If you select a track in the timeline and hit Cmd+I, the agent picks up that selection — "make this one snappier" just works.

## For developers

The rest of this doc is for anyone forking the Video template or extending it. This template is more code-forward than the others — every composition is a React component and every animation is data on a track.

### Architecture

Everything you see in the studio is code. A composition is a `CompositionEntry` in `app/remotion/registry.ts` that points at a React component in `app/remotion/compositions/`. Every animation in that component reads from an `AnimationTrack` so users can drag, resize, and retime it in the timeline UI. The agent can create new compositions, add tracks, tune easing, and write whole React components that plug into the registry.

The studio runs on Remotion's `<Player>` for preview and the Remotion CLI for final render. Output defaults to 1920x1080 at 30fps.

### Quick start

Create a workspace with the Video app scaffolded:

```bash
npx @agent-native/core create my-video-app
```

During the picker, select **Video**. Then:

```bash
cd my-video-app
pnpm install
pnpm dev
```

Open the studio in your browser and pick a composition from the home screen. Ask the agent something like "add a logo reveal that fades in at 2 seconds" and it will edit the registry and the composition for you.

Live demo: [videos.agent-native.com](https://videos.agent-native.com).

### Key features (technical)

### React-based compositions

Every video is a React component built on Remotion primitives (`AbsoluteFill`, `useCurrentFrame`, `useVideoConfig`). Twelve example compositions ship by default — kinetic text, logo reveals, particle bursts, interactive UI demos, slideshows. Add new ones by dropping a `.tsx` file in `app/remotion/compositions/` and registering it in `app/remotion/registry.ts`.

### Timeline tracks

Animations are tracks, not hardcoded frame checks. A track has `startFrame`, `endFrame`, `easing`, and a list of `animatedProps` (`opacity`, `translateY`, `scale`, rotation, colors, etc.). Three track shapes:

- **Duration tracks** — bars you can drag and resize in the timeline.
- **Keyframe tracks** — diamond markers at specific frames for instant state changes (`startFrame === endFrame`).
- **Expression tracks** — programmatic animations (typing reveals, particle bursts) flagged with `programmatic: true` and shown with a purple `fx` badge.

Helper utilities in `app/remotion/trackAnimation.ts` (`findTrack`, `trackProgress`, `getPropValue`) wire a track's values into a component's render.

### Easing curves

30+ easing curves ship in `app/types.ts` — linear, power1-4 in/out/inOut, back, bounce, circ, elastic, expo, sine, and Remotion's `spring`. The Properties panel shows a visual preview of the curve shape for each one.

### Camera controls

Each composition has a dedicated `camera` track with six animatable properties: `translateX`, `translateY`, `scale`, `rotateX`, `rotateY`, `perspective`. The camera toolbar above the player has pan, zoom, and tilt tools — click a tool, drag on the preview, and a keyframe is auto-created at the current frame. `CameraHost` (in `app/remotion/CameraHost.tsx`) applies the chained CSS 3D transform to everything inside.

### Multi-keyframe editing

Every animated property supports an optional `keyframes` array. Interpolation is linear between keyframes, with hold-at-first and hold-at-last at the edges. In the timeline you can box-select keyframes, shift-click to add or remove, and drag groups while keeping relative timing.

### Adjustable parameters

Programmatic animations expose internal magic numbers as user-editable `parameters` — character width, drift distance, particle count, stagger delay. Inputs appear in the Properties panel with min/max/step bounds and save to localStorage automatically.

### Interactive cursor system

The `cursor` track drives a visible cursor that moves across the composition. Hover zones on interactive elements (buttons, tabs, inputs, cards) change the cursor appearance — arrow, pointer, or I-beam. See `app/remotion/hooks/useInteractiveComponent.ts` and `app/remotion/ui-components/InteractiveCard.tsx`.

### View range and repeat playback

The timeline has a range navigator at the bottom (AE-style triangular handles). Drag to zoom and pan the visible time window. Playback in the player is constrained to that range, with a repeat toggle that loops inside it.

### Render output

Composition size, fps, and render quality are per-composition in the Properties panel. Render quality is supersampling — 1x, 2x, or 3x internal resolution to keep text and vectors crisp during camera zoom. Final render happens via the Remotion CLI to MP4 or WebM.

### Composition persistence

User edits (track values, parameter values, prop overrides, composition settings) persist to localStorage per composition. The **Save** button in the top-right of the composition view writes the current state back to `app/remotion/registry.ts` as TypeScript — so new users and sessions pick up the changes.

### Working with the agent

The agent always knows which composition you have open. Navigation state (`{ view, compositionId }`) is written to the framework's `application_state` table, and the `view-screen` action returns it plus a hint pointing at `app/remotion/registry.ts`. You don't have to tell the agent which composition you're on — ask it to act on "this one" and it will.

Under the hood the agent calls actions like `navigate`, `create-composition`, `generate-animated-component`, and edits `app/remotion/registry.ts` and `app/remotion/compositions/*.tsx` directly. Every change shows up in the timeline.

### Data model

Server-side schema is in `templates/videos/server/db/schema.ts`:

- `compositions` — id, title, type, `data` (full composition JSON blob), ownership columns, timestamps.
- `composition_shares` — standard share grants produced by `createSharesTable()`.

The registry in `app/remotion/registry.ts` is the in-code source of truth for what ships with the template. The SQL table stores user-created compositions and overrides. Studio state (per-composition track edits, prop overrides, composition settings) is mirrored to `localStorage` under `videos-tracks:<id>`, `videos-props:<id>`, and `videos-comp-settings:<id>`, and deep-merged back onto the registry defaults on load.

Core TypeScript shapes (`app/types.ts`):

- `AnimationTrack` — `id`, `label`, `startFrame`, `endFrame`, `easing`, `animatedProps[]`.
- `AnimatedProp` — `property`, `from`, `to`, `unit`, plus optional `keyframes`, `programmatic`, `description`, `codeSnippet`, `parameters`, `parameterValues`.
- `CompositionEntry` — `id`, `title`, `description`, `component`, `durationInFrames`, `fps`, `width`, `height`, `defaultProps`, `tracks`.

Compositions are private by default. Visibility can be `private`, `org`, or `public`, and share grants give `viewer`, `editor`, or `admin` roles — wired through the framework's sharing primitive.

### Customizing it

The template folder is `templates/videos/` (the user-facing slug is `video`, but the folder is plural).

**Actions** — `templates/videos/actions/`

- `view-screen.ts` — returns current navigation state for the agent.
- `navigate.ts` — navigate to a composition (`--compositionId <id>`) or the home view (`--view home`).
- `create-composition.ts` — scaffold a new composition with the standard camera and cursor tracks.
- `generate-animated-component.ts` — generate a new animated component file with boilerplate.
- `validate-compositions.ts` — check all registered compositions for structural problems.
- `list-compositions.ts`, `get-composition.ts`, `update-composition.ts`, `delete-composition.ts`, `save-composition.ts` — CRUD over the SQL table.

**Routes** — `templates/videos/app/routes/`

- `_index.tsx` — studio home; renders the shell and composition list.
- `c.$compositionId.tsx` — composition editor (timeline, player, properties panel).
- `components.tsx` — component library browser.
- `team.tsx` — team management.

**Remotion internals** — `templates/videos/app/remotion/`

- `registry.ts` — the authoritative composition list.
- `compositions/` — one `.tsx` per composition, plus an `index.ts` barrel.
- `trackAnimation.ts` — `trackProgress`, `getPropValue`, `findTrack`, `getPropValueKeyframed`.
- `CameraHost.tsx` — wraps composition content with the camera transform.
- `hooks/`, `ui-components/`, `components/` — interactive element helpers, cursor rendering, animated element wrappers.

**Studio UI** — `templates/videos/app/components/`

- `Timeline.tsx` — the fully-controlled timeline (`viewStart` / `viewEnd` own no state internally).
- `VideoPlayer.tsx` — Remotion `<Player>` wrapper with range-constrained playback.
- `TrackPropertiesPanel.tsx`, `CompSettingsEditor.tsx`, `PropsEditor.tsx` — the right-side panels.
- `CameraToolbar.tsx`, `CameraControls.tsx` — camera tools and numeric controls.

**Agent instructions** — `templates/videos/AGENTS.md` is the long-form guide the agent reads. It covers the animation-as-track rule, camera system, cursor system, CSS filter units, interactive component registration, UI spacing, and checklists for creating or editing compositions.

**Skills** — `templates/videos/.agents/skills/`

- `composition-management/SKILL.md` — how to create and register compositions.
- `animation-tracks/SKILL.md` — how to edit tracks and animated props.
- Plus the standard framework skills: `actions`, `self-modifying-code`, `delegate-to-agent`, `storing-data`, `security`, `frontend-design`, `create-skill`, `capture-learnings`.

To add a new composition, follow the checklist in `AGENTS.md`: create the component, declare `FALLBACK_TRACKS`, use `findTrack` / `trackProgress` / `getPropValue` (never hardcode frames), export from `compositions/index.ts`, add a `CompositionEntry` to the registry, and run `pnpm typecheck`.
