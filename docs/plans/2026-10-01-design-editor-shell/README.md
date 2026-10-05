# Design editor shell redesign

The Design template's editor chrome, rebuilt from the Figma baseline: a
mode-aware top bar, the floating toolbar, a 56px rail with File, Agents,
Threads, and Tokens (Labs), canvas comments, version history mode,
outside-agent access, a width-agnostic responsive model, screens that come
from your running app, a Code mode, and a color picker that reaches Display P3 and OKLCH. Canvas rendering, actions, and data are
unchanged, and only step 19 changes how edits save to code; no step changes
sharing, auth, or billing writes.

## Links

- Prototype: https://claude.ai/artifact/MC9u3UmtuV3vbB865gU1kH (Builder.io
  sign-in). Built from `prototype/`; see below to change it.
- Figma: https://www.figma.com/design/oJQ7t9q4e8oHzLZKuki7k1, page
  "⏳ Design": Design Mode `1224:22121`, floating toolbar `1057:1991`,
  Toolbar section `1098:17334`, Menus section `1432:3475`, Comments section
  `1788:5948`, Navigation page rails `646:5188` and `1850:8474`.

## Working on this plan

| File | What it is |
| --- | --- |
| `README.md` | This plan: the roadmap, decisions, and open questions. |
| `requirements.json` | The source of truth: every requirement with a stable ID, a status, what the code does `today`, the `change` to make, and checked `refs` into the code. |
| `requirements.md` | The same requirements, readable on GitHub. Generated; don't edit it. |
| `prototype/source.html` | The clickable prototype. `icons.json` (Tabler paths) and `settings.json` (the Settings IA from the code) are inlined at build time. |
| `prototype/build.ts` | Writes `prototype/dist/index.html` (gitignored) and `requirements.md`. |
| `prototype/check-refs.ts` | Checks the plan: refs still point at their code, mentioned files exist, `requirements.md` is current, and the statuses agree with Decisions and Open questions. |

```bash
node docs/plans/2026-10-01-design-editor-shell/prototype/build.ts
```

```bash
node docs/plans/2026-10-01-design-editor-shell/prototype/check-refs.ts
```

**Statuses.** `context` describes the code and has nothing to build.
`proposed` is a change nobody has signed off; `question` needs a decision;
`decided` is agreed; `in-pr` and `shipped` track delivery. A ref is
`path[:line][#symbol]`: the symbol must still appear within 30 lines of the
cited line, so the checker reports where code moved instead of letting the
plan drift.

**Changing the plan.** Answering a question sets it to `decided` and adds a
dated line under Decisions naming its ID. A PR that builds a step names the IDs
it covers and, in the same change, moves them to `in-pr` (then `shipped`) and
fills the step's PR. Run both commands before committing.

**Changing the prototype.** Edit `prototype/source.html` or its data files,
build, open `prototype/dist/index.html`, and publish that file: in Claude Code,
ask it to publish `prototype/dist/index.html` as an artifact with the
prototype URL above, so the link stays the same. Without edit access to that
artifact, publishing makes a new one; put its URL here. The source lives in
this folder, not in the artifact.

**Prototype map.** `source.html` is one file: CSS first (each block starts
with a `/* name */` comment), then the markup (review strip, rail, panels,
canvas, inspector, Settings), then the script, split by `/* ───────── name
───────── */` banners; the comment at the top of the file lists them and what
each holds. The review strip across the top
holds prototype-only switches: Labs, History (mode or sheet), Scenario,
Spacing (G), Theme, and Spec (the requirements, by ID).

## Roadmap

Twenty-two steps, each one PR that's shippable alone and leaves the editor
working. Steps 2–4 can run in parallel after step 1. None has started.

### 1. Top bar shell

Not started · TOP, MOVE · PR —

Add `DesignEditorTopBar` above the canvas and inspector, and move presence,
Share, zoom, Review changes, Apply feedback, and the localhost controls into it
without changing their behavior. Move the mode switch out of
`DesignBottomToolbar`. Update `chrome-geometry.reference.ts` and
`chrome-geometry.spec.ts`.

### 2. Annotate to Labs

Not started · LAB · PR —

Add the lab, then gate the Annotate segment, Draw, and the Draw overlay on it.
Keep `annotate` in `EditorMode`.

### 3. Interact controls

Not started · TOP-04, TOP-07 · PR —

Route picker with history, the device picker (preview widths from the
breakpoint tokens, RESP-09), and the Appearance picker that replaces the
`colorScheme: "light"` pin on screen iframes, shown only in Interact. Delete
`ResponsiveInteractBar`; the breakpoint chips leave with step 18. Update `interact-toolbar-layout.spec.ts` and
`ResponsiveInteractBar.mode-exit.test.tsx`.

### 4. Floating toolbar

Not started · TOOL · PR —

Rebuild `DesignToolbarTool` as two buttons with the Figma geometry, add the
mode-aware tool sets, the Insert menu on Frame, and the Agent skills menu, and
show the toolbar in Interact. Update `mode-change.test.ts` and
`tool-state.spec.ts`.

### 5. Share and Import split buttons

Not started · TOP-09, TOP-10 · PR —

Share's chevron holds Export and Publish app; the Import dialog reuses
`DesignImportPanel`'s flows. The share popover itself is step 17. Touches the
toolkit share surface, so check every template that renders it.

### 6. Rail, App menu, Agents panel, Settings entry points

Not started · RAIL, SET · PR —

App menu on the logo with Preferences › Theme and Nudge amount…; the 56px
rail with Threads; the shared panel header; the Agents panel as chats plus the
shared composer stack (`AgentComposerFrame`), with skills from the composer's
/ menu. Update `DesignWorkspaceRail.test.tsx`.

### 7. File header

Not started · FILE · PR —

Design file menu on the name and the "Designs" ghost button. Duplicate and
Move to trash use existing design actions; check before adding any.

### 8. Layers geometry

Not started · LAYER · PR —

Remove the 24/28px overrides and replace `layerRowIndentCount` and
`LayerRowIndentSlots` with the spacer strip; change the panel width defaults
and clamps. Update `parity-layers-panel*.spec.ts` and `LayersPanel.test.ts`.

### 9. Canvas comments and the Threads panel

Not started · CMT · PR —

`CanvasCommentPins.tsx` grows into the pill and card; move `ReviewPanel` /
`ReviewCommentsPanel` out of the inspector into the Threads panel. Agent
context changes from `inspectorTab: comments` to `leftPanel: comments` plus the
open thread id (`use-navigation-state.ts`, URL param). Update
`review-panel.spec.ts` and `CanvasCommentPins.test.tsx`.

### 10. Inspector rhythm

Not started · INSP · PR —

Drop the tab row, put every section on one `InspectorGrid` template, and hide
the column outside Design. A URL screen's Source control and Screen section
go: its route, status dot, Reload, and Open in browser move to the top bar
(INSP-07, with step 1's TOP-07), and Add a screen from your app gains the
connect step (INSP-09). Update `panel-section.spec.tsx` and
`inspector-styles.spec.ts`.

### 11. View options in the zoom menu

Not started · VIEW · PR —

Wire the zoom menu's toggles to real state, persisted per user. Snapping's
toggle goes through `CanvasSnapOptions.bypass`.

### 12. Keyboard shortcuts window

Not started · KEYS · PR —

Replace the bottom drawer with the Dialog. New copy: "Search", the no-match
line, and the Minimal UI label. Update `KeyboardShortcutsPanel.test.tsx` and
its discoverability test.

### 13. Context menus

Not started · MENU · PR —

Rebuild `CanvasContextMenu.tsx` and the `LayersPanel.tsx` row menu on the
Figma Menus section, using the existing commands and shortcuts. Update
`CanvasContextMenu.test.tsx` and `select-layer-context-menu.spec.ts`.

### 14. Version history mode

Not started · HIST · PR —

The canvas renders the selected version read-only from `get-design-version`;
restore keeps `restore-design-version`'s behavior (saves "Before restore",
blocked while a collaborator is active). Named versions need an additive
nullable created-by column on `design_versions`.

### 15. Tokens panel (Labs)

Not started · TOK · PR —

Move `TokensPanel.tsx` from the build switch to the lab and rebuild it on the
shared row strip with the kind menu, the Import menu, and region-aware ⌘F. Uses
the existing token actions plus an explicit `type` on add and a `figma` source
on `import-design-tokens`.

### 16. DTCG token storage

Not started · TOK-15, TOK-16 · PR —

Keep one DTCG document per design system and per design (overrides) inside
the existing `data` JSON, so the schema change stays additive; read the old
`tweakSelections` and `BrandKitToken[]` shapes and convert on write.
`import-design-tokens` accepts `.tokens` / `.tokens.json`
(`application/design-tokens+json`). Touches `packages/core` brand-kit types,
so it needs a changeset.

### 17. Outside agents

Not started · AGT · PR —

Copy link, the share popover's People and Agents tabs, Send to ›,
and the URL-taking MCP tools. Opening a scoped link selects and zooms to its
layers.

### 18. Responsive layout

Not started · RESP · PR —

Start with a spike on one code-backed (React) screen to confirm container-query
rules round-trip to source before building the UI. Then: the frame width
handle and width presets; the inspector's Responsive section, written through
a new `apply-visual-edit` intent that emits token-based `@max-*` / `max-*`
classes and the parent's `@container`; Make responsive as an agent skill that
checks the frame at each viewport; the migration in RESP-10; and the rewritten
`responsive-breakpoints` skill. The Tailwind check is done (RESP-03).

### 19. Save to code

Not started · SAVE · PR —

The one behavior change in the plan, so it ships alone and after step 10 and
INSP-07: HTML routes save each edit as you make them like React routes do, and
Apply to source goes. The dot and the route control show unsaved edits, Screens
marks each screen that has them, and Review changes saves what it safely can
and replays edits onto files that changed on disk instead of overwriting them. Cover the app-down,
no-consent, and changed-on-disk cases with tests before the UI.

### 20. Code mode

Not started · CODE · PR —

Move the existing code workbench out from behind `SHOW_DESIGN_CODE_LEFT_PANEL`
and behind a `design.code` Labs flag, as a third top-bar mode, restyled to the app's density, with the file tree
in the File panel and Go to file in the top bar. The unsaved-edit marks
(CODE-04) land with or after step 19.

### 21. Color picker

Not started · COLOR · PR —

Redesign `DesignColorPicker` in place at 272px on the 8pt grid: Previous and
New swatches, one Mode property (Hex, RGB, HSL, HSB, Display P3, OKLCH) that
changes only the numbers and the CSS written, the same square in every mode,
fallbacks named in New's tooltip, and a Libraries tab of tokens. The
inspector's fills and strokes and the Tokens panel (TOK-20) use it.

### 22. Token collections and modes

Not started · TOK-21 to TOK-27 · PR —

Fix the scanner first, as its own PR (TOK-25): `extractCssVars` flattens
selectors, so `.dark` values overwrite `:root` ones today. Then, on the DTCG
storage from step 16: collections as tiers (Primitives, Semantic, Components)
with aliases that point down a tier, modes per collection, and a Modes
section on screens that drives the canvas, with Auto following Interact's
Appearance. Export and import use the DTCG Resolver module, and the agent
gets the same actions. Builds on steps 15, 16, and 21.

### Every step

A step that touches copy updates `app/i18n/en-US.ts` and the 11 locale files
and runs `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy`. Mode or
tool changes keep `use-navigation-state.ts` and
`publish-agent-selection-context.ts` in sync so the agent still sees the
current mode, tool, and panel; update the Design template's agent skill text
where it names Annotate or the old toolbar.

## Decisions

- 2026-10-01: Annotate moves behind a Labs flag; the floating toolbar follows Figma `1057:1991`, which supersedes `1282:26781`. LAB-01, TOOL-01, TOOL-04, TOOL-05.
- 2026-10-01: The top bar is mode-driven, with 24px controls and 12/16 text. TOP-01, TOP-02, TOP-03, TOP-05, TOP-06, TOP-08.
- 2026-10-01: Import and Share become split buttons and the Play popover goes; the file name opens the file menu with a "Designs" ghost button under it; Move to folder stays hidden; the logo opens the App menu; the account control is the avatar. TOP-09, TOP-10, MOVE-04, FILE-01, FILE-02, FILE-03, RAIL-04, RAIL-10, MENU-01, MENU-02.
- 2026-10-01: Comments move off the inspector onto the canvas, with a finder panel in the rail; the inspector loses its tabs and hides outside Design. CMT-01, CMT-02, CMT-08, INSP-01, INSP-04, RAIL-03.
- 2026-10-01: Context menus follow the Figma Menus section; the shortcuts window is a modal with search above the categories. MENU-03, MENU-04, MENU-05, KEYS-01, KEYS-03.
- 2026-10-01: Layers use 32px rows and 40px headers on one spacer strip. LAYER-01.
- 2026-10-02: Tokens ships under a Labs flag and stores DTCG; + adds by kind; Import is a menu, never a modal; Generate from design is an agent skill; the panel header matches the other panels. TOK-02, TOK-05, TOK-07, TOK-10, TOK-12, TOK-15.
- 2026-10-02: The rail is 56px with Figma's rail button; the comments item is "Threads"; agents use `sparkles`, not a robot. RAIL-01, RAIL-02, RAIL-14.
- 2026-10-02: Left panels default to 240px (232–416px in 8px steps) and share one header; Threads uses `ReviewCommentsPanel`'s search and filters. LAYER-02, RAIL-11, RAIL-12.
- 2026-10-02: The Agents panel is chats plus the composer, with skills from /, a way back to the chat list, and sort and filter. RAIL-05, RAIL-06, RAIL-07, RAIL-13.
- 2026-10-02: Share is a fixed-size People / Agents popover; Send to › joins the context menus; ⌘F searches the region you're in; agent menu rows are plain. AGT-03, AGT-05, TOK-13, MENU-06.
- 2026-10-02: Zoom ends 8px before the inspector's left edge. TOP-11.
- 2026-10-02: Theme and Nudge amount live in App menu › Preferences, not Settings. SET-05.
- 2026-10-02: The Frame tool's presets use Shawn's list: seven icon groups (Phone, Tablet, Desktop, Presentation, Smartwatch, Paper, Social media), current devices, paper in points, no Ad unit. INSP-05, INSP-06.
- 2026-10-02: Position's device sizes open the Frame tool's preset list. INSP-08.
- 2026-10-02: URL screens stay connected to your code. Their route and a status dot sit in the top bar's center in Interact and Design, with the host only in the tooltip; the route menu only picks the route, and Reload screen and Open in browser sit beside it. The inspector's Screen section and Detach from app go: ⌘D duplicates a screen, and switching between static and live is the agent's job. Device sizes stay in the inspector, since in Design they resize the frame. INSP-07, TOP-07, MOVE-03.
- 2026-10-02: One Copy link everywhere: after Send to › on canvas menus and after Copy on layer rows, linking what you right-clicked, with the toast naming it. AGT-02.
- 2026-10-02: Code mode ships behind its own Labs flag, `design.code`, like Tokens. CODE-05.
- 2026-10-02: Responsive design drops the breakpoint mode. A frame is a frame with width presets from tokens; responsive rules live on layers and compile to container queries with token thresholds; the agent writes them; fixed widths are only viewports to check. RESP-04, RESP-05, RESP-06, RESP-07, RESP-08, RESP-09.
- 2026-10-05: Menus are text, following the macOS HIG: no leading icons, and an ellipsis only on rows that open a dialog or a file panel. Menus keep the shadcn structure at the editor's density from `CanvasContextMenu.tsx` (28px rows of 12px text); the Share popover uses the toolkit's Popover. A bound token's Detach token is the first row of its menu, on ⌫. MENU-09, RESP-05.
- 2026-10-05: Token rows drop the source badge: the tooltip names the file, and a mark appears only when files disagree on a value. TOK-19.
- 2026-10-05: The color picker's eyedropper is an app-owned icon on Tabler's grid, since Tabler's only pipette reads as a pen. COLOR-06.
- 2026-10-05: The color picker sits on the 8pt grid (272px, columns 64 · 64 · 64 · 32), and slider knobs stay inside their tracks, filled with their value. COLOR-09.

## Open questions

- **KEYS-09** Keep “Minimal UI” as the label for `toggle-minimal-ui`?
- **HIST-09** Version history as a mode, or today's sheet?
- **TOK-11** Download tokens (DTCG) in Share › Export, or a panel export?
- **TOK-17** Keep the Opacity token kind? (Container and Breakpoint stay for RESP-05.)
- **RAIL-15** Keep the Agents panel's 320px minimum width?
- **AGT-09** When the engineer's org can't see the design, offer to widen access or only say who can open it?
- **AGT-10** Rename MCP server settings to Connect AI apps…?
- **RESP-13** Desktop-first `max-*` output, or flip the base so it's mobile-first?
- **RESP-14** Keep side-by-side frames at other widths, or rely on drag plus Interact viewports?
- **RESP-15** Responsive rules on any layer, or only on components?
- **TOK-28** Add a wide table with a column per mode, or is the panel's mode select enough?
- **TOK-29** Keep the panel header's + (adds to Semantic), or only each collection's own +?
- **SAVE-05** When a file changed on disk, is Reapply my changes enough, or also offer Overwrite the file and Discard my changes?
