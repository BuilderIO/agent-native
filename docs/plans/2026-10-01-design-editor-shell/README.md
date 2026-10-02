# Design editor shell redesign

The Design template's editor chrome, rebuilt from the Figma baseline: a
mode-aware top bar, the floating toolbar, a 56px rail with File, Agents,
Threads, and Tokens (Labs), canvas comments, version history mode, and
outside-agent access. Canvas rendering, actions, and data are unchanged, and
no step changes saving, sharing, auth, or billing writes.

## Working on this plan

| File | What it is |
| --- | --- |
| `README.md` | This plan: the roadmap with each step's status, decisions, and open questions. |
| `requirements.json` | Every requirement, with a stable ID, a status, and the steps that build it. The source of truth; the prototype's Spec drawer renders it. |
| `prototype/source.html` | The clickable prototype. `icons.json` (Tabler paths) and `settings.json` (the Settings IA from the code) are inlined at build time. |
| `prototype/build.ts` | `node docs/plans/2026-10-01-design-editor-shell/prototype/build.ts` writes `prototype/dist/index.html` (gitignored). |
| `prototype/check-refs.ts` | `node docs/plans/2026-10-01-design-editor-shell/prototype/check-refs.ts` checks that every file and `file:line` reference still exists. Exit 1 lists the stale ones. |

To keep prototyping: edit `prototype/source.html` (or the data files), run
`build.ts`, open `prototype/dist/index.html`, and publish that file. In Claude
Code, ask it to publish `prototype/dist/index.html` as an artifact, passing
the plan's artifact URL (in the PR description) so the link stays the same;
without edit access to that artifact, publishing makes a new one. The source
lives here, not in the artifact, so every change goes through this folder and
its git history.

Requirement statuses: `exists` describes what the code does today (with
`file:line`), `new` is net-new work, `question` needs a decision, `decided`
records an answered question, `in-pr` and `shipped` track delivery. A PR that
builds a step names the requirement IDs it covers and updates their status and
the step's row below in the same change. Answering a question moves it to
`decided` and adds a dated line under Decisions.

Figma baseline (page "⏳ Design"): "Design Mode" `1224:22121`, floating toolbar
`1057:1991`, Toolbar section `1098:17334`, Menus section `1432:3475`, Comments
section `1788:5948`. The Figma file and the published prototype are internal
links; they're in the PR description.

## Roadmap

| Step | Change | Status | Requirements | PR |
| --- | --- | --- | --- | --- |
| 1 | Top bar shell | Not started | TOP, MOVE | — |
| 2 | Annotate to Labs | Not started | LAB | — |
| 3 | Interact controls | Not started | TOP | — |
| 4 | Floating toolbar | Not started | TOOL | — |
| 5 | Share and Import split buttons | Not started | TOP | — |
| 6 | Rail, App menu, Agents panel | Not started | RAIL, SET | — |
| 7 | File header | Not started | FILE | — |
| 8 | Layers geometry | Not started | LAYER | — |
| 9 | Canvas comments + Comments panel | Not started | CMT | — |
| 10 | Inspector rhythm | Not started | INSP | — |
| 11 | View options in the zoom menu | Not started | VIEW | — |
| 12 | Keyboard shortcuts window | Not started | KEYS | — |
| 13 | Context menus | Not started | MENU | — |
| 14 | Version history mode | Not started | HIST | — |
| 15 | Tokens panel (Labs) | Not started | TOK | — |
| 16 | DTCG token storage | Not started | TOK | — |
| 17 | Outside agents read a design from its link | Not started | AGT | — |

## Decisions

- 2026-10-01: Annotate moves behind a Labs flag. The floating toolbar follows Figma `1057:1991` (Move, Frame, Pen, Comment, Agent), which supersedes `1282:26781`.
- 2026-10-01: The top bar is mode-driven: route, device, and Appearance only in Interact; zoom stays put across modes. Top-bar controls are 24px with 12/16 text.
- 2026-10-01: Comments move off the inspector: threads open on the canvas as the Figma card and collapse to avatar pills; the left panel is a finder. The inspector has no tabs and hides outside Design.
- 2026-10-01: Context menus follow Figma `1834:719` and `1826:562`, with shortcuts from `DESIGN_SHORTCUTS`. Keyboard shortcuts get a real modal with search above the categories.
- 2026-10-01: Version history is proposed as a mode (timeline in the inspector, read-only canvas, Restore and Done); the sheet stays available for comparison.
- 2026-10-02: Tokens ships under a Labs flag and stores DTCG 2025.10. + adds a token by kind into its group; Import is a menu (Paste Figma link, DTCG file, CSS or Tailwind file, Code folder, Paste from clipboard, Generate from design), never a modal; Generate from design is an agent skill.
- 2026-10-02: The rail is 56px with Figma's rail button (label under the icon, tooltip to the right after 500ms, active click collapses the panel); the comments item is “Threads”; agents use Tabler `sparkles`, not the robot.
- 2026-10-02: Left panels default to 240px and resize 232–416px in 8px steps. Every panel header is a label, then Search (swaps in a focused field; click-away, ×, and Esc dismiss and clear it), Filter (Tabler `filter-2`), and +. Only the File panel keeps the hide-panel button.
- 2026-10-02: The Agents panel drops its Skills section: skills start from / in the composer through the toolkit `MentionPopover`. A chat has a back button and All chats; chats sort by date or unread and filter by pinned or archived.
- 2026-10-02: Share is the toolkit popover with People and Agents tabs at one fixed size. Send to › in the context menus lists agents, workspace apps, and channels, and Share › Agents reads the same list. ⌘F searches the region you last worked in.
- 2026-10-02: Zoom ends 8px before the inspector's left edge; avatars, Import, and Share sit over the inspector.
- 2026-10-02: Theme is App menu › Preferences › Theme (Light, Dark, System theme), not a Settings page; Preferences also gets Nudge amount…. Settings itself mirrors the code's `SettingsShell`.

## Open questions

- **KEYS-09** Label for toggle-minimal-ui in the shortcuts window: keep “Minimal UI”?
- **HIST-09** Version history as a mode (the proposal) or today's HistoryPanel sheet? The prototype has both (review strip › History).
- **TOK-12** Export: the prototype puts Download tokens (DTCG) in Share › Export with the other downloads, shown while the Tokens lab is on. Keep it there, or give the panel its own export?
- **TOK-18** Keep the Container, Breakpoint, and Opacity token kinds in the + menu, or trim it to the types the code has (color, typography, spacing, radius, shadow, motion, other)?
- **RAIL-15** Should the Agents panel keep the code's 320px minimum width (DesignEditor.tsx:26516, AgentChatSurface) when every other left panel starts at 232px?
- **AGT-09** If the design isn't visible to the engineer's org, should the tab offer to switch General access to Anyone in the org can view, or only say who can open it?
- **AGT-10** Rename Share › Agents › MCP server settings to Connect AI apps…, so the row says what the person gets rather than the mechanism?

## What changes

| Area | Today | New |
| --- | --- | --- |
| Top bar | None. `rightSidebarActions` (`DesignEditor.tsx:26311-26484`) sits at the top of the inspector rail in three rows: presence, Review changes, Apply feedback, Play popover, Share; the localhost link and Apply to source; zoom. Device lives in the inspector Screen section (`:25641`). Interact has its own `ResponsiveInteractBar`. | One 48px bar over canvas + inspector whose contents follow the mode. Design: Interact \| Design (\| Annotate with the Labs flag), zoom, then Review changes when pending, presence, Import and Share split buttons. Interact adds back / forward, the route picker, and reload in the centre, and the device and Appearance pickers on the left after the mode switch. The bar is a 1fr / auto / 1fr grid so the route is centred; below 1200px it falls back to the route filling the middle and presence hiding. Under test: every control at 24px with 12/16 text (toolkit Button `xs`; toolkit Select has only `sm` 32 and default 36, so it needs an `xs` size). Zoom keeps its position and value in both modes. In Design the Screens panel picks the screen. `ResponsiveInteractBar` retires. |
| Modes | `EditorMode = annotate \| edit \| interact`, switched by tabs at the end of `DesignBottomToolbar` (`:372-461`). | Annotate moves behind a Labs flag in `shared/labs.ts`, read with `useLab` like `DESIGN_REVIEW_TOOLS_LAB`. Off: Interact and Design, no Draw. On: the Annotate segment, Draw in the Pen menu, and today's Draw overlay. |
| Floating toolbar | Move, Frame, Shape, Pen, Text, Comment pin, mode tabs. Hidden in Interact. `DesignToolbarTool` gives the tool and chevron one shared hover. | Figma `1057:1991` in the Toolbar section `1098:17334`, 252×48: Move▾, Frame▾, Pen▾, Comment, Agent▾. Interact: Interact, Comment, Agent▾. Text and every shape fold into Frame's Insert menu (Frame, Text, Screen, Image/video, then Rectangle, Line, Arrow, Ellipse, Polygon, Star). Pen menu: Pen, plus Draw with Labs: Annotate (with the lab off, Pen keeps a one-item menu so the bar stays 252px). Agent's button opens the Agents panel with the composer focused; its chevron opens the skills menu (Inspiration, Debug, Polish). True split buttons: 32×32 tool, 1px gap, 16×32 chevron, separate hover per half, chevron filled while open. Pinned 8px above the canvas viewport's bottom edge, not the end of the content (today `bottom: 16`, `DesignBottomToolbar.tsx:406`), with 64px of bottom scroll room on the canvas. |
| Share / Import | `ShareButton` from `@agent-native/toolkit/app/sharing` with tabs Share link, Export, Send to agent, Live collaboration. Import is a rail panel (`DesignImportPanel`). | Split buttons. Share opens the toolkit share dialog; its chevron holds Export (Download HTML, PNG, SVG, Figma SVG, ZIP, PDF, Copy agent prompt) and Publish app. Import opens the Import dialog; its chevron jumps to one source. |
| Displaced controls | See the Top bar row. | Apply feedback → top of the Comments panel. Review changes → top bar right zone. Localhost link → Interact's route picker; Apply to source → beside zoom in Design. Play: Design Preview is Interact now; Publish app waitlist → Share's chevron. |
| Left rail | 64px wide (`--design-chrome-rail-width`, `global.css:187`). Logo opens the project menu; File, Agent (chat surface), Import (+ flagged Assets/Tools/Tokens/Code). | 56px wide (Figma's width). Each item is Figma's rail button: full width, a 20px icon in a 32px box, the 11/16 label under it truncating, the full name in a tooltip to the right after 500ms, and `aria-expanded` because clicking the active item collapses its panel (the code already does this). Footer stays 16px. The comments item is labeled “Threads” (fits at 11px; “Comments” truncated). Logo opens the App menu (Actions… ⌘K, File, Edit, View, Preferences, Help). File, Agents, Threads on top. Agents shows Recent chats with the composer pinned; skills start from / in the composer (the toolkit `MentionPopover` skill list inserting a `skillReference` chip), not a panel section. Only the File panel header keeps the hide-panel button; the others collapse from their rail item or ⌘\\. Every panel header is a label, then Search (swaps in a focused field; clicking away, ×, or Esc dismisses and clears it), Filter, and +. Agents search covers chats (core `searchThreads`), sorted by date (core order) or unread (new: needs a per-thread last-read time), filtered by Pinned only / Show archived chats. Comments is the finder: threads grouped by screen, each opening on the canvas, with `ReviewCommentsPanel`'s search and Filter comments menu (Show resolved, Only your threads, Unread, Only current page, sort, Mark all as read); the rail icon carries the open count. Threads themselves render on the canvas as pills that open into the Figma comment card. Import leaves the rail; the footer speech-bubble icon goes away. The footer account control is the toolkit `AccountMenu` / `OrgSwitcher` compact trigger, a 24px avatar (Figma shows a briefcase; follow the code). Its menu opens above the avatar, start-aligned, 6px away (`side="top" align="start" sideOffset={6}`): email, organizations, invitations, Create organization, Settings, Usage, Log out (no Get apps and extensions: Design passes no `utilityLinks`). |
| File header | Click-to-rename title (`:25858`) + minimal-UI toggle. Project menu (`:25652`) holds Back to designs, Save as template, Version history, Export, Edit, View. | File name opens the Design file menu (Rename, Duplicate, Version history, Save as template…, Export…, Move to trash; Move to folder… stays hidden until designs have folders). Under it, a "Designs" ghost button (no arrow, label flush with the name) goes to `/home`. |
| Screens + layers | `LayersPanel.tsx:1308` overrides rows to 24px and headers to 28px; indent is a 12px slot per level with a 20px caret slot (`:305`, `:1637`). | 32px rows, 40px headers. One strip: 16px inset, 24px spacer per depth, 16px disclosure slot (empty on leaves), 8px, 16px icon, 8px, name, then trailing meta 8px after it. Content ends 16px from the right edge too; header icon buttons (22px around a 12px glyph) sit 11px in so the glyph lands on that 16px line. The Agents panel uses the same rows. |
| Inspector | Tabs Design / Comments / Tweaks or Code (`EditPanel.tsx:1470`); the Comments tab renders `ReviewPanel` / `ReviewCommentsPanel` (`:3189`, `:3251`), and placing a pin switches to it (`DesignEditor.tsx:18183`). Empty outside edit mode. | No tab row: properties only, starting at the selection header. Hidden in Interact and Annotate. Every section: 40px header, body on the 88/8/88/8/32 grid, 8px between rows, 12px after the last. Field = 12px label, 4px, 24px control. Empty sections drop the chevron and keep its space. |

## PR sequence

Each PR is shippable alone and leaves the editor working. 2–4 can run in
parallel after 1.

1. **Top bar shell.** Add `DesignEditorTopBar` above canvas + inspector. Move
   presence, Share, zoom, Review changes, and the localhost controls into it
   without changing their behavior. Move the mode switch out of
   `DesignBottomToolbar`. Update `chrome-geometry.reference.ts` and
   `chrome-geometry.spec.ts`.
2. **Annotate to Labs.** Add the lab, gate the Annotate segment, Draw, and the
   Draw overlay on it. Keep `annotate` in `EditorMode`.
3. **Interact controls.** Route picker with history, the device picker, and
   a new Appearance picker (Light / Dark / System) that replaces the
   hard-coded `colorScheme: "light"` on screen iframes (`DesignCanvas.tsx:7323`,
   `MultiScreenCanvas.tsx:12205`), shown only in Interact; localhost URL inside the route picker. Move `BreakpointDeviceControl`
   out of the inspector; delete `ResponsiveInteractBar`. Update
   `interact-toolbar-layout.spec.ts` and `ResponsiveInteractBar.mode-exit.test.tsx`.
4. **Floating toolbar.** Rebuild `DesignToolbarTool` as two buttons with the
   Figma geometry; mode-aware tool sets; Insert menu on Frame; Agent skills
   menu. Show it in Interact. Update `mode-change.test.ts`, `tool-state.spec.ts`.
5. **Share and Import split buttons.** Share's main button opens the toolkit
   share dialog; move Export and Publish app into its chevron. Import dialog
   reuses `DesignImportPanel`'s flows. Touches the toolkit share dialog's tabs,
   so check every other template that renders it.
6. **Rail, App menu, Agents panel.** App menu on the logo; Agents panel with
   skills, recent chats, and the shared composer stack (`AgentComposerFrame`);
   skills start runs through the existing agent chat. Update
   `DesignWorkspaceRail.test.tsx`.
7. **File header.** Design file menu on the name, "Designs" ghost button, label flush with the name.
   Duplicate and Move to trash use existing design actions; check before adding
   any.
8. **Layers geometry.** Remove the 24/28px overrides, replace
   `layerRowIndentCount` and `LayerRowIndentSlots` with the spacer strip.
   Keep the panel resizable from its right edge, snapping to the 8pt grid:
   240px default, 232px minimum (the first grid width at or above the 227px
   Figma spec; today `useState(280)` at `DesignEditor.tsx:2273` and a 220px
   floor at `:26513`), 416px maximum (today 420). Update
   `parity-layers-panel*.spec.ts`, `LayersPanel.test.ts`.
9. **Canvas comments + Comments panel.** Threads open on the canvas next to
   their element as the Figma card (`1205:2267`): title bar with ⋯ (Agent menu:
   Suggest changes, Reply in thread, Apply changes and resolve), Resolve, Close;
   messages with Agent badges and brand marks for agents (badge spec from `1205:2713`; that card itself is Clips-only); a reply
   box that expands with emoji, @ and image, and an @ picker of people and
   agents (`1259:23236`). Collapsed, a thread is an avatar pill on the element.
   Mentioning an agent starts a run that answers in the thread. The Comments
   rail panel becomes the finder (Open / Resolved / All by screen) and opens
   threads on the canvas. Move `ReviewPanel` / `ReviewCommentsPanel` out of the
   inspector; today's `CanvasCommentPins.tsx` grows into the pill + card. Agent
   context changes from `inspectorTab: comments` to `leftPanel: comments` plus
   the open thread id (`use-navigation-state.ts`, URL param). Update
   `review-panel.spec.ts`, `CanvasCommentPins.test.tsx`.
10. **Inspector rhythm.** Drop the tab row; one section template on
   `InspectorGrid`; hide the column outside Design. Update `panel-section.spec.tsx`,
   `inspector-styles.spec.ts`.

11. **View options in the zoom menu.** Wire the Figma zoom menu's toggles to
    real state, persisted per user:
    - Pixel grid: today it draws only on the overview canvas, automatically
      from 800% (`shouldShowPixelGrid`, `canvas-math.ts:525`;
      `MultiScreenCanvas.tsx:10262`). Add the toggle (on by default) and draw
      it on the single-screen canvas (`DesignCanvas.tsx`) too.
    - Snap to pixel grid: smart snapping exists (`computeDragSnap`,
      `computeMoveSnap`, `computeSpacingSnap`, `computeResizeSnap`; whole-pixel
      results via `WHOLE_PIXEL_SNAP_STEP`; ⌘/Ctrl bypasses per drag). Add the
      on/off toggle through `CanvasSnapOptions.bypass`.
    - Layout grids ⌃G: exists (`LayoutGridProperties`,
      `handleToggleLayoutGrids`, `DesignEditor.tsx:5279`). Use the code's name,
      not Figma's “Layout guidelines”.
    - Rulers: new UI on top of `getRulerTicks` (`canvas-math.ts:514`); off by
      default until it ships.
    - Multiplayer cursors: `LiveCursorOverlay` is always on; add the toggle.
    - Comments ⇧C: exists.

12. **Keyboard shortcuts window.** Replace the bottom drawer
    (`KeyboardShortcutsPanel.tsx:263`, 241px tall, which also lifts the
    floating toolbar via `DesignBottomToolbar.tsx:406`) with a shadcn Dialog:
    760×640, shadcn Dialog header (title + close). A 200px left column holds
    search (names only, highlighted matches, focus on open, × to clear; Esc
    clears, then closes) above a category rail over
    `DESIGN_SHORTCUT_CATEGORIES` with scroll-spy, and one list with sticky
    headings built from `DESIGN_SHORTCUTS` + `formatShortcutKeycaps`. Nudge
    amount moves into the Cursor section. Entry points: ⌃⇧? and App menu ›
    Help / Preferences › Keyboard shortcuts. New copy: “Search”, the
    no-match line, and a “Minimal UI” label for `toggle-minimal-ui` (today it
    reuses “Show/Hide UI”, `keyboard-shortcuts.ts:153`). Update
    `KeyboardShortcutsPanel.test.tsx` and `.discoverability.test.ts`.

13. **Context menus.** Rebuild `CanvasContextMenu.tsx` and the
    `LayersPanel.tsx` row menu on the Figma Menus section (`1432:3475`):
    per-selection menus from “Contextual action coverage” (`1834:719`: single
    layer, multiple layers, component instance), plus “No selection” and the
    layer row from `1826:562`. Edit with Agent… leads every selection menu and
    opens the composer; its submenu is the Agent actions list (Inspiration,
    Polish, Debug, Generate states, Make responsive). Arrange › and Transform ›
    use the existing commands and shortcuts. Boolean operations › offers only
    Subtract (⌥⇧S) for now. Preferences becomes Theme › (Light,
    Dark, System theme; `next-themes` `setTheme`, today only the command
    menu's Toggle theme) + Keyboard shortcuts + Nudge amount… (a dialog for
    the same `editor-preferences.ts` small/big nudge the shortcuts window
    edits) (`1693:1330`, with Theme in place of Appearance…); the composer + uses the MVP Add context
    menu (`2261:2104`). Update `CanvasContextMenu.test.tsx` and
    `select-layer-context-menu.spec.ts`.

14. **Version history mode.** Replace the `HistoryPanel` Sheet with a mode:
    the inspector column becomes a timeline (Current version, collapsed
    autosave runs, named versions and restores as nodes), the canvas renders
    the selected version read-only from `get-design-version`, and the top bar
    shows Viewing · Restore this version · Done. Restore keeps today's
    `restore-design-version` behavior (saves “Before restore”, blocked while a
    collaborator is active). Named versions with title, description, and
    author need an additive nullable created-by column on `design_versions`
    and a label/description path in `create-design-version`.

15. **Tokens panel (Labs).** Move `TokensPanel.tsx` from the build-time
    `VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS` switch to a `design.tokens` lab
    (`defineLab` in `shared/labs.ts`, `useLab` for the rail item, listed in
    Settings › Labs). Assets, Tools, and Code keep the build switch. Rebuilt on
    the shared 16px row strip: groups by type, swatch or glyph, name, value,
    source on hover, inline edit (Enter / Esc), the system color picker on the
    swatch. The header is the token count, then Search, Import, and +
    (Refresh goes away); Search swaps in for the header line as a focused
    field, like the code's Layers search. ⌘F becomes region-aware: `onFind`
    asks the focused panel for a `focusSearch` handle (Tokens) and falls back
    to today's `handleFindLayers`; it stays native in text fields. The
    header splits today's one create popover into two actions:
    - **+ Add token** is a Nova menu of token kinds in the panel's group
      order (Color · Font family, weight, size, line height, letter spacing ·
      Spacing, Container, Breakpoint, Radius · Shadow, Opacity). A kind adds
      an inline draft row at the end of its group with the kind's prefix
      (`--font-size-`) and a starting value (`16px`); you type the name,
      Enter moves to the value, Enter or clicking away saves, Esc cancels.
      The token stores the chosen type instead of `classifyVar` guessing it
      from the name and value, which is why today's form (default `#000000`)
      reads as color-only. New: Container, Breakpoint, and Opacity kinds;
      Spacing becomes “Spacing & Layout”; Opacity lands in Shadows & Effects.
    - **Import** is a Nova menu like +, each item importing straight away
      with a toast of what changed: Paste Figma link, DTCG file…, CSS or Tailwind file…,
      Code folder…, Paste from clipboard, then Generate from design. It replaces Import a set from text / from a file / from a
      folder; the same `import-design-tokens` parser runs underneath.
    - **Paste Figma link** reads the link copied in Figma from the
      clipboard (no field) and reads the file over Figma REST with the workspace's Figma connection:
      styles on every plan, variables on Enterprise. New `figma` source on
      `import-design-tokens`. Figma's MCP accepts approved clients only, so
      the MCP route is the Paper one: an external agent connects to Figma's
      MCP and Design's MCP server and calls `import-design-tokens`.
    - **Generate from design** (the Import menu and the empty state)
      starts a `generate-tokens` agent skill: it reads the screens, names
      tokens by role, merges near-duplicates, and proposes the set for
      Apply in the chat. It replaces Import from current design (the
      regex extraction becomes the skill's first step).
    - Export moves to Share › Export as Download tokens (DTCG), shown while
      the lab is on.
    Uses the existing token actions, plus an explicit `type` on add;
    localize its raw literals.

16. **DTCG token storage.** Make DTCG (Design Tokens Format Module 2025.10)
    the stored format. Today a design's tokens are CSS custom properties in
    each screen's `:root`, edits and imports land in
    `designs.data.tweakSelections` (a flat `{ "--var": value }` map shared
    with Tweaks), and brand kits keep a custom `BrandKitToken[]` plus fixed
    fields in `design_systems.data` (`packages/core/src/brand-kit/types.ts`).
    Proposal: keep one DTCG document per design system and per design
    (overrides), inside the existing `data` JSON so the schema change stays
    additive; groups, `$value`, `$type`, `$description`, `{alias}`
    references, colors as `{ colorSpace, components, alpha, hex }`,
    dimensions as `{ value, unit }` (px or rem), and Agent-Native data
    (source, CSS variable name) under `$extensions`. CSS variables become
    derived output (`color.primary` → `--color-primary`). Read the old
    `tweakSelections` and `BrandKitToken[]` shapes and convert on write.
    `import-design-tokens` accepts `.tokens` / `.tokens.json`
    (`application/design-tokens+json`) and detects DTCG JSON in pasted text
    and files: group `$type` inheritance, `{alias}` and `$ref` resolution,
    and typed values converted to CSS (hex plus alpha, px/rem, ms, font
    stacks, cubic-bézier, shadows). Export and re-import must round-trip
    with no changes. Add the DTCG export to Share › Export (Download tokens
    (DTCG)) and the handoff actions. Touches `packages/core` brand-kit types,
    so it needs a changeset.

17. **Outside agents read a design from its link.** Every Agent-Native app
    already mounts a remote MCP server at `/mcp` (OAuth 2.1, calls run as
    the signed-in user under the design's sharing rules); Paper's model with
    a hosted server instead of a local one.
    - **Copy link to selection** in the layer, instance, multi-select, and
      layer-row context menus (Copy/Paste as › first item), plus Copy link to
      screen on the empty canvas. Links carry scope:
      `/design/<id>?screen=home&node=hero-title` (comma-separated nodes for
      a multi-selection). Opening one selects the layers and zooms to them.
    - **Share** is the toolkit `ShareButton` popover with Content's People /
      Agents tabs (`peopleTabLabel`, `agentsTabLabel`, `agentTabContent`),
      fixed size across tabs, at the app's density (24px controls, 32px
      rows). Agents: a scope row (Selection / screen / This design), Copy
      agent prompt, Open in Claude / Claude Code / Codex
      (`AgentDestinationActions`, `buildAgentShareDeepLink`), Send to the
      workspace's apps and channels, and MCP server settings
      (`/settings/mcp`). No Social, Embed, password, or expiry.
    - **Send to ›** in the context menus (selection scope on layers, screen
      scope on the empty canvas), from the same destination list: Agents
      (toolkit deep links; the prompt carries the scoped link and MCP URL),
      Apps (`useOrgSwitcherAppLinks`; A2A `call-agent` with the scoped link,
      then `/_agent-native/open` to the result), Channels (on-state
      `list-messaging-channels`; posting is new), Copy agent prompt, and
      Manage destinations… (Settings › Integrations).
    - **New MCP tools on the connector allowlist**
      (`EXTERNAL_CONNECTOR_TOOL_NAMES`), read-only: `get-design-context
      { url }` resolves the link and returns that scope's HTML/CSS, the
      tokens it uses as DTCG, a screenshot URL, the layer tree, open comments,
      and the design system; `get-design-tokens { url }` and
      `get-design-screenshot { url }` for cheaper calls. Today every read
      action takes an id, nothing parses a Design URL, and the allowlist
      leaves out screenshots and comments.
    - If the link's design isn't visible to the org, the tab says so and
      offers Anyone in <org> can view.

Every PR touching copy updates `app/i18n/en-US.ts` and the 11 locale files and
runs `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy`. Mode or
tool changes keep `use-navigation-state.ts` and
`publish-agent-selection-context.ts` in sync so the agent still sees the
current mode, tool, and panel; update the Design template's agent skill text
where it names Annotate or the old toolbar.

## Shortcuts

Menus show the bindings from `DESIGN_SHORTCUTS`
(`templates/design/app/components/design/keyboard-shortcuts.ts`), formatted
with `formatShortcutLabel`: Move V, Hand tool H, Scale K, Frame F, Text T,
Image/video ⇧⌘K, Rectangle R, Line L, Arrow ⇧L, Ellipse O, Pen P, Draw ⇧Y,
Comment C, Comments toggle ⇧C, Zoom in ⌘=, Zoom out ⌘-, Zoom to fit ⇧1,
Zoom to 100% ⇧0. Screen, Polygon, and Star have no binding and show none.
New bindings for the Agent menu skills: Inspiration ⇧I, Debug ⇧S, Polish S
(all unbound today). The mode switch gets no single-key shortcut because I is
the eyedropper. ⌘K belongs to Actions… in the App menu.
