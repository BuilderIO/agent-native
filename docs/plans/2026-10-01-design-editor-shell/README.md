# Design editor shell redesign

The Design template's editor chrome, rebuilt from the Figma baseline: a
mode-aware top bar, the floating toolbar, a 56px rail with File, Agents,
Threads, and Tokens (Labs), canvas comments, version history mode, and
outside-agent access. Canvas rendering, actions, and data are unchanged, and
no step changes saving, sharing, auth, or billing writes.

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

Seventeen steps, each one PR that's shippable alone and leaves the editor
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

Route picker with history, the device picker, and the Appearance picker that
replaces the `colorScheme: "light"` pin on screen iframes, shown only in
Interact. Move `BreakpointDeviceControl` out of the inspector and delete
`ResponsiveInteractBar`. Update `interact-toolbar-layout.spec.ts` and
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
the column outside Design. Update `panel-section.spec.tsx` and
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

Copy link to selection, the share popover's People and Agents tabs, Send to ›,
and the URL-taking MCP tools. Opening a scoped link selects and zooms to its
layers.

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

## Open questions

- **KEYS-09** Keep “Minimal UI” as the label for `toggle-minimal-ui`?
- **HIST-09** Version history as a mode, or today's sheet?
- **TOK-11** Download tokens (DTCG) in Share › Export, or a panel export?
- **TOK-17** Keep the Container, Breakpoint, and Opacity token kinds?
- **RAIL-15** Keep the Agents panel's 320px minimum width?
- **AGT-09** When the engineer's org can't see the design, offer to widen access or only say who can open it?
- **AGT-10** Rename MCP server settings to Connect AI apps…?
