# Code-Native Design Studio — Canonical Implementation Plan

> Converged plan, merged from two independent passes (Claude + Codex) and their
> cross-reviews. This is the single source of truth; implement from this doc.
>
> - **Product / runtime-tier spine** (the organizing principle).
> - **Capability matrix + preview/apply actions + application-state shape +
>   atomic-motion guardrail + screenshot acceptance criteria** (the contract).
> - **Builder-hosted branch + `fusion` first; our own durable container later.**
> - **First cheap win: Tokens on the existing Tweaks loop + CSS-first motion on
>   inline designs.**
>
> Visual source of truth: the published visual plan
> <https://plan.agent-native.com/plans/plan-88dc4a09fb0c46bc> (workbench, motion
> dock, tokens, states, review, extensions). Its artboards are the acceptance
> references for the panels below.

---

## 0. Goal & thesis

Turn the Design template into a Figma-class editor where the canvas and the
codebase are two views of the same product. The thesis: **when a source can
safely support it, a visual edit writes real code, and a source edit shows up on
the canvas.** Keep the editor minimal and Figma-esque — left pages/layers,
central canvas, right inspector, and a bottom dock only when motion or review
needs it — and add code-backed components, tokens, motion, states/captures,
accessibility review, visual diffs, assets/shaders/plugins, and a real-app path.

---

## 1. Runtime tiers (the organizing principle)

The editor already has a `sourceType` contract — `inline | localhost | fusion`
(`templates/design/shared/source-mode.ts`). Treat those as **two capability
tiers**:

### Tier A — Inline (HTML + Alpine), zero-setup

A design is a sandboxed iframe of semantic HTML + Tailwind + a little Alpine,
stored in SQL (`designs.data`, `design_files`, rendered via `srcdoc`). No build,
no module graph, no TypeScript, no real routes/server. This is the instant,
shareable, "open a URL and design" on-ramp and the default.

### Tier B — Real app (localhost **or** fusion / Builder)

A design is backed by a real React/TS codebase.

- **`localhost`** — the bridge talks to a dev server on the user's machine
  (`designLocalhostConnections`, `connect-localhost.ts`).
- **`fusion`** _(the new hosted tier)_ — connect Builder.io and run the app as a
  Builder-hosted branch (today) or, later, our own durable container. Same
  capabilities as localhost but hosted, collaborative, and deployable.

> `localhost` and `fusion` are the **same "real app" capability tier** seen
> through two transports. Everything gated to "real apps" works in both; the only
> difference is where the code lives.

### 1.1 Tiers are coarse; capabilities are the real gate

The UI must **never infer write ability from `sourceType` alone.** Each source
advertises an explicit capability set, and every control reads it. A control is
**enabled**, **preview-only / read-only**, or a **migration CTA** purely as a
function of capabilities. This is what stops the agent or UI from ever promising
a write the bridge can't perform (localhost can read but not write _yet_; `fusion`
starts preview-only until its bridge is real). The tier table in §2 is the
_consequence_ of these capability sets, not a parallel switch. The capability
matrix is defined in §5.

---

## 2. Feature tiering — Alpine vs. real app

| Capability                                                                                                                                                                | Inline / Alpine                  | Real app (localhost / fusion) | Why                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- | ------------------------------------------------ |
| Reusable blocks / Alpine "components" — annotate a DOM subtree or `Alpine.data()` island; simple `x-data` variants                                                        | ✅ (kept deliberately **light**) | ✅ (superset)                 | Pure markup                                      |
| **Full code components** — prop tables from TS / `cva` / `tailwind-variants`, Storybook variants, instance outlines, **jump to source**, edit canonical component, detach | **Real app** → CTA               | ✅                            | Needs module graph + TS types + multi-file edits |
| Tokens — live CSS-var editing (friendly swatches for the design's own `:root` vars)                                                                                       | ✅                               | ✅                            | Design owns its CSS vars                         |
| **Tokens-as-code** — parse `globals.css` / `tailwind.config` and **write back to source**                                                                                 | **Real app** → CTA               | ✅                            | Auto-parse + source write-back needs real files  |
| **Motion** — multi-layer keyframe timeline → managed `<style data-agent-native-motion>` block                                                                             | ✅                               | ✅                            | CSS is the runtime truth; works on any HTML      |
| Motion source export — write to real CSS modules / `motion`-react two-way / Dev Mode export                                                                               | **Real app** → CTA               | ✅                            | Two-way code round-trip needs real files         |
| Responsive / breakpoints                                                                                                                                                  | ✅                               | ✅                            | CSS media queries                                |
| Simple design states (logged out, empty, loading, error) as alternate `x-data` / DOM                                                                                      | ✅                               | ✅                            | Markup snapshots                                 |
| **Data fixtures & live captures** (real running-app data, route, props, API)                                                                                              | **Real app** → CTA               | ✅                            | No live data on a static design                  |
| Accessibility audit (contrast, tap targets, roles, alt)                                                                                                                   | ✅                               | ✅                            | Reads the rendered DOM                           |
| Version diff (`design_versions`)                                                                                                                                          | ✅                               | ✅                            | SQL versions already exist                       |
| **Real branches + PRs + deploy**                                                                                                                                          | **Real app** → CTA               | ✅                            | Needs git + branch + deploy                      |
| Extensions / shaders / asset library                                                                                                                                      | ✅                               | ✅                            | Extensions are the Alpine substrate              |
| Semantic a11y fixes in code; plugins needing the app's own APIs/build                                                                                                     | **Real app** → CTA               | ✅                            | Needs real source / build                        |

**The one-line rule:** if a feature only needs the **rendered DOM or the design's
own HTML/CSS+SQL**, it ships in Alpine. If it needs the **module graph, TS types,
a real build, real routes, server data, or git/deploy**, it's a **real-app**
feature behind a Connect-Builder CTA. _Motion crosses into Alpine because we make
it CSS-first._

---

## 3. The "Make it real" upgrade flow (Connect Builder)

Advanced panels are never dead ends; they are CTAs. On an inline design, the
gated controls render an inline upgrade card (progressive disclosure — only when
the user reaches for a real-app feature):

> **Make this a real app** — connect Builder.io to unlock components, props, data
> states, branches, and deploys.

### 3.1 What already exists vs. what's new

Most of the backend exists. The genuinely-new pieces are small:

1. **Connect** _(exists)_ — the `connect-builder` card
   (`packages/core/src/server/agent-chat-plugin.ts`, `kind:
"connect-builder-card"`, `{ configured, builderEnabled, connectUrl }`) runs the
   Builder OAuth / `cli-auth` flow and stores a scoped credential
   (`credential-provider.ts`). `builderEnabled` flips true once a branch project is
   configured (`resolveBuilderBranchProjectId()`). Vault owns the secret; the app
   owns a scoped reader.
2. **Migrate** _(NEW)_ — there is no inline→React migration today. Feed the
   design's semantic HTML **plus** its `:root` CSS vars / Brand Kit tokens as the
   seed to the existing Builder cloud agent (`runBuilderAgent()` via
   `startWorkspaceAppCreation()`, `packages/dispatch/.../app-creation-store.ts`),
   producing a real React + Tailwind app. Tokens carry over 1:1 by seeding the
   app's token config from the Brand Kit; annotated Alpine "components" map to real
   components where possible (`implementWithDesignSystem` / `planWithDesignSystem`
   from builder-mcp assist).
3. **Provision** _(exists; today = Builder-hosted branch)_ —
   `startWorkspaceAppCreation()` returns `{ branchName, url, status }`: a GitHub
   branch in Builder's hosting running as a full React app, tracked pending until
   merged. **No per-user container is required for v1.** _Our own isolated dev
   containers are the `SandboxAdapter` Docker adapter — a blueprint
   (`packages/core/blueprints/sandbox/docker.md`); only the local child-process
   adapter is built. Treat self-hosted containers as an optional, heavier
   follow-on._
4. **Reconnect** _(NEW — implement `fusion`)_ — flip the design's `sourceType`
   from `inline` to `fusion` (the enum + i18n exist; the bridge/rendering is the
   stub to fill in). `fusion` points the editor at the Builder-hosted app's dev URL
   and uses the bridge for snapshot + code context. Gated panels light up.
5. **Deploy** _(exists)_ — merge the Builder branch → the existing template deploy
   path (`packages/core/src/deploy/build.ts`, Netlify / CF Pages).

### 3.2 The three genuinely-new pieces (everything else is reuse)

1. **Migration**: inline HTML/Alpine + tokens → a real React seed for the Builder
   cloud agent.
2. **`fusion` source mode**: bridge + rendering so the editor drives a
   Builder-hosted app the same way it drives an inline iframe.
3. **Bridge write hardening**: promote `readFile` / `applyEdit` / `writeFile` from
   `planned` → `available` behind the bridge permission model.

### 3.3 Reversibility

Migration is additive and non-destructive: the original inline design is kept as a
`design_version` snapshot so "make it real" can be previewed/rolled back. The user
approves the generated app before cutover.

---

## 4. Architecture

### 4.1 Foundations we reuse (do not rebuild)

- **Source modes & bridge** — `source-mode.ts` defines `inline | localhost |
fusion` plus the `DesignBridgeRequest` op set: `select`, `resolveNodeToFile`,
  `readFile`, `applyEdit`, `writeFile`, `captureSnapshot`, `captureState`.
  `select` / `resolveNodeToFile` / `captureSnapshot` / `captureState` are
  **`available`**; `readFile` / `applyEdit` / `writeFile` are **`planned`**
  (`connect-localhost.ts` — _"Local file writes require the next bridge hardening
  pass"_). The iframe postMessage bridge in `DesignCanvas.tsx` already carries
  parent→iframe (`tweak-values`, `style-change`, `replace-document-content`,
  `select-element`, `layer-states`, `delete-element`) and iframe→parent
  (`element-select`, `visual-style-change`, `visual-structure-change`,
  `text-content-change`, …). New writes add **named** messages (e.g.
  `motion-preview`), never ad-hoc ones.
- **Code-layer projection** — `code-layer.ts` (+ `get-code-layer-projection.ts`)
  models nodes, selectors, and `CodeLayerSourceSpan` byte offsets, mapping
  elements to source via `data-agent-native-node-id` (stamped by
  `ensureCodeLayerNodeIdsInHtml`; rename target `data-agent-native-layer-name`).
- **Deterministic edit path** — `apply-visual-edit.ts` + the
  `replace-document-content` bridge message already do inline HTML writes
  (preview + persist via the Yjs/collab path, `applyLocalContentUpdate`).
- **Tweaks (CSS-var write path)** — a `TweakDefinition` (`shared/api.ts`) carries a
  `cssVar`; `resolveTweaksToCssVars` (`resolve-tweaks.ts`, byte-identical
  client/server) → `{ "--var": value }`; `apply-tweaks` persists to
  `designs.data.tweakSelections`; the injected `TWEAK_BRIDGE_SCRIPT` applies
  `tweak-values` live via `documentElement.style.setProperty`. **This is the
  Tier-A Tokens write path.**
- **Brand Kit & token parsing** — `packages/core/src/brand-kit/types.ts`
  (`BrandKitData`) is the shared shape; `DesignSystemData` extends it.
  `design-token-utils.ts` parses CSS vars (`extractCssVars`), Tailwind
  (`parseTailwindConfig`), CSS/SCSS (`parseCss`), JSON/theme files, HTML URLs,
  GitHub (≤10 files), uploads — **import/read-only today** (no write-back).
  `import-code.ts` is the import entry. `design_systems` rows store a `data` JSON
  blob; the current UI edits metadata + shows a read-only token preview.
- **Versions** — `design_versions` exists; reused for diff + migration snapshots.
- **Canvas frames** — `canvas-frames.ts` + `MultiScreenCanvas.tsx` for overview
  geometry; reused by states/responsive.
- **Extensions** — the sandboxed Alpine mini-app substrate +
  `DesignExtensionsPanel.tsx` inspector slot; shaders/plugins are extensions.
- **Builder & app-creation** — `connect-builder` card, `runBuilderAgent()`,
  `startWorkspaceAppCreation()`, `create_workspace_app` (scaffold), `build.ts`
  (deploy) all exist; the real-app tier wires these, it does not invent them.

### 4.2 Design Surface Index — a lazy read-model, not an up-front cache

Normalize what already exists (nodes, components, tokens, motion, states, review,
extension contributions) into **one queryable surface** that both UI panels and
agent actions read. **Grow it lazily from the existing `code-layer.ts` projection
and per-feature needs; do not build a normalized cache table up front.** Add a
cache (`design_surface_indexes`) only if/when re-parsing proves to be a real
performance problem, with incremental rebuilds keyed by file/source hash and an
initial scope limited to the active route/screen. Shared types live under
`templates/design/shared/`: `design-surface-index.ts`,
`design-source-capabilities.ts`, `motion-timeline.ts`, `design-state.ts`,
`design-review.ts`.

### 4.3 New durable data (additive only)

Additive — never drop/rename/retype. All tables use `ownableColumns()` and are
read/written through `accessFilter` / `assertAccess`.

```
component_index            # real-app component metadata
  id (pk); design_id -> designs.id; source_ref
  name; file_path; export_name
  props jsonb              # parsed prop types / cva variants
  variants jsonb; stories jsonb
  runtime_selectors jsonb; created_at; updated_at

motion_timeline            # scoped to design + source + screen/file (MANY per design)
  id (pk); design_id -> designs.id; source_ref
  file_path                # null for inline (lives in the managed <style> block)
  tracks jsonb             # [{ target_node_id, property, keyframes:[{t,value,ease}] }]
                           #   -- multiple target layers, each with property tracks
  duration_ms; default_ease
  compiled_hash            # keep timeline JSON and compiled CSS in lockstep
  created_at; updated_at

design_state               # states, fixtures, captures
  id (pk); design_id -> designs.id; source_ref
  name; kind               # 'state' | 'fixture' | 'capture'
  breakpoint               # 'auto' | 'desktop' | 'tablet' | 'mobile'
  route; fixture_data jsonb; capture_data jsonb; preview_ref
  created_at; updated_at

design_review_snapshot     # cache a11y + visual-diff results (add when needed)
  id (pk); design_id -> designs.id
  base_version_id; compare_version_id; source_ref
  a11y_findings jsonb; visual_diff jsonb; status
  created_at; updated_at
```

`designs.source_type` already exists; migration flips `inline` → `fusion`.
`design_versions` is reused for diff + snapshots.

---

## 5. Source capabilities (the contract)

Every source advertises what it can safely do; the UI gates on this, never on
`sourceType`.

```
readFile  writeFile  applyEdit  resolveNodeToFile  previewPatch  diffPatch
captureSnapshot  captureState  indexComponents  indexTokens  writeTokens
previewMotion  writeMotion  branch  deployPreview  deploy
```

Behavior:

- **Inline / design-file** — HTML/CSS preview + controlled writes through the
  existing deterministic path (`replace-document-content` / `apply-tweaks`);
  `previewMotion` + Tier-A `writeMotion` (managed `<style>` block) and CSS-var
  token edits are available without the file-write bridge.
- **localhost** — starts read-only/preview-only; `readFile` / `applyEdit` /
  `writeFile` become available only after bridge hardening.
- **fusion (Builder)** — starts preview-only; unlocks the full set
  (`indexComponents`, `writeTokens`, `writeMotion`, `branch`, `deploy`) once the
  bridge proves capabilities.
- A control reads the matrix and renders **enabled**, **preview-only**, or
  **migration CTA**. The agent reads the same matrix and never claims an
  unsupported write.

---

## 6. Feature workstreams

Each workstream touches the four required areas — **UI, actions,
skills/instructions, application state** — and names its Alpine vs. real-app
behavior. UI binds through `useActionQuery` / `useActionMutation`; never raw fetch.

### 6.1 Editor workbench & components

**UI (matches the workbench artboard):** quiet top toolbar (title, segmented
`Edit / Interact / Annotate`, device dropdown, zoom dropdown, avatar, Share); left
rail (search → Screens → Layers, component rows marked with an accent diamond,
selected instance in a soft accent row); canvas (central frame, selected-instance
accent outline, a source-aware tag like `PrimaryButton →`, a small bottom local
toolbar, a compact Motion disclosure); right inspector keeps `Design / Tweaks /
Extensions` compact, with component details shown **contextually inside Design**
(no permanent Components tab unless real usage proves the need).

**Alpine:** annotate a DOM subtree with `data-agent-native-component="Name"` (or an
`Alpine.data()` island); code-layer marks instances; canvas outlines them; the
Design tab shows the simple `x-data` variants. **Deliberately light — a bridge to
real apps, not a fake component system.**

**Real app:** `index-components` runs a build-time index (TS prop types, `cva` /
`tailwind-variants`, Storybook stories) and injects dev metadata
(`data-agent-native-component`, `data-agent-native-prop-*`, source span) via a
Vite/Babel transform; canvas outlines real instances; jump-to-source reuses the
bridge `resolveNodeToFile` op keyed off `data-agent-native-node-id`; the inspector
renders prop controls from the prop types; detach/instance edits write through the
bridge. Indexing modes: static AST parse on connect first, dev transform later for
runtime-variant fidelity; config/annotation escape hatches (`agent-native.design.ts`).

**Acceptance:** selecting a component instance outlines it in the accent color; in
a real app the inspector shows name, source file, variant/size/state controls,
token usage, and an **Edit component** action; in Alpine the user gets lightweight
region hints + the real-app CTA; the agent sees selected-component context via
`view-screen`.

### 6.2 Tokens / design systems

**UI (matches the tokens artboard):** friendly token names + swatches, CSS-var
name on the right, type-scale section, radius input, a source chip (e.g.
`globals.css`), a **New token** action; grouped by color / type / spacing-radius /
shadows-effects.

**Alpine:** the panel is a first-class face on the **Tweaks** loop — edits go
through `apply-tweaks` (live `tweak-values` preview, persisted in
`designs.data.tweakSelections`).

**Real app:** additionally auto-parses `globals.css` / `tailwind.config` / theme
JSON (`design-token-utils.ts`) and **writes back to source** via `apply-design-token-edit`
through the hardened write bridge; tokens become tokens-as-code; the Brand Kit is
the shared shape across Design / Slides / Assets.

**Acceptance:** editing a token previews immediately; writing patches the source
only through a capability-gated action.

### 6.3 Motion dock (CSS-first; the headline)

**Both tiers.** A `MotionTimeline` compiles into a managed `<style
data-agent-native-motion>` block targeting layers by `data-agent-native-node-id`.
The CSS is the runtime truth; the JSON `tracks` only aid editing.

- **UI (matches the motion artboard):** a full-width, collapsible **Motion dock**
  at the bottom of `DesignEditor.tsx` (animated layer rows, property tracks, time
  ruler, diamond keyframes, play/scrub, auto-keyframe toggle, autosave status),
  with the canvas still visible above; a compact **Motion section** in the
  inspector for the selected keyframe (numeric + easing + transform/opacity).
- **Preview:** scrubbing sends preview-only bridge messages (`motion-preview` /
  playhead); it **never** writes to DB / Yjs / source.
- **Apply (atomic, non-negotiable):** `apply-motion-edit` updates timeline
  metadata, compiled CSS, Yjs/collab state, revision check, diff + rollback proof,
  and iframe refresh **together**; `compiled_hash` guards drift. Include a
  reduced-motion strategy in both preview and output.

**Real-app superset:** write keyframes into real CSS modules, optional
`motion`-react round-trip, Dev Mode export.

**Acceptance:** scrubbing never writes; timeline edits autosave through one atomic
action with diff/rollback proof; multiple layers and tracks animate.

### 6.4 States, responsive & captures

#### Responsive — multi-breakpoint editing (Framer / Figma-Sites style)

Show one screen at several breakpoints **side by side** in the overview and edit
each independently. Researched models we borrow from:

- **Framer** — Desktop (the parent) + Tablet **810** + Phone **390** as
  side-by-side frames; added via a **Breakpoint button** on the page selection
  (infinite, resizable). Desktop-first: a frame drawn on Desktop propagates down to
  smaller breakpoints; a smaller-breakpoint edit overrides only that frame.
- **Figma Sites** — Desktop **1280** / Tablet **800** / Mobile **375**; a **`+` in
  the webpage header on the canvas** adds a predefined or custom width; primary →
  secondary cascade (default primary = Desktop ⇒ desktop-first); **"Set as primary
  breakpoint"** flips to mobile-first; per-property, per-breakpoint overrides;
  **"Reset all changes"** reverts a layer to the inherited (primary) value;
  responsive components auto-match variants by breakpoint name.

**Our model — mobile-first by default, because the output is Tailwind.** Unlike
Framer/Figma (desktop-first), we make the **base = mobile** and let larger
breakpoints layer overrides upward — which is exactly Tailwind's min-width cascade
(`base` → `md:` → `lg:`). This matches the requested preference and makes "edit on
screen → responsive class" deterministic.

- **Overview:** a screen carries a **breakpoint set**; `MultiScreenCanvas` renders
  one iframe **per breakpoint at its width**, laid left→right (Mobile → Tablet →
  Desktop), all bound to the **same source** (same `srcdoc` for inline, same URL for
  localhost/fusion). A **`+` at the right edge** adds the next device size
  (Mobile 390 / Tablet 768 / Desktop 1280, or a custom width). Store the set by
  extending `canvas-frames.ts` geometry to a per-breakpoint frame list (not a fixed
  single geometry per file). Frames **snap to Tailwind breakpoint min-widths**
  (`md` 768, `lg` 1024, `xl` 1280) so each frame maps 1:1 to a prefix.
- **Per-breakpoint editing = the active frame is the edit scope.** Editing a layer in
  the **Mobile** frame writes the **unprefixed** class (the base); the same edit in
  **Tablet** writes `md:…`; in **Desktop** writes `lg:`/`xl:…`. Inherited values
  cascade up from base unless a prefixed override exists. For non-Tailwind / inline
  CSS, the edit writes into a `@media (min-width: …)` block in the managed style.
- **This is the main new code-layer work.** Today the projection **detects but
  strips** Tailwind `sm:`/`md:`/`lg:` prefixes and all class edits are global
  (`code-layer.ts`; `EditCapability` has no responsive kind). Add a
  **responsive-aware class model**: parse class tokens grouped by breakpoint
  (base, `sm:`, `md:`, `lg:`, `xl:`, `2xl:`), expose each property's value _per
  breakpoint_, and add an `EditCapability` of `kind: "responsive-class"` whose
  add/replace targets the active breakpoint's prefix. Surface **override indicators**
  (which properties differ from base at this breakpoint) with a **Reset to base**
  affordance (cf. Figma's "Reset all changes").
- **Tiering:** the multi-frame overview + base/Tailwind-prefix editing works in
  **Alpine today** — inline designs already load Tailwind CDN + use `sm:/md:/lg:`,
  the device frame already sets the iframe width, and class edits already flow
  through the deterministic `replace-document-content` path (no bridge write). For
  **real apps**, the same per-breakpoint edit writes prefixed classes / media rules
  to the real source (needs the bridge write hardening, phase 5).

#### States

Design states (Default / Logged out / Empty / Loading / Error and pseudo-states) as
alternate `x-data` / DOM snapshots in `design_state`. Breakpoint and state are
**orthogonal axes** — any state can be viewed at any breakpoint.

#### Captures (real app)

`capture-design-state` snaps the running app's route + props + data into a
`design_state` row (the bridge `captureState` op is **already `available`**).

Selected **breakpoint + state** persist in application state (`breakpoint` already
in the §8 shape; add `breakpointSetId` / `activeBreakpointId`) and are agent-visible
via `view-screen`. New actions (§7): `add-breakpoint`, `remove-breakpoint`,
`set-active-breakpoint`, `reset-breakpoint-overrides`.

#### `visual-edit` skill upgrade

Today `/visual-edit` opens one URL at one size. Upgrade a screen from a single
URL+size to a **route × breakpoint matrix** — the same URL (or inline design)
rendered at Mobile/Tablet/Desktop side by side, editing only the frame that needs
fixing. Identical mechanism for inline (Alpine) and real (React) apps: same source,
N widths. Flow states (`?step=…`) and breakpoints compose as two axes.

**Acceptance:** a screen shows Mobile/Tablet/Desktop side by side with a `+` to add a
width; editing a layer in one frame writes a breakpoint-scoped class and the other
frames reflect the cascade; overridden properties show a reset-to-base control; real
apps additionally capture running state; the agent sees the selected
breakpoint/state/route via `view-screen`.

### 6.5 Accessibility & review (read-only first)

`run-design-audit` over the rendered DOM (contrast, tap targets, focus
visibility, missing names/labels, reduced-motion). The **Review** panel (matches
the review artboard) shows severity-dot findings with optional **Fix** + a visual
diff over `design_versions` (base/compare selector, changed-surface rows, before/
after). Findings navigate to the affected canvas/source node. Fix actions are
**capability-gated** (semantic code fixes are real-app only).

### 6.6 Branches, Builder & deploy

**Alpine:** version diff between two `design_versions`.
**Real app:** `connect-builder-app` / `migrate-inline-design-to-app` /
`create-design-branch` (Builder-hosted branch today via `runBuilderAgent`) /
`get-design-branch-diff` / `deploy-design-preview`, with rollback. (Our own durable
container is the later `SandboxAdapter` path.)

### 6.7 Extensions, shaders & assets

Extensions are the substrate (both tiers), inline via `DesignExtensionsPanel`.
First-party: **asset library** (selection-aware insertion — can ship early),
**shader fills**, **token auditor**, **motion presets**. **Shaders: preview-first;
`apply-shader-fill` stays disabled until runtime rendering + a real source-write
path + a generated fallback + diff proof all exist.** No permanent chrome.

---

## 7. Action surface

Actions are the shared UI/agent contract; every editable surface splits into a
cheap ephemeral **preview** and a deliberate atomic **apply**.

- **Foundation:** `get-design-surface-index` (read), `refresh-design-surface-index`,
  `list-design-source-capabilities` (read).
- **Components:** `index-components`, `get-component-details` (read),
  `preview-component-prop-edit`, `apply-component-prop-edit`, `open-component-source`.
- **Tokens:** `index-design-tokens`, `preview-design-token-edit`,
  `apply-design-token-edit`, `create-design-token`.
- **Motion:** `get-motion-timeline` (read), `preview-motion-frame`,
  `apply-motion-edit` (atomic), `remove-motion-timeline`.
- **States/captures:** `list-design-states` (read), `create-design-state`,
  `capture-design-state`, `apply-design-state`, `delete-design-state`.
- **Responsive/breakpoints:** `add-breakpoint`, `remove-breakpoint`,
  `set-active-breakpoint`, `reset-breakpoint-overrides`. Per-breakpoint style edits
  reuse `preview-component-prop-edit` / `apply-visual-edit` with an `EditCapability`
  of `kind: "responsive-class"` scoped to the active breakpoint's Tailwind prefix.
- **Review:** `run-design-audit`, `get-design-review` (read), `preview-a11y-fix`,
  `apply-a11y-fix` (gated), `create-design-review-snapshot`.
- **Builder/branch:** `connect-builder-app`, `migrate-inline-design-to-app`,
  `create-design-branch`, `get-design-branch-diff`, `deploy-design-preview`.
- **Extensions/assets/shaders:** `list-design-extensions`,
  `run-design-extension-action`, `insert-design-asset`, `preview-shader-fill`,
  `apply-shader-fill` _(stays disabled until contracts are real)_.

Every write action declares its `accessTarget` for the audit log and re-checks
source capabilities server-side.

---

## 8. Application state

Publish the exact design context so the agent sees what the user sees. `view-screen`
returns selected component/source metadata, current capabilities, selected token/
state/motion context, current panel/dock, recent audit/diff summary, and CTA
availability.

```ts
type DesignNavigationState = {
  view: "design-editor" | "design-overview" | "design-review";
  designId: string;
  sourceType: "inline" | "localhost" | "fusion"; // Builder is a flavor of fusion
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
    | "extension";
  dock?: { kind: "motion" | "review" | null; open: boolean };
  motion?: {
    timelineId?: string;
    playheadMs: number;
    selectedTrackId?: string;
    selectedKeyframeId?: string;
    previewing: boolean;
  };
  breakpoint?: "auto" | "desktop" | "tablet" | "mobile"; // active breakpoint
  breakpointSetId?: string; // the screen's side-by-side breakpoint set
  activeBreakpointId?: string; // which frame is the current edit scope
  sourceCapabilities: string[];
};
```

Wire writes through `navigate` / `view-screen` plus selection, motion-dock,
state, and review state writes.

---

## 9. Agent instructions & skills

Update `templates/design/AGENTS.md`:

- **Mode boundary** — Alpine is lightweight; full components, data states, branches,
  deploys, and deep token writes are real-app features.
- **Capability gate rule** — never claim a write unless capabilities advertise it.
- **Action map** — index/read, component, token, motion, state/capture, review,
  Builder/branch/deploy.
- **Motion rule** — preview-only scrubbing; atomic `apply-motion-edit` to commit.
- **Shader rule** — keep writes gated until runtime/write seams are real.
- **Visual rule** — preserve the minimal Figma-esque shell and the screenshot
  acceptance criteria.

Add `.agents/skills/design-studio/SKILL.md`: how to inspect capabilities, index a
surface before editing, choose Alpine vs real-app behavior, apply token/component/
motion edits safely, use review outputs, and offer Builder migration CTAs.

---

## 10. Cross-cutting

- **Four areas** — every feature touches UI + actions + skills/instructions + app
  state.
- **Preview vs apply** — cheap ephemeral preview (bridge message) vs deliberate,
  atomic, revision-checked, diffable apply. Scrub/drag/nudge previews; commit writes.
- **Security** — Builder credentials via Vault + scoped reader (never copied into
  app rows); all new tables `ownableColumns()` + access-checked; source writes only
  in capability-advertising modes behind bridge auth.
- **Reliability** — writes are single atomic actions, never per-frame loops;
  migration reports proof-of-done.

---

## 11. Rollout phases

0. **Capability gates + CTA skeleton (thin honesty layer).** Sources advertise
   capabilities; controls gate to enabled / preview-only / migration-CTA; the "Make
   it real" CTA renders wherever a control is gated. No new _feature_ yet. Cheap;
   unblocks everything. **Not blocked on bridge write-hardening** — inline writes
   already work through `replace-document-content` / `apply-tweaks`; hardening lands
   with the real-app lane (phase 5). Add screenshot visual-regression coverage of
   the editor shell + panel primitives.
1. **Tokens + CSS-keyframe Motion on inline (first user-visible win).** Tokens panel
   on the Tweaks loop; Motion dock with managed-keyframes `apply-motion-edit`. Zero
   new infra; proves "visual edit → code" at small scale. Ship the cheap half of
   responsive here too: the **multi-breakpoint preview** — render the same inline
   source at Mobile/Tablet/Desktop side by side with a `+` to add a width (the device
   frame already width-controls the iframe; this is just N iframes + a button).
2. **Components.** Light annotated Alpine components + the real-app component index +
   prop controls behind the CTA.
3. **States, responsive & captures.** Design states; the **responsive-aware
   code-layer** (per-breakpoint Tailwind-prefix editing with override / reset-to-base,
   the new `kind: "responsive-class"` edit capability) so editing one frame writes a
   scoped class; then real-app data captures.
4. **Accessibility + version diff (read-only Review panel).**
5. **Connect Builder / real-app tier.** Harden bridge writes, implement `fusion`,
   wire migration; unlock full components / tokens-as-code / branches / deploy.
6. **Shaders & plugins (gated, last).** Preview-first; apply/export only after
   runtime + source-write + fallback + diff proof.

**First user-visible milestone:** on an inline design, edit a token (live, persisted)
and add a keyframe animation that autosaves to managed CSS with a visible diff —
"visual edit becomes persisted code/CSS" without the whole real-app stack.

---

## 12. Parallel workstreams (clear ownership)

1. Capability gates + surface index (shared types, source-mode contract, index
   actions, app-state/`view-screen`).
2. UI shell + visual primitives (chrome, compact rows, swatches, segmented
   controls, severity rows, property groups, CTA rows; screenshot-matching states).
3. Components + real-app CTA.
4. Tokens (parser/indexer, panel, preview/apply).
5. Motion (timeline model, compiler/parser, dock UI, preview messages, atomic apply).
6. States/captures.
7. Review/diff/a11y.
8. Builder/branches/deploy.
9. Extensions/assets/shaders.

---

## 13. Verification

- **Unit/action:** surface index builds for inline files; capability gates disable
  unsupported writes; token parser handles CSS vars + Tailwind; motion compiler
  emits deterministic CSS and the parser reads the managed block back;
  `apply-motion-edit` is atomic + revision-checked; component index handles
  representative React/`cva`; state/capture actions persist + are app-state-visible;
  audit returns stable findings.
- **UI (screenshot-driven Playwright):** component-selected workbench, motion dock
  open, tokens panel, states panel, review panel, extensions panel, the Alpine
  real-app CTA.
- **Agent parity:** agent can inspect the selected component via `view-screen`,
  refresh the index, preview+apply a token edit where supported, add motion
  keyframes via the action path, create/select a state, run review, and navigate to
  an affected surface.
- **Real-app smoke (Builder/React fixture):** select a React component → props +
  variants → preview a prop edit → apply a safe source edit → parse tokens → apply a
  token change → capture a route state → run review → produce a branch/visual diff.
- **Responsive smoke:** a screen renders at Mobile/Tablet/Desktop side by side; a `+`
  adds a width; editing a layer in the Tablet frame writes a `md:` class while base
  (Mobile) is untouched; the Desktop frame reflects the cascade; reset-to-base clears
  the override; the same flow works on an inline design and a real-app URL.
- **Alpine smoke:** edit layout/styles; preview + persist a CSS-var token change;
  add simple keyframes that autosave to managed CSS; run a basic a11y scan; see the real-app CTA
  for full component controls.

---

## 14. Risks & mitigations

- **Split motion source of truth** — CSS is truth, JSON is metadata,
  `apply-motion-edit` updates both atomically, store `compiled_hash` + revision,
  provide rollback/diff proof.
- **Overclaiming localhost/React writes** — strict capability matrix; read-only /
  preview-only fallback; CTA when the source lacks fidelity. (`readFile` /
  `applyEdit` / `writeFile` are `planned` today.)
- **Inspector sprawl** — contextual sections inside the existing inspector; one
  bottom dock for motion/review; extension-contributed panels; no new top-level tab
  without usage proof.
- **Building-the-framework-first** — grow the Surface Index lazily; add cache tables
  only when re-parsing is a measured problem; first cheap win (Tokens) ships before
  any framework phase completes.
- **Over-investing in Alpine components** — keep them annotated regions, not a fake
  component system; they are a bridge to real apps.
- **Shader prematurity** — preview-first; apply disabled until runtime + fallback +
  source write + diff exist.
- **Component index accuracy** — static AST + config/annotation overrides first;
  Vite/Babel dev transform later; tie controls to confidence/capability metadata.
- **Performance** — cache indexes when needed; incremental rebuilds by file/source
  hash; initial scope = active route/screen; show freshness in UI + actions.
- **Container assumption** — the real-app tier is a Builder-hosted branch today, not
  our own container; the Docker `SandboxAdapter` is a later, optional path.

---

## 15. Open decisions

1. **Component indexing transport (real apps)** — Vite/Babel dev transform injecting
   `data-agent-native-*` metadata (most accurate; needs the dev server wired through
   the bridge) **[recommended]** vs. static TS/AST parse on connect (no runtime hook,
   misses runtime-only variants). _Mitigation: ship static first, add the transform
   for fidelity._
2. **Motion source format (real apps)** — managed CSS keyframes block **[recommended;
   one mental model with Alpine]** vs. a `motion`-react representation (richer
   springs, ties output to the library).
3. **Real-app hosting** — Builder-hosted branch **[recommended for v1; exists]** vs.
   our own durable container (`SandboxAdapter` Docker; not built). Affects deploy +
   data residency.
4. **Migration fidelity** — pixel-match gate vs. "good enough + agent cleanup"
   before cutover. Affects how aggressive the Connect-Builder CTA can be.
5. **Breakpoint defaults & cascade** — mobile-first base + Tailwind min-width prefixes
   **[recommended; deterministic with our output]** vs. also offering a per-design
   desktop-first / "set as primary breakpoint" flip like Figma Sites. Default frame
   widths (390 / 768 / 1280, snapped to Tailwind `md` / `lg` / `xl`) and whether to
   allow fully custom widths.

```

```
