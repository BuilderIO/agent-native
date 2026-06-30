# Code-Native Design Studio - Canonical Implementation Plan

## Goal

Turn the Design template into a Figma-class editor where code is the source of
truth. Components, tokens, motion, states, accessibility review, branches/diffs,
assets, shaders, and plugins should all round-trip through real source when the
current source can safely support it.

The editor should stay minimal and Figma-esque:

- left pages/layers
- central canvas
- right contextual inspector
- one bottom dock for timeline/review work
- no permanent chrome for every new capability

This document is the converged plan from the Claude visual plan, the Codex
architecture plan, the cross-reviews, and the supplied screenshots.

## Visual Source Of Truth

Primary visual direction:

- https://plan.agent-native.com/plans/plan-88dc4a09fb0c46bc

Supporting guardrail plan:

- https://plan.agent-native.com/plans/plan-b51dc200d7394583

Screenshot acceptance references:

- `/Users/steve/Desktop/Screenshot 2026-06-29 at 2.48.01 PM.png`
  - workbench and motion dock
- `/Users/steve/Desktop/Screenshot 2026-06-29 at 2.48.06 PM.png`
  - tokens/design-system and states/responsive panels
- `/Users/steve/Desktop/Screenshot 2026-06-29 at 2.48.09 PM.png`
  - review/a11y/diff and extensions/shaders/assets panels

## Core Decision: Runtime Tiers

Design already has three source types:

- `inline`
- `localhost`
- `fusion`

Do not add a new `builder-app` source type. Builder-backed hosted work should
fill in the existing `fusion` source mode.

The product model has two capability tiers:

### Tier A: Inline / Alpine

This is the zero-setup tier. A design is a SQL-backed HTML/CSS/Tailwind/Alpine
document rendered in a sandboxed iframe.

Inline mode supports features that only need:

- rendered DOM
- the design document's own HTML/CSS
- SQL-backed design data
- existing visual-edit and tweak paths

### Tier B: Real App

This is the full-fidelity tier. A design is backed by a real React/TypeScript app
through either:

- `localhost`: a local dev server connected through `design connect`
- `fusion`: a future hosted/Builder-backed source using the existing source mode

Real app mode supports features that need:

- module graph
- TypeScript prop types
- component exports
- cva/tailwind-variants/Storybook metadata
- real routes
- server/API data
- git branches
- deploy previews
- source-file writes

The current repo has Builder handoff and branch creation paths through
`connect-builder` / `runBuilderAgent()`. It does not currently have first-party
durable container infra for this feature. Treat "our own container infra" as a
future option, not an implementation dependency for the first real-app lane.

## One-Line Product Rule

If a feature only needs the rendered DOM or the design's own HTML/CSS/SQL, it
ships in inline mode. If it needs the module graph, TypeScript, a real build,
real data, git, or deploy, it is a real-app feature behind a "Make it real" CTA.

## Feature Tiering

| Capability                                                           | Inline / Alpine | Real App: localhost / fusion |
| -------------------------------------------------------------------- | --------------- | ---------------------------- |
| Static layout editing                                                | yes             | yes                          |
| Basic layers and selection                                           | yes             | yes                          |
| CSS variable tokens and style presets                                | yes             | yes                          |
| Tokens parsed and written to `globals.css`, Tailwind, or token files | CTA             | yes                          |
| Lightweight annotated component regions                              | yes             | yes                          |
| Full React components, prop controls, cva/Storybook variants         | CTA             | yes                          |
| Jump to component source                                             | CTA             | yes                          |
| Simple CSS keyframe motion                                           | yes             | yes                          |
| Full CSS-first multi-layer timeline                                  | yes             | yes                          |
| `motion/react` or source-code motion round-trip                      | CTA             | yes                          |
| Simple responsive frames                                             | yes             | yes                          |
| Real app states, fixtures, route captures, auth-aware captures       | CTA             | yes                          |
| Basic accessibility audit over rendered DOM                          | yes             | yes                          |
| Semantic accessibility source fixes                                  | CTA             | yes                          |
| `design_versions` visual diff                                        | yes             | yes                          |
| Real branch, PR, preview deploy, deploy, rollback                    | CTA             | yes                          |
| Asset library                                                        | yes             | yes                          |
| Shader preview                                                       | yes             | yes                          |
| Shader apply/export to source                                        | gated           | gated, later                 |
| Extensions that call design actions                                  | yes             | yes                          |
| Plugins needing app APIs/build/source                                | CTA             | yes                          |

## Make It Real

When a user reaches for a gated real-app feature in inline mode, show a compact
CTA in the relevant panel instead of dead controls.

Example CTA:

> Make this a real app to unlock components, props, data states, branches, and
> deploys.

The CTA should appear only at the moment of need:

- full component controls
- jump to source
- tokens-as-code
- data fixtures and live captures
- branches/diffs/deploys
- source-code motion round-trip
- semantic accessibility fixes

### Make-It-Real Flow

1. Connect Builder, using the existing `connect-builder` card/tooling.
2. Generate or migrate the inline design into a real React app.
3. Preserve the original inline design as a version/snapshot.
4. Use `fusion` as the hosted source descriptor for Builder-backed work.
5. Point the editor at the running real app source.
6. Unlock real-app capabilities based on explicit source capabilities.
7. Let the user review code/visual diffs and deploy through the real-app path.

Important grounding:

- Builder credentials belong in Vault/scoped credential storage.
- Builder branch/cloud-agent paths exist through `runBuilderAgent()`.
- Internal Docker/durable container sandboxing is currently a blueprint/TODO,
  not a prerequisite for this plan.

## Existing Seams To Reuse

Do not build a parallel design model.

Reuse:

- `templates/design/shared/source-mode.ts`
  - source types: `inline`, `localhost`, `fusion`
  - bridge operations: `select`, `resolveNodeToFile`, `readFile`, `applyEdit`,
    `writeFile`, `captureSnapshot`, `captureState`
- `templates/design/shared/code-layer.ts`
  - nodes, selectors, source spans, stable ids, style capabilities
- `templates/design/actions/get-code-layer-projection.ts`
  - current projection entrypoint
- `templates/design/actions/apply-visual-edit.ts`
  - deterministic HTML edit path for inline/design files
- `templates/design/actions/apply-tweaks.ts`
  - existing persisted CSS-var tweak path
- `templates/design/shared/resolve-tweaks.ts`
  - tweak selection to CSS variable resolution
- `packages/core/src/server/design-token-utils.ts`
  - CSS variable, Tailwind, CSS/SCSS, JSON/theme, static HTML, GitHub, and upload
    token parsing
- `packages/core/src/brand-kit/types.ts`
  - shared token/design-system shape
- `templates/design/app/pages/DesignEditor.tsx`
  - editor orchestration, file saves, tweak persistence, canvas state
- `templates/design/app/components/design/DesignCanvas.tsx`
  - iframe bridge, selection, style preview, canvas messages
- `templates/design/app/components/design/EditPanel.tsx`
  - right inspector surface
- `templates/design/app/components/design/DesignExtensionsPanel.tsx`
  - extension slot surface
- `templates/design/server/db/schema.ts`
  - designs, design systems, files, versions, localhost connections
- `design_versions`
  - version diff and make-it-real snapshot foundation

## Capability Gates

Add a thin capability matrix first. This must not become a large framework
project.

The UI should never infer write capability from `sourceType` alone. It should
ask the source/capability layer whether the current operation is available.

Recommended capability names:

- `select`
- `resolveNodeToFile`
- `readFile`
- `applyEdit`
- `writeFile`
- `captureSnapshot`
- `captureState`
- `indexComponents`
- `indexTokens`
- `writeTokens`
- `previewMotion`
- `writeMotion`
- `previewA11yFix`
- `applyA11yFix`
- `branch`
- `deployPreview`
- `deploy`

Behavior:

- Unsupported controls are disabled, read-only, or replaced by a make-it-real
  CTA.
- Preview controls can be available without write controls.
- Real-app writes require bridge/source hardening.
- Inline tokens and inline CSS motion do not require localhost/fusion file-write
  hardening.

## Surface Index Strategy

Do not start by building a large `design_surface_indexes` cache table.

Start with a lazy typed aggregation layer over existing data:

- code-layer projection
- tweak definitions and selections
- token parser output
- selected node metadata
- motion timeline metadata
- state/capture rows
- review findings
- source capabilities

Only add cache tables when a specific feature proves it needs:

- cross-source consistency
- expensive repeated parsing
- stale/fresh status
- incremental rebuilds
- multi-user review durability

This avoids "build the framework first" while preserving the eventual spine.

## Data Model

All schema changes must be additive. Do not drop, rename, truncate, or
destructively alter existing columns.

### Early Data

Avoid new cache tables until needed. The first lanes can use:

- `designs.data.tweakSelections`
- `design_files.content`
- `design_versions`
- existing design/source metadata
- app state

### Additive Tables When Needed

#### `component_index`

Real-app only. One row per discovered component/export/story group.

Fields:

- `id`
- `design_id`
- `source_ref`
- `name`
- `file_path`
- `export_name`
- `props`
- `variants`
- `stories`
- `source_span`
- `runtime_selectors`
- `created_at`
- `updated_at`

#### `motion_timeline`

Many per design. Scope by design plus source/screen/file/target context.

Fields:

- `id`
- `design_id`
- `source_type`
- `source_ref`
- `screen_id`
- `file_id`
- `file_path`
- `target_node_id`
- `selector`
- `tracks`
- `duration_ms`
- `default_ease`
- `compiled_hash`
- `created_at`
- `updated_at`

Notes:

- CSS is runtime truth.
- Timeline JSON is edit metadata.
- `compiled_hash` helps detect drift between metadata and managed CSS.
- A timeline can contain multiple target tracks.
- Do not use one row per design; that is too coarse.

#### `design_state`

States, fixtures, and captures.

Fields:

- `id`
- `design_id`
- `source_ref`
- `name`
- `kind`: `state`, `fixture`, or `capture`
- `breakpoint`
- `route`
- `data`
- `preview_ref`
- `created_at`
- `updated_at`

#### `design_review_snapshot`

Only add when review findings need durable snapshots beyond `design_versions`.

Fields:

- `id`
- `design_id`
- `base_version_id`
- `compare_version_id`
- `source_ref`
- `a11y_findings`
- `visual_diff`
- `status`
- `created_at`
- `updated_at`

## UI Acceptance Criteria

### Workbench

Follow the workbench screenshot.

Requirements:

- small app title
- segmented `Edit / Interact / Annotate`
- device dropdown
- zoom dropdown
- avatar and Share button
- searchable left layers rail
- `Screens` and `Layers` groups
- component rows marked with small accent diamond
- centered real app/design frame
- selected component has crisp accent outline
- small component/source tag on canvas
- right inspector keeps compact `Design / Tweaks / Extensions` tabs
- component details appear contextually inside Design
- bottom canvas toolbar stays compact
- Motion opens from a small bottom control

### Motion Dock

Follow the motion screenshot.

Requirements:

- docked timeline on the same editor surface
- canvas remains visible above timeline
- animated layer rows
- property tracks
- time ruler
- diamond keyframes
- play/scrub controls
- auto-keyframe control
- autosave status for managed CSS persistence
- compact Motion/Keyframe inspector section
- no separate motion app/screen

### Tokens Panel

Follow the tokens screenshot.

Requirements:

- friendly token names
- color swatches
- CSS variable names
- type scale rows
- radius input
- source chip such as `globals.css`
- single primary `New token` action
- calm gray row fills
- dense spacing
- understated labels

### States And Responsive Panel

Follow the states screenshot.

Requirements:

- breakpoint segmented control: Auto, Desktop, Tablet, Mobile
- selectable state rows: Default, Logged out, Empty cart, Loading, Error
- fixture rows
- `Capture from running app` action
- real-app CTA when capture is unavailable

### Review Panel

Follow the review screenshot.

Requirements:

- accessibility findings and visual diff in one compact panel
- severity dots
- concise issue text
- detail line
- optional gated Fix button
- diff rows with before/after values
- primary `Review changes` action

### Extensions, Shaders, Assets Panel

Follow the extensions screenshot.

Requirements:

- extension list: Asset library, Shader fills, Token auditor, Motion presets
- selected extension controls inline
- agent/help text
- `Add extension` action
- shader preview before shader apply
- shader apply gated on runtime/write/fallback/diff proof

## Actions

Every user-facing operation should have an action contract so the UI and agent
stay in parity.

Use `useActionQuery` / `useActionMutation` in UI. Do not create pass-through
REST routes for normal app operations.

### Foundation

- `get-design-source-capabilities`
  - read-only
  - returns operation availability and reasons
- `get-design-surface-context`
  - read-only
  - lazy aggregate of current selection, source capabilities, code-layer data,
    tokens, motion, state, and review summary

### Tokens

- `index-design-tokens`
  - read-only
  - parses inline CSS vars and real-app token sources when available
- `preview-design-token-edit`
  - preview-only
  - updates canvas without committing source
- `apply-design-token-edit`
  - inline: persists through existing tweak/CSS-var path
  - real app: writes source only when `writeTokens` is available
- `create-design-token`
  - gated by source capability

### Motion

- `get-motion-timeline`
  - read-only
  - returns timeline data for selected design/source/screen/target
- `preview-motion-frame`
  - preview-only
  - may be implemented as client-to-iframe bridge messages
- `apply-motion-edit`
  - atomic write action
  - inline: updates managed CSS/design file through existing design-file path
  - real app: updates source only when `writeMotion` is available
- `remove-motion-timeline`
  - atomic removal of metadata and managed CSS block

### Components

- `index-components`
  - real-app capable only
  - static AST/cva/Storybook first; dev transform later if needed
- `get-component-details`
  - read-only
  - returns file/export/props/variants/stories/instances
- `preview-component-prop-edit`
  - preview-only
- `apply-component-prop-edit`
  - real-app write only
- `open-component-source`
  - uses `resolveNodeToFile` where available

### States And Captures

- `list-design-states`
  - read-only
- `create-design-state`
  - adds manual inline state/fixture
- `capture-design-state`
  - real app only when `captureState` is available
- `apply-design-state`
  - selects state for preview and updates app state
- `delete-design-state`
  - deletes user-authored state/capture

### Review

- `run-design-audit`
  - read-only first
  - contrast, tap target, roles/names, alt, focus/reduced-motion hints
- `get-design-review`
  - read-only
  - returns findings and visual diff
- `preview-a11y-fix`
  - preview-only
- `apply-a11y-fix`
  - gated; real app for semantic source fixes
- `create-design-review-snapshot`
  - optional durable snapshot

### Make It Real / Builder / Branches

- `connect-builder-app`
  - wrapper or app-specific flow around existing Builder connect surfaces
- `migrate-inline-design-to-fusion`
  - generates/migrates inline design into a hosted real app source
- `get-design-branch-diff`
  - real app only
- `deploy-design-preview`
  - real app only

Do not depend on first-party internal container infra in early implementation.
Use existing Builder-hosted branch/cloud-agent paths first.

### Extensions, Assets, Shaders

- `list-design-extensions`
- `run-design-extension-action`
- `insert-design-asset`
- `preview-shader-fill`
- `apply-shader-fill`

`apply-shader-fill` stays disabled until runtime rendering, fallback generation,
source write, and diff proof are all available.

## Application State

Expose enough state for the agent to act without asking what the user is
looking at.

Recommended shape:

```ts
type DesignNavigationState = {
  view: "design-editor" | "design-overview" | "design-review";
  designId: string;
  sourceType: "inline" | "localhost" | "fusion";
  screenId?: string;
  fileId?: string;
  route?: string;
  mode: "edit" | "interact" | "annotate";
  selectedNodeIds: string[];
  selectedComponentId?: string;
  selectedTokenId?: string;
  selectedStateId?: string;
  inspectorTab: "design" | "tweaks" | "extensions";
  inspectorSection?:
    | "component"
    | "tokens"
    | "motion"
    | "states"
    | "review"
    | "extension"
    | "make-real";
  dock?: {
    kind: "motion" | "review" | null;
    open: boolean;
  };
  motion?: {
    timelineId?: string;
    playheadMs: number;
    selectedTrackId?: string;
    selectedKeyframeId?: string;
    previewing: boolean;
  };
  breakpoint?: "auto" | "desktop" | "tablet" | "mobile";
  sourceCapabilities: string[];
};
```

Update:

- `navigate`
- `view-screen`
- editor route state writes
- selected layer/node state
- selected component/token/state
- active breakpoint
- open dock
- motion playhead and selected keyframe
- current capability matrix

`view-screen` should return:

- selected component/source metadata
- token context
- motion context
- selected state/capture/breakpoint
- source capabilities
- open panel/dock
- review summary
- make-it-real CTA availability

## Agent Instructions And Skills

Update `templates/design/AGENTS.md` with:

- runtime tier rules
- capability gate rules
- action names and arguments
- make-it-real routing
- screenshot visual acceptance criteria
- motion preview/apply discipline
- shader gating
- `fusion` as the hosted/Builder-backed future source mode

Consider a dedicated skill:

- `.agents/skills/design-studio/SKILL.md`

The skill should teach agents:

- inspect capabilities before offering writes
- choose inline vs real-app behavior
- preview before apply
- use token, motion, component, state, and review actions
- offer make-it-real CTAs when a capability is gated
- preserve minimal editor chrome

## Implementation Phases

### Phase 0: Capability Gates And Visual Primitives

Goal: add the thin source capability layer and align the editor shell with the
screenshot direction.

Work:

- add `get-design-source-capabilities`
- add UI helpers for enabled/disabled/read-only/CTA states
- normalize source capability checks around `source-mode.ts`
- add or refine shared compact panel primitives:
  - row
  - segmented control
  - swatch row
  - severity row
  - property group
  - inspector CTA card
- align editor shell with screenshots

Do not:

- harden localhost/fusion file writes yet
- build a large surface-index cache table
- block Tier-A tokens/motion on real-app work

Exit criteria:

- UI can explain why a control is available, read-only, or gated.
- Editor shell can host Tokens, States, Review, Extensions, and Motion without
  new permanent chrome.

### Phase 1: Tier-A Tokens And Inline Motion

Goal: ship the first cheap user-visible win without waiting for real-app writes.

Work:

- Tokens panel as a first-class face on the existing Tweaks/CSS-var path.
- Token parsing for inline design CSS variables.
- Token preview and apply through existing persisted tweak/design-file paths.
- CSS-first Motion dock for inline documents.
- Managed `<style data-agent-native-motion>` block.
- Preview-only motion scrub messages.
- Atomic inline `apply-motion-edit`.

Exit criteria:

- User can edit a token in inline mode and see it persist.
- User can add/scrub/write simple multi-layer CSS keyframes in inline mode.
- No localhost/fusion `readFile/applyEdit/writeFile` hardening required.

### Phase 2: Make-It-Real CTA Boundary

Goal: teach the product boundary early.

Work:

- show CTA cards in gated real-app controls
- connect CTA to existing Builder connect/handoff surfaces
- preserve original inline design/version before any migration
- use `fusion` for hosted/Builder-backed source descriptors

Exit criteria:

- Inline users understand why full components, data captures, source token
  writes, branches, and deploys require a real app.
- CTA is contextual, not permanent chrome.

### Phase 3: Components For Real Apps

Goal: unlock the main Figma-competitor component story where it can be true.

Work:

- add lightweight inline component annotations only as hints:
  - `data-agent-native-component`
  - `data-agent-native-prop-*`
- do not gold-plate Alpine components
- add real-app component indexing:
  - TypeScript props
  - cva/tailwind-variants
  - Storybook where present
  - config overrides
- mark component instances in code-layer projection
- accent outline component instances
- add contextual component inspector section
- support jump to source through `resolveNodeToFile`

Exit criteria:

- Real app component instance selection shows source, props, variants, and state
  controls.
- Inline mode shows only lightweight region hints plus make-it-real CTA.

### Phase 4: Real-App Token Writes And Bridge Hardening

Goal: make tokens-as-code real.

Work:

- harden source file write path for real-app mode:
  - `readFile`
  - `applyEdit`
  - `writeFile`
  - preview diff
  - permission/session grant
  - rollback proof
- parse `globals.css`, Tailwind theme conventions, and token/theme files
- write token edits to source only when `writeTokens` is available

Exit criteria:

- Real app token edits patch source files safely.
- Inline token edits continue using the cheaper existing path.

### Phase 5: Real-App Motion Writes

Goal: extend CSS-first motion to source files.

Work:

- scope `motion_timeline` by design/source/screen/file/target
- compile deterministic managed CSS
- compose transform tracks safely
- add `compiled_hash` drift detection
- write source CSS only when `writeMotion` is available
- keep `motion/react` as later optional adapter

Exit criteria:

- Inline and real app share one mental model: managed CSS keyframes.
- Source-file motion writes are atomic and diffable.

### Phase 6: States, Responsive, And Captures

Goal: make states and responsive contexts first-class.

Work:

- breakpoint selector: Auto, Desktop, Tablet, Mobile
- inline state snapshots
- design fixtures
- real-app captures through `captureState` where available
- selected state/breakpoint in app state

Exit criteria:

- Inline mode supports manual design states and breakpoint previews.
- Real app mode captures route/app state into selectable contexts.

### Phase 7: Accessibility And Review

Goal: ship read-only review first, fixes later.

Work:

- contrast checks
- tap target checks
- basic roles/names/alt/focus/reduced-motion hints
- review panel
- visual diff over `design_versions`
- optional durable review snapshot
- gated fix actions

Exit criteria:

- Review panel shows accessibility issues and visual diffs.
- Fix buttons are read-only/gated until source writes are safe.

### Phase 8: Branches, Preview, Deploy

Goal: connect visual editing to real app shipping.

Work:

- Builder-hosted branch workflow first
- branch diff
- preview deploy
- deploy
- rollback/revert
- later: internal durable container infra if needed

Exit criteria:

- Real app edits can become reviewable branch/deploy work.
- The plan does not depend on unbuilt internal container infrastructure.

### Phase 9: Extensions, Assets, Shaders

Goal: keep advanced lanes powerful but contained.

Work:

- selection-aware asset insertion
- inline extension panels
- token auditor extension
- motion presets extension
- shader preview
- shader apply only after:
  - runtime render works
  - CSS fallback exists
  - source write exists
  - diff/rollback proof exists

Exit criteria:

- Extensions do not add permanent chrome.
- Shaders are preview-first and safely gated.

## Parallel Workstreams

Run these in parallel when implementation starts:

1. Visual shell and panel primitives.
2. Capability gates and app-state/view-screen updates.
3. Tier-A tokens on Tweaks/CSS vars.
4. Inline CSS-first motion dock.
5. Make-it-real CTA and Builder/fusion handoff.
6. Real-app component index.
7. Real-app source-write hardening.
8. States/captures.
9. Review/a11y/diff.
10. Extensions/assets/shader gating.

Keep write scopes disjoint when using parallel workers.

## Verification

### Docs/Contract

- `sourceType` remains `inline | localhost | fusion`.
- Capability names are documented in `AGENTS.md`.
- Agent actions are documented with arguments and safe usage.
- Make-it-real boundary is documented.

### UI

Use Playwright/screenshot checks for:

- workbench component-selected state
- motion dock open state
- tokens panel
- states panel
- review panel
- extensions panel
- inline make-it-real CTA

### Actions

Test:

- capability gate returns expected availability
- token preview/apply in inline mode
- motion preview does not persist
- motion apply persists managed CSS
- component index handles representative React/cva fixture
- capture state respects source capabilities
- a11y audit returns stable findings

### Agent Parity

Verify the agent can:

- inspect selected component/token/motion/state via `view-screen`
- refresh surface context
- apply an inline token edit
- create/apply inline motion
- explain gated real-app features
- trigger make-it-real flow
- run review and summarize findings

### Real-App Smoke

When real-app support lands:

- connect Builder or localhost
- index a React component
- select instance on canvas
- show props and source
- preview prop edit
- apply safe source edit
- parse and write token source
- capture route/app state
- generate visual/code diff
- deploy preview

### Inline Smoke

- edit layout
- edit CSS variable token
- add simple keyframe motion
- switch responsive frame
- run basic a11y scan
- see CTA for full component/source features

## Risks

### Bridge Hardening Blocks Cheap Wins

Mitigation:

- capability gates first
- bridge hardening with real-app lane
- inline tokens/motion use existing design-file paths

### Surface Index Becomes Framework-First Work

Mitigation:

- lazy aggregation first
- cache tables only after real performance/freshness need

### Split Motion Source Of Truth

Mitigation:

- CSS is runtime truth
- JSON is edit metadata
- atomic apply
- `compiled_hash`
- diff/rollback proof

### Alpine Components Become A Time Sink

Mitigation:

- keep inline components as lightweight annotated regions
- real component intelligence is real-app only

### Overclaiming Real-App Writes

Mitigation:

- explicit source capabilities
- preview/apply split
- disabled/read-only/CTA states
- no inferred writes from source type

### Inspector Sprawl

Mitigation:

- contextual sections
- one bottom dock
- extension panels
- no new permanent tabs without evidence

### Shader Prematurity

Mitigation:

- preview first
- apply later behind runtime/source/fallback/diff gates

## Initial Milestone

The first milestone should not be full React component editing. That requires too
much unbuilt real-app plumbing.

The first milestone is:

> In an inline design, open the screenshot-aligned Tokens panel, edit a friendly
> CSS variable token through the existing Tweaks path, open the Motion dock, add
> a simple multi-layer CSS keyframe animation, preview it by scrubbing, and write
> it into the design document with a visible proof.

This proves the thesis cheaply:

- visual edit becomes durable CSS/design data
- editor shell matches the visual direction
- capability gates and CTAs establish honest product boundaries
- the future real-app path is visible without blocking the first win

## Canonical Execution Order

1. Capability gates and screenshot-aligned UI primitives.
2. Tier-A Tokens panel on existing Tweaks/CSS-var path.
3. Tier-A CSS-first Motion dock and inline managed keyframes.
4. Make-it-real CTAs and Builder/fusion handoff framing.
5. Real-app component indexing and component inspector.
6. Real-app source-write hardening for tokens and motion.
7. States, responsive contexts, and captures.
8. Read-only accessibility and visual diff review.
9. Branch, preview, deploy, and rollback.
10. Assets, shaders, plugins as gated extension lanes.
