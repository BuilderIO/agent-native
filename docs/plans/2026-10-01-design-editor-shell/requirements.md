<!-- Generated from requirements.json by prototype/build.ts. Edit the JSON, then rebuild. -->

# Requirements

Statuses: `context` describes the code with nothing to build; `proposed`, `question`, `decided`, `in-pr`, and `shipped` track a change. Steps refer to the roadmap in README.md.

## Top bar (TOP, step 1, 3, 5)

- **TOP-01** · decided
  - Today: There is no top bar. Presence, Review changes, Apply feedback, the Play popover, and Share sit in `rightSidebarActions` at the top of the inspector rail.
  - Change: One 48px bar across the canvas and inspector.
- **TOP-02** · decided
  - Today: Top-right controls mix 28px Figma selects with 32px toolkit `sm` buttons; 28 isn't on the 16/20/24/32 ramp.
  - Change: Every top-bar control is 24px with 12/16 text and a 6px radius; edge padding is 8px beside text and 4px beside a 16px glyph. The mode switch is a 24px segmented control (20px segments); Import and Share are 24px split buttons with a 20px chevron half. The bar stays 48px.
- **TOP-03** · decided
  - Change: Three columns with the route centred: left holds the mode switch (then device and Appearance in Interact); centre holds back, forward, the route picker, and reload in Interact; right holds zoom, presence, Import, and Share.
- **TOP-04** · proposed
  - Today: Inline screen iframes are pinned to `colorScheme: "light"` in the editor (`DesignCanvas.tsx:7323`, `MultiScreenCanvas.tsx:12205`, `:12564`, `:13254`), so no design previews dark.
  - Change: Interact › Appearance (Light / Dark / System) beside the device picker sets that value instead. In Chromium an iframe's `color-scheme` drives `prefers-color-scheme` inside it, so designs with dark CSS follow with no changes. Design mode keeps the light pin.
- **TOP-05** · decided
  - Change: Zoom stays in the same spot in both modes and keeps its value; it's the true scale, so a 1280 frame fits at about 67% and Zoom to fit fits the frame's current width. The route stays exactly centred from 1200px wide; below that it takes the leftover middle (120–264px) and presence avatars hide.
- **TOP-06** · decided
  - Today: The inspector's Screen section holds the breakpoint chips and edit scope.
  - Change: In Design, the Screens panel picks the screen and the frame's W sets its width (RESP-04); device sizes in Interact are preview viewports (RESP-09).
- **TOP-07** · decided
  - Change: Local app screens: one route control (status dot, route ▾) in the top bar's center in Interact and Design, Interact's address bar and Design's screen control (INSP-07). In Design, Reload screen and Open in browser sit beside it, with Apply to source until SAVE-02.
  - Prototype: Scenario: Local app screen.
- **TOP-08** · decided
  - Change: Right zone in both modes: Review changes when pending, presence, then Import and Share as split buttons.
- **TOP-09** · decided
  - Today: Import is a rail panel (`DesignImportPanel`).
  - Change: Import is a split button: the button opens the Import dialog with the same sources; the chevron jumps straight to one source.
- **TOP-10** · decided
  - Today: Share is the toolkit `ShareButton` with tabs Share link, Export, Send to agent, and Live collaboration.
  - Change: Share is a split button: the button opens the share popover (AGT-03); the chevron holds Export: Download HTML, PNG, SVG, Figma SVG, ZIP, PDF, Copy agent prompt, Publish app, and Download tokens (DTCG) while the Tokens lab is on.
- **TOP-11** · decided
  - Change: With the inspector showing, the bar's last column starts at the inspector's left edge: zoom ends 8px before it, and presence, Import, and Share sit over the inspector, leaving room for more people and agents. Without the inspector (Interact, narrow windows) the cluster sits together at the right.

## Where today's extra controls go (MOVE, step 1)

- **MOVE-01** · proposed
  - Today: Apply feedback sits in `rightSidebarActions` when the review queue has items.
  - Change: Apply feedback moves to the top of the Threads panel, same condition.
- **MOVE-02** · proposed
  - Today: Review changes (pending node rewrites) sits in `rightSidebarActions`.
  - Change: Review changes moves to the top bar's right zone, same condition and menu.
- **MOVE-03** · decided
  - Today: The localhost link and Apply to source sit in `rightSidebarActions`.
  - Change: The localhost link becomes the route control's tooltip and the Open in browser button beside it; Apply to source joins that group until SAVE-02 replaces it (INSP-07).
- **MOVE-04** · decided
  - Today: A Play popover holds Design Preview and Publish app (waitlist).
  - Change: The Play popover goes: Interact is the preview, and Publish app moves to Share's chevron.

## Canvas comments (CMT, step 9)

- **CMT-01** · decided
  - Today: Comments live in the inspector's Comments tab (`ReviewPanel` / `ReviewCommentsPanel`).
  - Change: Threads open on the canvas, attached to their element (Figma 1205:2267). Clicking a pill opens a 360px card beside it with the title bar (⋯, Resolve, Close), the messages, and a reply box.
- **CMT-02** · decided
  - Change: Collapsed, a thread is an avatar pill at the element's top-right corner: up to three participants, plus the message count when there are replies.
- **CMT-03** · proposed
  - Change: The card opens to the right of the pill and flips to its left when it would leave the canvas. Esc, ×, or clicking the canvas closes it; clicking the pill again toggles it.
- **CMT-04** · proposed
  - Change: The reply box expands on focus (accent border, emoji, @, image, send). Typing @ opens the mention picker of people and agents (Figma 1259:23236); a mention becomes a chip.
- **CMT-05** · proposed
  - Change: Agents reply in the thread with their brand mark and an Agent badge (Figma 1205:2713). Mentioning an agent starts a run; its answer lands in the same thread.
- **CMT-06** · proposed
  - Change: ⋯ holds the Agent menu from Figma (Suggest changes, Reply in thread, Apply changes and resolve), then Copy link and Delete thread.
- **CMT-07** · proposed
  - Change: The Comment tool (C) or + in the Threads header: click an element and an empty card opens there with the box focused (Figma 1224:21402). Sending makes the thread and returns to Move.
- **CMT-08** · decided
  - Change: The Threads panel is the finder, grouped by screen (search and filters in RAIL-12). A row opens its thread on the canvas, scrolling to the element and switching screens if needed.

## View options (zoom menu) (VIEW, step 11)

- **VIEW-01** · context
  - Today: The pixel grid draws only on the overview canvas, automatically at 800% and up (`showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM` in `MultiScreenCanvas.tsx`). `canvas-math.ts` has a `shouldShowPixelGrid` helper that nothing in the app calls.
- **VIEW-02** · proposed
  - Change: Pixel grid becomes a toggle (on by default, still drawn from 800%), and the single-screen canvas (`DesignCanvas.tsx`) draws it too.
- **VIEW-03** · context
  - Today: Smart snapping covers move, resize, and spacing (edges, centers, gaps within 6px; whole-pixel results via `WHOLE_PIXEL_SNAP_STEP`). Holding ⌘/Ctrl bypasses it while dragging.
- **VIEW-04** · proposed
  - Change: Snapping gets an on/off toggle; ⌘/Ctrl still bypasses it per drag.
- **VIEW-05** · proposed
  - Today: Per-frame column and row grids (`LayoutGridProperties`) have a show/hide-all toggle, ⌃G (`handleToggleLayoutGrids`).
  - Change: The zoom menu lists it as Layout grids ⌃G, renamed from Figma's “Layout guidelines” to match the code.
  - Prototype: Press ⌃G to see a 12-column grid.
- **VIEW-06** · proposed
  - Today: Only the ruler tick math exists (`getRulerTicks`).
  - Change: The ruler UI is new work; the toggle is off by default until it ships.
- **VIEW-07** · context
  - Today: `LiveCursorOverlay` shows remote people and the agent's synthesized cursor, always on.
- **VIEW-08** · proposed
  - Change: Multiplayer cursors gets a toggle (on by default).
- **VIEW-09** · context
  - Today: Show or hide comments is ⇧C.

## Keyboard shortcuts window (KEYS, step 12)

- **KEYS-01** · decided
  - Today: Shortcuts are a 241px drawer pinned to the bottom of the editor, which also pushes the floating toolbar up 257px.
  - Change: A centred 760×640 modal (shadcn Dialog) replaces the drawer.
- **KEYS-02** · proposed
  - Change: Title row is the shadcn Dialog header: title on the left, close on the right.
- **KEYS-03** · decided
  - Change: Left column (200px): search at the top, then the 13 categories from `DESIGN_SHORTCUT_CATEGORIES`; clicking a category scrolls to it and the current one follows the scroll. Right: one list with sticky category headings, name on the left, keycaps on the right, “or” between alternate bindings.
- **KEYS-04** · proposed
  - Change: Search matches names, highlights the match, and narrows the categories to the ones with results; it has focus on open. × clears it; Esc clears the search, then closes.
- **KEYS-05** · context
  - Today: Rows come from `DESIGN_SHORTCUTS` with `designEditor.keyboardShortcuts` labels and keycaps from `formatShortcutKeycaps`. Show assets stays out while its panel is behind `SHOW_DESIGN_SECONDARY_LEFT_PANELS`; screen-only shortcuts carry a “Screen” tag.
- **KEYS-06** · proposed
  - Today: Nudge amount (Small / Big px) is a row in the drawer.
  - Change: Nudge amount sits in the Cursor section under Nudge and Big nudge, and in App menu › Preferences › Nudge amount… (SET-05).
- **KEYS-07** · proposed
  - Today: The window opens with ⌃⇧? (the registry's binding).
  - Change: It also opens from App menu › Help › Keyboard shortcuts and Preferences › Keyboard shortcuts.
- **KEYS-08** · proposed
  - Today: Minimal UI (⇧⌘\) reuses the “Show/Hide UI” label (`designEditor.keyboardShortcuts.commands.toggleUi`).
  - Change: Minimal UI gets its own label, “Minimal UI”.
- **KEYS-09** · question
  - Change: Label for `toggle-minimal-ui` in the shortcuts window: keep “Minimal UI”?

## Menus and context menus (MENU, step 13)

- **MENU-01** · decided
  - Change: App menu on the logo (Figma 1309:32918): Actions… ⌘K, then File (1693:1062), Edit (1693:1196), View (1693:1275), Preferences (Theme ›, Keyboard shortcuts, Nudge amount…; SET-05), Help (1693:1371).
- **MENU-02** · decided
  - Change: Design file menu on the file name (Figma 1309:32834), minus Move to folder… until folders exist. Zoom menu (1693:1945) holds the view toggles.
- **MENU-03** · decided
  - Change: Single layer (Figma 1834:719, shortcuts from `CanvasContextMenu.tsx`): Edit with Agent ›, Send to ›, Copy link, Copy, Paste to replace, Copy/Paste as ›, Rename, Frame selection, Add auto layout, Create component, Hide, Lock, Arrange ›, Transform ›. A component instance swaps the creation actions for Go to main component, Swap instance ›, Detach instance.
- **MENU-04** · decided
  - Today: Boolean operations: only Subtract (⌥⇧S) is implemented.
  - Change: Multiple layers (Shift-click): Edit with Agent ›, Send to ›, Copy link, Copy, Paste to replace, Copy/Paste as ›, Group selection, Frame selection, Add auto layout, Boolean operations › (Subtract only), Hide, Lock, Arrange ›, Transform ›.
- **MENU-05** · decided
  - Change: Empty canvas (Figma 1826:562), the agent and sharing group first, as on layers: Explore with Agent, Send to › (the screen), Copy link; then Paste here; then Hide UI and Hide comments, which flip to Show UI and Show comments while hidden, as `CanvasContextMenu` does. Layer row: Copy, Copy link, Rename (in place), Hide, Lock, Arrange ›, Transform ›, with LayersPanel's shortcuts.
- **MENU-06** · decided
  - Change: Edit with Agent › is the first row, styled like every other row (no tinted agent row). Clicking it opens the agent composer; its submenu is the Agent actions card (Figma 1826:562): Inspiration, Polish, Debug, Generate states, Make responsive, each with a one-line outcome.
- **MENU-07** · context
  - Today: Arrange and Transform commands: Bring to front ], Bring forward ⌘], Send backward ⌘[, Send to back [, Align left/right/top/bottom ⌥A/⌥D/⌥W/⌥S, Tidy up ⌃⌥T; Flip horizontal ⇧H, Flip vertical ⇧V, Swap fill and stroke ⇧X. (Figma's submenu card repeats instance rows as placeholders.)
- **MENU-08** · proposed
  - Change: The Agents composer + is Figma's “MVP Add context menu (prompt bar)” (2261:2104): Search…, Upload file, Attach Figma, Reference a design.
- **MENU-09** · decided
  - Change: Menus are text: no leading icons on rows, following the macOS HIG. They keep the toolkit's shadcn DropdownMenu structure (inset content, rounded row highlights, inset separators) at the editor's density from `CanvasContextMenu.tsx`: 3px inset, 28px rows of 12px text with 4px corners, 11px muted shortcuts, 11px labels. Popovers like Share use the toolkit's Popover, Tabs, Input, and Button. A row shows a check or radio for state, a shortcut, or a submenu chevron, and nothing else. An ellipsis (…) ends a label only when the row opens a dialog or a system file panel (Save as template…, Nudge amount…, From your app…, Import's sources, DTCG file…); rows that open a menu, a popover, or the composer don't get one (Export ›, Publish app, Edit with Agent ›). The toolbar's tool pickers keep their glyphs, since the picked tool's glyph becomes the button, and the shared account menu is the toolkit's.

## Version history (HIST, step 14)

- **HIST-01** · proposed
  - Today: Only the project menu opens Version history.
  - Change: It also opens from the file menu and App menu › File › Version history.
- **HIST-02** · context
  - Today: A modal shadcn Sheet from the right, 92vw up to 640px, over a dimmed editor. The list shows an accent dot, title, screen count, and relative time; titles are the stored labels (“Chat autosave”, “Before component delete”, “Before editor screen delete”, “Before restore”) or “After chat edit” for unlabeled chat versions.
  - Prototype: Pick “History: Sheet (today)” in the review strip.
- **HIST-03** · context
  - Today: A version opens a detail view in the same sheet: title, date · screen count, a two-column grid of screen thumbnails with file names, and a full-width “Restore this version”.
- **HIST-04** · context
  - Today: Versions are only created automatically: after an agent turn that edited the design (“Chat autosave”), before screen and component deletes, and “Before restore”. Manual edits never create a version.
  - Prototype: Polish and agent mentions in comments autosave like the code does.
- **HIST-05** · proposed
  - Change: History mode: Version history turns the inspector into a timeline and the canvas into the preview. The floating toolbar hides; canvas and layers are read-only; comment pins hide. The top bar shows “Version history”, “Viewing {version} · {time}”, zoom, Restore this version, and Done; Esc or Done returns to the previous mode.
- **HIST-06** · proposed
  - Change: Timeline: Current version on top (accent node); runs of autosaves collapse into “N autosave versions”; named versions and restores stay their own nodes on a vertical line. “Before restore” shows as “Restored version · saved before restoring”. Picking a version switches the canvas to it, and to its first screen if the current one isn't in that version.
- **HIST-07** · proposed
  - Change: Restore saves “Before restore”, replaces the design, and returns the timeline to Current version without leaving the mode.
- **HIST-08** · proposed
  - Today: `create-design-version` only writes the pre-delete checkpoint, and versions have no author.
  - Change: Named versions: + opens a title and description form, and the version saves with its author. The filter switches between All versions and Named versions only. Needs an additive created-by column on `design_versions` and a label/description save.
- **HIST-09** · question
  - Change: Version history as a mode (HIST-05) or today's `HistoryPanel` sheet? The prototype has both (review strip › History).

## Tokens (TOK, step 15, 16)

- **TOK-01** · context
  - Today: `TokensPanel.tsx` uses `index-design-tokens`, `apply-design-token-edit`, `preview-design-token-edit`, and `import-design-tokens`. It's hidden by the build-time switch `VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS`, which also hides Assets, Tools, and Code. Its strings are raw literals.
- **TOK-02** · decided
  - Change: Tokens ships behind a `design.tokens` lab in `shared/labs.ts` (like `DESIGN_TWEAKS`), read with `useLab` for the rail item and listed in Settings › Labs. It leaves the build switch; Assets and Tools keep it, and Code gets its own lab (CODE-05).
  - Prototype: Toggle “Labs: Tokens” in the review strip or Settings › Labs.
- **TOK-03** · proposed
  - Change: Tokens is a rail item (after Agents) and a left panel on the shared 16px row strip: groups Colors, Typography, Spacing & Layout, Radius, Shadows & Effects, Other, each collapsible. A row is swatch or type glyph, name, and value (TOK-19 covers where a token comes from).
- **TOK-04** · proposed
  - Change: Click a row to edit its value in place (Enter saves, Esc cancels); color rows open a color picker instead (TOK-20). Edits restyle the canvas live, like `apply-design-token-edit`.
- **TOK-05** · decided
  - Today: One create popover: Add one token is a CSS-variable field and a value field that defaults to `#000000`, and `classifyVar` guesses the group from the name and value.
  - Change: + Add token is a Nova menu of token kinds in the panel's group order: Color · Font family, Font weight, Font size, Line height, Letter spacing · Spacing, Container, Breakpoint, Radius · Shadow, Opacity. A kind adds a draft row at the end of its group with the kind's prefix and a starting value (Font size → `--font-size-`, 16px), stored with that type; Enter moves to the value, Enter or clicking away saves, Esc cancels.
- **TOK-06** · proposed
  - Today: The code's token types are color, typography, spacing, radius, shadow, motion, other.
  - Change: Container, Breakpoint, and Opacity are new kinds. Spacing becomes “Spacing & Layout” to hold Container and Breakpoint; Opacity lands in Shadows & Effects. Container and Breakpoint tokens feed the frame's width presets and responsive rule thresholds (RESP-05).
- **TOK-07** · decided
  - Today: The same popover offers Import a set from text, Import from a file, Import from a folder, and Import from current design.
  - Change: Import (Tabler `download`) is a Nova menu like +, each item importing straight away with a toast of what changed: Paste Figma link, DTCG file…, CSS or Tailwind file…, Code folder…, Paste from clipboard, then Generate from design. The same parser runs underneath, and DTCG is detected by content.
- **TOK-08** · proposed
  - Today: Frame import already uses the workspace's Figma connection (`FIGMA_ACCESS_TOKEN`). Figma's Variables API needs an Enterprise plan.
  - Change: Paste Figma link reads the file link copied in Figma from the clipboard (no field) and imports color, text, and effect styles on every plan, plus variables on Enterprise; otherwise the toast says variables need Enterprise. Paste from clipboard routes a Figma link here too. In code: a `figma` source on `import-design-tokens`.
- **TOK-09** · context
  - Today: Figma's MCP (`mcp.figma.com`) is in core's MCP catalog but only accepts approved clients, so Design can't connect to it. An outside agent (Claude Code, Codex) can connect to Figma's MCP and to Design's own MCP server, read `get_variable_defs`, and call `import-design-tokens` (Paper's model). The `design-systems` skill already tells the agent to use Figma MCP tools when connected.
- **TOK-10** · decided
  - Today: Import from current design runs a regex extraction over the design files.
  - Change: Generate from design (Import menu and the empty state) starts a `generate-tokens` agent skill: it reads the screens, names tokens by role, merges near-duplicates, and proposes the set for Apply. The regex extraction becomes its first step.
- **TOK-11** · question
  - Change: Export: Download tokens (DTCG) sits in Share › Export with the other downloads while the Tokens lab is on. Keep it there, or give the panel its own export?
- **TOK-12** · decided
  - Today: The panel header has a title, a token count, Refresh, and the create popover; rows are 28px.
  - Change: The header is the token count, then Search, Import, and +. Search swaps in for the line as a focused 32px field with a ⌘F hint (RAIL-11). Group headers drop their counts and uppercase labels; rows are 32px.
- **TOK-13** · decided
  - Today: ⌘F (`find`) always opens Layers search (`handleFindLayers`), and stays native inside text fields (`useDesignHotkeys`).
  - Change: ⌘F searches the region you last clicked or focused: Tokens, Threads, and Agents open their own search; the File panel, the canvas, and the inspector open Layers search. In code, `onFind` asks the focused panel for a `focusSearch` handle before falling back to `layersPanelRef`.
- **TOK-14** · context
  - Today: A design's tokens are CSS custom properties in each screen's `:root`; edits and imports land in `designs.data.tweakSelections`, a flat `{ "--var": value }` map shared with Tweaks. Brand kits and design systems keep a custom `BrandKitToken[]` plus fixed fields in `design_systems.data`. Nothing reads or writes DTCG.
- **TOK-15** · decided
  - Change: Store tokens as DTCG (Design Tokens Format Module 2025.10): nested groups, `$value`, `$type`, `$description`, aliases like `{color.primary}`, colors as `{ colorSpace, components, alpha, hex }`, dimensions as `{ value, unit }` in px or rem, and Agent-Native data under `$extensions`. CSS variables become derived output (`color.primary` → `--color-primary`).
- **TOK-16** · proposed
  - Change: DTCG import and export: groups inherit `$type`; `{alias}` and `$ref` resolve; colors, dimensions, durations, font families and weights, cubic-béziers, and shadows convert to CSS. A `com.agent-native.cssVar` extension keeps the variable name, otherwise the path becomes it. Share › Export › Download tokens (DTCG) writes the same shape back, and a round trip changes nothing.
- **TOK-17** · question
  - Change: Container and Breakpoint stay (they feed RESP-05). Keep the Opacity kind, or leave opacity to the inspector?
- **TOK-18** · proposed
  - Change: The token panel's strings get localized (en-US plus the 11 locale files) when it leaves the build switch.
- **TOK-19** · decided
  - Today: Hovering a row shows a 9px outline badge with the token's source: the design file whose `:root` defines it (index.html) or Brand Kit.
  - Change: The source badge goes. The row's tooltip reads the CSS variable and its file (--radius-pill · index.html). A warning mark appears only when files define the token with different values, and its tooltip names each file and value; `index-design-tokens` already returns `sources` and `sourceValues`.
- **TOK-20** · proposed
  - Today: Clicking a color token opens a text field for its hex value, the same as every other token.
  - Change: Clicking a color token opens the inspector's color picker (step 21, COLOR-02 to COLOR-04) with `supportedPaintTypes` set to solid and no Libraries tab, beside the panel and level with the row. Dragging restyles the canvas live, Esc puts the old value back, and clicking away keeps the new one. A new color token's swatch opens the same picker.

## Floating toolbar (TOOL, step 4)

- **TOOL-01** · decided
  - Today: The toolbar holds Move, Frame, Shape, Pen, Text, Comment pin, and the mode tabs; it hides in Interact.
  - Change: Figma 1057:1991 (Toolbar section 1098:17334), 252×48: Move▾, Frame▾, Pen▾, Comment, Agent▾. Text and the Shape tool fold into Frame's Insert menu. Interact: Interact, Comment, Agent▾. Annotate (Labs): Draw▾, Comment, Agent▾.
- **TOOL-02** · proposed
  - Today: `DesignToolbarTool` gives the tool and its chevron one shared hover.
  - Change: Split buttons: 32×32 tool, 1px gap, 16×32 chevron, separate hover per half, chevron filled while its menu is open. Comment has no chevron.
- **TOOL-03** · proposed
  - Today: The toolbar sits 16px above the bottom (257px while the shortcuts drawer is open).
  - Change: It's pinned 8px above the canvas viewport's bottom edge, whatever the page height; the canvas keeps 64px of bottom scroll room so content can clear it.
- **TOOL-04** · decided
  - Change: Select menu: Move V, Hand tool H, Scale K. Insert menu on Frame: Frame F, Text T, Screen, Image/video…, then Rectangle R, Line L, Arrow ⇧L, Ellipse O, Polygon, Star. Picking an option swaps the tool's icon.
- **TOOL-05** · decided
  - Change: Pen menu: Pen P and Draw ⇧Y. Draw is Annotate, so it only shows with the Annotate lab on; with it off, Pen keeps its chevron and a one-item menu so the toolbar stays 252px.
- **TOOL-06** · proposed
  - Change: Agent (Tabler `sparkles`) opens the Agents panel with the composer focused and the selection attached. The chevron opens the Agent menu: Inspiration ⇧I, Debug ⇧S, Polish S; a skill starts a chat run.
- **TOOL-07** · context
  - Today: Shortcuts from `DESIGN_SHORTCUTS`: Move V, Hand tool H, Scale K, Frame F, Text T, Image/video ⇧⌘K, Rectangle R, Line L, Arrow ⇧L, Ellipse O, Pen P, Draw ⇧Y, Comment C. Screen, Polygon, and Star have none. I is the eyedropper, so the mode switch gets no single-key shortcut, and ⌘K belongs to Actions….
  - Change: The Agent menu skills take Figma's keys (Inspiration ⇧I, Debug ⇧S, Polish S), unbound in code today.

## Labs: Annotate (LAB, step 2)

- **LAB-01** · decided
  - Today: Annotate is a mode tab in the floating toolbar.
  - Change: Annotate becomes a lab in `shared/labs.ts`, read with `useLab` like `DESIGN_REVIEW_TOOLS_LAB`. Off: two modes, no Draw. On: the Annotate segment and Draw return, with today's Draw overlay. It's listed in Settings › Labs.

## Left rail and panels (RAIL, step 6)

- **RAIL-01** · decided
  - Today: The rail is 64px (`--design-chrome-rail-width`); clicking the active item already collapses its panel (`onPanelChange(active ? null : panel)`).
  - Change: The rail is 56px. Each item follows Figma's rail button: full width, a 20px icon in a 32px box, the 11/16 label under it truncating with an ellipsis, and the full name in a tooltip to the right after 500ms; items carry `aria-expanded`. Footer controls stay 16px.
- **RAIL-02** · decided
  - Today: The code calls comment threads “threads” in filters (“Only your threads”).
  - Change: The comments rail item is labelled “Threads” (43px at 11px; “Comments” is 56px and truncates). The panel header counts threads; search and filter labels keep the code's “comments” strings.
- **RAIL-03** · decided
  - Change: Threads is a rail item with an open-thread count badge.
- **RAIL-04** · decided
  - Today: The logo opens the project menu.
  - Change: The logo opens the App menu (MENU-01).
- **RAIL-05** · decided
  - Today: The Agent rail panel mounts `AgentChatSurface` (the chat).
  - Change: File shows Screens and Layers. Agents shows Recent chats, with the composer pinned at the bottom and the selection attached as context.
- **RAIL-06** · decided
  - Today: The toolkit `AgentPanel` header has All chats (`agentPanel.allChats`), which opens the history view.
  - Change: Inside a chat, a back chevron before the title returns to the chat list, and the title menu starts with All chats, then recent chats to jump between.
- **RAIL-07** · decided
  - Today: The shared composer already has a / menu: `MentionPopover` lists the app's skills (`use-skills` / `slashSkills`), and picking one inserts an inline `skillReference` chip.
  - Change: The Agents panel has no Skills section: skills start from / in the composer. The toolbar's Agent ▾ menu still lists them with ⇧I, ⇧S, and S.
- **RAIL-08** · proposed
  - Change: Apply feedback (n) sits at the top of the Threads list and starts the agent run. The rail footer's speech-bubble icon goes away.
- **RAIL-09** · proposed
  - Today: The comment list renders inside the inspector (`EditPanel.tsx:3189`, `:3251`), and placing a pin opens the inspector's Comments tab.
  - Change: Agent context moves from `inspectorTab: comments` to `leftPanel: comments` in `use-navigation-state.ts`.
- **RAIL-10** · decided
  - Today: The rail footer uses the toolkit `AccountMenu` / `OrgSwitcher`; Design passes no `utilityLinks`.
  - Change: The footer control is the compact trigger: a 24px avatar (tooltip: name and organization), not Figma's briefcase. Its menu opens above it, start-aligned, 6px away, at least 248px wide: email, organizations, invitations, Create organization, Settings ⌘,, Usage, Log out.
- **RAIL-11** · decided
  - Today: Layers already swaps a search field in for its header (`searchOpen`). `ReviewCommentsPanel` uses `IconAdjustmentsHorizontal` for its filter.
  - Change: Every left panel shares one header: a label (count or chat switcher), then Search, Filter, and +. Only the File panel keeps the hide-panel button; the others collapse from their rail item or ⌘\. Search swaps in as a focused field; click-away, ×, and Esc dismiss it and clear the query, while clicking a result row keeps it. Filter uses Tabler `filter-2` everywhere and turns accent while a filter is on.
- **RAIL-12** · decided
  - Today: `ReviewCommentsPanel` (used in review and Present) has search over every message's text and a Filter comments menu: Show resolved comments, Only your threads, Unread, Only current page, Sort by date or unread, Mark all as read.
  - Change: The Threads panel uses that search and filter menu; the header shows the count.
- **RAIL-13** · decided
  - Today: Core chats have search (`searchThreads`, titles and messages), `pinnedAt`, `archivedAt`, and `updatedAt` (listed pinned first, then newest). There is no read state for chats.
  - Change: Agents search covers chats. The filter menu holds Sort by date and Sort by unread, then Pinned only and Show archived chats. Unread is new: a dot marks a chat whose run finished after you last opened it, which needs a per-thread last-read time. Pinned chats show a pin; archived ones are dimmed. Search and Filter show on the chat list, not inside a chat.
- **RAIL-14** · decided
  - Today: Agent surfaces use a robot icon.
  - Change: Agents use Tabler `sparkles` on the rail item and the toolbar's Agent button. Menu rows carry no icons (MENU-09), so Edit with Agent ›, Explore with Agent, and the agent actions are text; wherever a skill does show a glyph, Polish uses `wand` so it doesn't share the agent mark.
- **RAIL-15** · question
  - Today: The Agent panel has a 320px minimum width (`activeLeftPanel === "agent" ? 320 : 220`).
  - Change: Should the Agents panel keep a 320px minimum when every other left panel starts at 232px?
- **RAIL-16** · proposed
  - Today: The Figma Navigation page notes on the collapsed rails (646:5188, 1850:8474) still say 72px.
  - Change: Update them to 56px and the Figma rail button.

## File header (FILE, step 7)

- **FILE-01** · decided
  - Today: The title is click-to-rename, beside a minimal-UI toggle; the project menu holds Back to designs, Save as template, Version history, Export, Edit, View.
  - Change: The file name opens the Design file menu from Figma: Rename, Duplicate, Version history, Save as template…, Export ›, Move to trash.
- **FILE-02** · decided
  - Change: Under the name, a ghost button reads “Designs” and goes to /home. No arrow: the label sits flush with the file name, the hover fill extends 4px past it on each side, and the button is its own 16px line 2px below the name, so the fill never covers the name.
- **FILE-03** · decided
  - Today: Designs have no folders.
  - Change: Move to folder… stays hidden until designs have folders.

## Screens and layers (LAYER, step 8)

- **LAYER-01** · decided
  - Today: `LayersPanel.tsx` overrides rows to 24px and headers to 28px; indent is a 12px slot per level with a 20px caret slot.
  - Change: 32px rows, 40px headers. One strip: 16px inset, 24px spacer per depth, 16px disclosure slot (empty on leaves), 8px, 16px icon, 8px, name.
  - Prototype: Turn on Spacing (G) in the review strip to see the spacers.
- **LAYER-02** · decided
  - Today: The left panel defaults to 280px and clamps to 220–420px.
  - Change: It resizes from its right edge in 8px steps: 240px default, 232px minimum (the first 8pt width at or above Figma's 227px), 416px maximum. Double-click resets to 240px; arrow keys nudge 8px (Shift 40px).
- **LAYER-03** · proposed
  - Today: Single-screen Layers drops `html` and `body` and starts at the body's children (`compactCodeLayerTreeNodes`); only the overview shows a row per screen file.
  - Change: The screen's root frame is the top Layers row (frame icon, the screen's name) with its layers nested under it, and selecting it selects the screen, like its label on the canvas. The Screens list keeps switching screens.
  - Prototype: “Screen 1” heads the Layers tree.

## Inspector (INSP, step 10)

- **INSP-01** · decided
  - Today: The inspector has tabs Design / Comments / Tweaks or Code (`EditPanel.tsx`).
  - Change: No tab row: the inspector starts at the selection header and only does properties.
- **INSP-02** · proposed
  - Change: Every section is a 40px header and rows on the 88 / 8 / 88 / 8 / 32 grid; fields are 12px label, 4px, 24px control.
- **INSP-03** · proposed
  - Change: Empty sections (Stroke, Effects) drop the chevron and keep its space, so titles line up.
- **INSP-04** · decided
  - Change: Interact and Annotate hide the inspector; the canvas takes the width.
- **INSP-05** · decided
  - Today: With the Frame tool armed (F), `FramePresetsPanel` replaces the inspector: a “Frame” title, then the code's categories in data order with Desktop first and only it open, no icons. Picking a preset creates a screen (`onCreateScreenFromPreset`).
  - Change: Same behavior, organized: groups Phone, Tablet, Desktop, Presentation, Smartwatch, Paper, Social media, each with its icon and collapsible, all open to start. A row is the preset name on the left, aligned with the group icon, and W × H on the right in tabular figures; long names truncate with the full name on hover. Picking one creates the screen and returns to Move.
  - Prototype: Press F, or pick Frame from the toolbar's Frame menu.
- **INSP-06** · decided
  - Today: `FRAME_SIZE_PRESET_CATEGORIES` has the iPhone 16 and 17 era, an Ad unit group, and paper in CSS pixels (A4 794 × 1123). `BreakpointBar` also reads it to suggest breakpoint widths.
  - Change: Replace the list: Phone (iPhone 18 Pro 402 × 874, iPhone 18 Pro Max 440 × 956, iPhone Duo 466 × 678, iPhone Duo unfolded 890 × 626, iPhone 17 402 × 874, iPhone Air 420 × 912, iPhone 16 393 × 852, iPhone 16 Plus 430 × 932, iPhone 16e 390 × 844, iPhone 13 mini 375 × 812, iPhone SE 375 × 667, Google Pixel 11 412 × 924, Google Pixel 11 Pro 410 × 914, Google Pixel 11 Pro XL 448 × 997, Google Pixel 11 Pro Fold 791 × 820); Tablet (iPad mini 8.3″ 744 × 1133, iPad Air 11″ 820 × 1180, iPad Air 13″ 1024 × 1366, iPad Pro 11″ 834 × 1210, iPad Pro 13″ 1032 × 1376, Google Pixel Tablet 1280 × 800, Surface Pro 11 1440 × 960); Desktop (MacBook Air 1280 × 832, MacBook Pro 14″ 1512 × 982, MacBook Pro 16″ 1728 × 1117, iMac 24″ 2240 × 1260, Studio Display 27″ 2560 × 1440, Full HD 1920 × 1080, Wireframe 1440 × 1024); Presentation (Slide 16:9 1920 × 1080, Slide 4:3 1024 × 768); Smartwatch (Apple Watch Ultra 3 211 × 257, Apple Watch 46mm 208 × 248, 45mm 198 × 242, 44mm 184 × 224, 42mm 187 × 223, 41mm 176 × 215, 40mm 162 × 197); Paper in points (A4 595 × 842, A5 420 × 595, A6 297 × 420, Letter 612 × 792, Tabloid 792 × 1224); Social media (X post 1200 × 675, X header 1500 × 500, Facebook post 1200 × 630, Facebook cover 820 × 312, Instagram post 1080 × 1350, Instagram square 1080 × 1080, Instagram story 1080 × 1920, Dribbble shot 1600 × 1200, LinkedIn cover 1584 × 396, YouTube thumbnail 1280 × 720). The Ad unit group goes, and “Watch” becomes “Smartwatch” (`framePresets.categories.watch`, with its locale files).
- **INSP-07** · decided
  - Today: Every selected screen shows a Source segmented control, Static | URL (`update-screen-source`). URL reveals a Screen URL field with Update and, with more than one connected app, Choose local app. The Static label reuses `editPanel.positionOptions.static`, the Position option of the same name.
  - Change: Treat a URL screen like an instance of your app's route, and drop the Source control. Static screens show no source UI at all. Designers see the route, not the server, and it lives in the top bar rather than the inspector (whose Screen section goes, leaving the frame's own properties). In Design, a URL screen puts one control in the top bar's center, the same one as Interact's address bar: a status dot and the route (`● /home ▾`), green when the connection answers and grey when it doesn't (the connection's `status` and the bridge health check), with the app and host in its tooltip (Agent-Native Web · localhost:5173). Its menu answers one question, which route this frame shows: a search box (Search or type a path) over the app's routes, grouped by app only when more than one is connected (replacing Choose local app). Typing filters the routes, and a path that isn't listed (/plans/42) offers Show /plans/42, which replaces Custom path…. The app's actions sit beside it on the toolbar, the way Interact's reload sits beside its address bar: Reload screen (Retry connection while the app is down) and Open in browser (the host in its tooltip, disabled while down). Until SAVE-02 ships, the code's Apply to source joins them as a third button with the file in its tooltip. The selection header shows the screen name and its route, the same as a static screen. There's no Detach from app: editing a URL screen writes to the app's code (`apply-visual-edit` on consented localhost files), so the screen stays connected, and ⌘D duplicates it like any frame. When the app stops answering, the dot goes grey, Reload becomes Retry connection, Open in browser and Apply to source disable, and the canvas keeps the last render greyed out under one pill, Can't reach Agent-Native Web · Retry connection, in place of the bridge's error text. Interact's address bar shows the same dot and the path. Adding a route as a screen moves to Screens' + menu (Blank screen, From your app…), the code's “Add a screen from your app” flow (INSP-09). Switching a screen between static and live stays with the agent (`update-screen-source`), in both directions, with no UI. “Static snapshot” no longer needs its own string.
  - Prototype: Scenario: Local app screen, then open the route control and type in its search box, or use Reload and Open beside it. Scenario: Local app stopped shows the grey dot, Retry, and the canvas pill. Interact shows the address bar. Screens' + shows From your app….
- **INSP-08** · decided
  - Today: Position's device icon (`ScreenSizePresetPicker`) opens its own preset popover that sets W and H, separate from the Frame tool's panel.
  - Change: The device-size icon (Tabler `devices`, a phone in front of a screen, in place of the monitor) opens the Frame tool's grouped list (INSP-06) as a menu, one submenu per group, each preset showing W × H. Picking one sets W and a fixed H, and the frame shows that viewport; typing a number into H fixes the height, and anything else (Hug) goes back to hugging the content. Submenus open beside their row and flip to the left near the window's right edge (shadcn's DropdownMenu handles this collision in code).
  - Prototype: Select the screen, then the device icon on Position.
- **INSP-09** · proposed
  - Today: Connecting a local app lives in the Import panel's visual-edit row: two commands to copy (install the visual-edit skill, then `design connect --url 'http://localhost:<port>' --root . --daemon`) and a note to replace `<port>`. Adding routes is a separate dialog, Add a screen from your app (search routes, Desktop | Mobile, custom path), that assumes a connection already exists.
  - Change: Make connecting the first step of the same dialog. Screens' + › From your app… and Import › Local app… both open Add a screen from your app. With no app connected it shows Connect your app: one line (Start its dev server, then run this in the app's folder), the command `npx @agent-native/core@latest design connect --daemon` with a copy button (no port: `design connect` finds the dev server when `--url` is left off), and Or ask your coding agent, with Claude Code and Codex (the Send to deep links) and Copy prompt. The footer shows a grey pulsing dot, Waiting for your app…, and the dialog switches to the route list as soon as the connection registers (`connect-localhost`, read back with `list-localhost-connections`), so nobody has to close and reopen it. Connected, it shows Search routes… (the app is already named by the top bar's status dot, so the dialog doesn't repeat it), the routes with their page names (routes already on the canvas also name their screen), Add "/path" for a typed path, and Desktop | Mobile in the footer.
  - Prototype: Default scenario: Screens' + › From your app…, then copy the command or pick an agent; the app connects a moment later. Import › Local app… opens the same dialog.

## Outside agents (AGT, step 17)

- **AGT-01** · context
  - Today: Every Agent-Native app mounts a remote MCP server at `/mcp` (OAuth 2.1); calls run as the signed-in user under the design's sharing rules, so a link works from any machine. Design's connector allowlist is `EXTERNAL_CONNECTOR_TOOL_NAMES`.
- **AGT-02** · decided
  - Today: Nothing copies a link to a layer or screen.
  - Change: One item, Copy link (the code's `copyLink` and `linkCopied` strings), right after Send to › in every canvas menu, and after Copy on a layer row (which has no agent group). Like Send to, it links what you right-clicked: the screen from empty canvas, the layer or layers otherwise. The toast names it (Link to Hero title copied), so the label never needs a scope. Links carry scope: `/design/<id>?screen=home&node=hero-title` (comma-separated nodes). Opening one selects the layers and zooms to them.
- **AGT-03** · decided
  - Today: Content's share popover has People and Agents tabs (`peopleTabLabel` / `agentsTabLabel`); the toolkit `ShareButton` popover takes `agentTabContent`.
  - Change: Share is that popover with People and Agents. Both panes share one grid cell, so switching tabs never resizes it. 24px controls, 32px rows, 12/16 text. No Social, Embed, password, or expiry (Clips-only).
- **AGT-04** · proposed
  - Today: The toolkit's general access options: Only people with access can view, Anyone in your organization can view, Anyone signed in with the link can view.
  - Change: People: an invite field with the role inside it (Viewer ▾) and a send button, Who has access (owner, people with role menus), general access, then Copy link pinned to the bottom.
- **AGT-05** · decided
  - Change: Send to › sits under Edit with Agent › on layers, instances, and multi-selections (the selection) and under Explore with Agent on the empty canvas (the screen). One list of destinations, grouped Agents, Apps, and Channels, then Copy agent prompt and Manage destinations… (Settings › Integrations). Share › Agents shows the same list.
- **AGT-06** · proposed
  - Today: Agent deep links exist for Claude, Claude Code, and Codex (`buildAgentShareDeepLink`), with no install detection. Sibling apps come from `useOrgSwitcherAppLinks` (workspace runtime only). Messaging channels report on/off/not-set-up (`list-messaging-channels`) but only receive.
  - Change: Agents: the prompt carries the scoped link and the MCP URL, and the agent reads the context over the Design MCP. Apps: Design calls the app over A2A (`call-agent`) with an objective and the scoped link, then opens the result with `/_agent-native/open`. Channels: posting the scope's screenshot and link is new.
- **AGT-07** · proposed
  - Change: Share › Agents: the scope row (Selection, the screen, This design), Copy agent prompt, Open in Claude / Claude Code / Codex, Send to Slides / Content, Post to #design-review, and MCP server settings (Settings › MCP server, `/settings/mcp`).
- **AGT-08** · proposed
  - Today: Every read action takes an id, nothing parses a Design URL, and the allowlist leaves out screenshots and comments.
  - Change: New read-only MCP tools on the allowlist: `get-design-context { url }` (that scope's HTML/CSS, tokens as DTCG, screenshot URL, layer tree, open comments, design system), `get-design-tokens { url }`, and `get-design-screenshot { url }`.
- **AGT-09** · question
  - Change: If the design isn't visible to the engineer's org, should Share › Agents offer to switch General access to Anyone in the organization can view, or only say who can open it?
- **AGT-10** · question
  - Change: Rename Share › Agents › MCP server settings to Connect AI apps…, so the row says what the person gets rather than the mechanism?

## Settings (SET, step 6)

- **SET-01** · context
  - Today: Settings is the toolkit `SettingsShell`, a full page at `/settings/:page`: a 252px rail with Back to Design, Search settings (/ to focus, Enter opens the first hit), and groups Account · Design · Connections · Agent · Organization, then an 824px column under a sticky 60px header. Pages come from `core-pages.ts` plus `routes/settings.tsx` (Labs, MCP about, What's new, Creative context while its lab is on, Agent Observability for owners and admins); Notifications and Extensions don't show in Design.
- **SET-02** · context
  - Today: Entry points: the account menu's Settings (⌘,) opens Profile and Usage opens Usage; ⌘, works anywhere.
  - Change: Share › Agents › MCP server settings opens MCP server, and Send to › Manage destinations… opens Integrations.
- **SET-03** · proposed
  - Today: Labs lists Design tweaks, Full app building, Design review tools, and Creative context.
  - Change: Labs adds Tokens (TOK-02) and Annotate (LAB-01).
  - Prototype: The Tokens and Annotate rows are marked New; flipping them changes the editor.
- **SET-04** · proposed
  - Today: Design System setup links to `/settings/integrations#secrets:GITHUB_TOKEN`, an anchor nothing on Integrations matches.
  - Change: Point it at API keys.
- **SET-05** · decided
  - Today: The theme (next-themes `setTheme`) is only reachable from the command menu's Toggle theme, which flips light and dark. Nudge amount lives in the shortcuts drawer (`editor-preferences.ts`, 1–1000px, defaults 1 and 10).
  - Change: App menu › Preferences › Theme › Light, Dark, System theme, replacing Figma's Appearance…; no Settings page for it. Interact's Appearance stays separate: it sets the previewed design's color scheme. Preferences also gets Nudge amount…, a small dialog editing the same preference, with the code's description in a tooltip.

## Responsive layout (RESP, step 18)

- **RESP-01** · context
  - Today: Breakpoints are Framer-style: `designs.data.breakpointSet` holds design-wide widths (presets Desktop 1200, Tablet 810, Phone 390, or custom 320–3840). The inspector's Screen section shows breakpoint chips with an edit scope (This breakpoint and smaller / only), and the overview canvas adds the next of 390, 768, 1280 to all screens. Edits made while a narrower breakpoint is active become overrides automatically.
- **RESP-02** · context
  - Today: Overrides are written desktop-down at the frame's width minus one, as `max-[809px]:` classes or `@media (max-width: 809px)` rules aimed at `data-agent-native-node-id` in a managed style block. They don't follow the project's Tailwind breakpoints, and localhost write-back strips the node ids, so overrides on code-backed (React) screens have no home in source.
- **RESP-03** · context
  - Today: Tailwind check (2026-10-02): inline designs run `@tailwindcss/browser` ^4.3.3 (bundled by `local-runtime.ts`), and exports load `@tailwindcss/browser@4`. Container queries are built in: in headless Chrome against the bundled 4.3.3, `@md:` / `@max-md:` flip at a 448px container and a named `@container/card` with `@[480px]/card:` works. Code-backed apps bring their own Tailwind: v4 has container queries built in, v3 needs `@tailwindcss/container-queries`, and plain CSS `@container` works in every current browser.
- **RESP-04** · decided
  - Today: Clicking a frame's label selects the screen (`handleFrameClick`). The inspector shows the Screen section (source, URL, then the breakpoint chips), Position with the screen's W/H and a device-size picker (`ScreenSizePresetPicker`), Layout grids, then the body's Appearance, Fill, Stroke, Effects, and Export: two width concepts side by side.
  - Change: A frame is a frame. Select it from its label above the frame or its row at the top of Layers (LAYER-03), and the inspector shows the full frame inspector in the code's order, minus the breakpoint chips. W sets the width the frame renders at; dragging the selected frame's right edge resizes it with the layout reflowing live, snapping to width tokens (Alt skips the snap). There's no active-breakpoint mode and no edit scope.
  - Prototype: Click “Screen 1” above the frame or at the top of Layers, then drag the handle on the frame's right edge or set W.
- **RESP-05** · decided
  - Today: Nothing in the inspector binds a value to a token: W/H take numbers, and the device-size picker sets both from `FRAME_SIZE_PRESET_CATEGORIES`.
  - Change: W's chevron, in the inspector only, lists Container (3xs 256 … 7xl 1280) and Breakpoint (sm 640 … 2xl 1536) widths, from the design system's `--container-*` and `--breakpoint-*` tokens when it has them and Tailwind v4's defaults otherwise. Picking one binds it: W shows the token (2xl) instead of the number, the menu checks it, and Detach token (the first item while a token is bound, ⌫ while the menu is open), typing a number, or dragging the frame sets a raw width again. It's one choice, and the menu closes on pick. Device sizes, which set width and height together, are a separate picker on Position (INSP-08).
  - Prototype: Select the screen, then open W's chevron.
- **RESP-06** · decided
  - Change: Responsive rules live on the layer: the inspector's Responsive section lists rules as “Below {token}” plus a change (Stack, Wrap, One column, Collapse to menu, Hide, Text size, Padding), each showing its Tailwind class. A Container token queries the layer's parent (`@container` on the parent, `@max-3xl:grid-cols-1` on the layer); a Breakpoint token queries the frame (`max-md:hidden`). Rules travel with a component into code.
  - Prototype: Select a layer (the feature grid, the nav links, the headline) and use + in Responsive.
- **RESP-07** · decided
  - Change: Rules use the design system's width tokens, never arbitrary widths: `max-md:`, `@max-3xl:`, not `max-[809px]:`.
- **RESP-08** · decided
  - Change: The agent is the main author: Make responsive (Edit with Agent ›, the composer's /) reads the screen, writes the rules, checks the frame at 390, 768, and 1280, and proposes them for Apply.
  - Prototype: Edit with Agent › Make responsive, or /Make responsive in the Agents composer.
- **RESP-09** · decided
  - Change: Fixed widths become viewports to check, not modes to design in: Interact's device picker previews breakpoint-token widths, and the agent screenshots each one when it verifies a change.
  - Prototype: In Interact, the device picker sets the frame width (iPhone 16 renders at 393).
- **RESP-10** · proposed
  - Change: Migration: existing `max-[…]` classes and managed media rules keep rendering and stay editable in Code. The UI stops creating them, `breakpointSet` becomes the list of preview viewports, and the agent offers to convert old overrides to token rules or container queries.
- **RESP-11** · proposed
  - Change: Structural changes that rules can't express (a different component at small sizes) are component variants chosen by a rule, the way Figma Sites' responsive components switch variants.
- **RESP-12** · proposed
  - Today: The `responsive-breakpoints` skill teaches the agent the active-breakpoint model.
  - Change: Rewrite it for this model (rules on layers, container queries, token thresholds, checking at viewports); keep `add-breakpoint` / `set-active-breakpoint` for designs that already use breakpoints.
- **RESP-13** · question
  - Change: Direction: Design's base is the widest frame, so rules come out desktop-first (`max-md:`). Engineers usually write mobile-first (`md:` on the larger value). Emit desktop-first `max-*` variants as the prototype does, or flip the base to the narrowest width so the output is mobile-first?
- **RESP-14** · question
  - Change: Keep side-by-side linked frames of a screen at other widths (“Show at another width”), or rely on dragging the frame plus Interact's preview viewports?
- **RESP-15** · question
  - Change: Allow responsive rules on any layer, or only on components, so they always land in a component's source?

## Saving to code (SAVE, step 19)

- **SAVE-01** · context
  - Today: Edits on a URL screen are stored in Design first (the screen's persisted content). Simple JSX edits on React routes go straight to the route's file once you've allowed writes for that connection, a consent only a person can grant; ambiguous, repeated, or structural edits go to the agent instead of writing. Plain HTML routes write only when you press Apply to source, and a write refuses a file that changed on disk since it was opened (“Reload the screen and try again”). Nothing shows which edits haven't reached the files.
- **SAVE-02** · proposed
  - Change: One rule for every route: once writes are allowed, each edit saves to the route's file as you make it, HTML routes included. Apply to source goes away, button and string. This changes behavior, so it ships as its own PR (step 19), not with the UI steps; until then INSP-07 keeps Apply to source as a button beside the route control.
  - Prototype: Scenario: Local app screen. The route control's tooltip says edits save as you make them, and there's no save button.
- **SAVE-03** · proposed
  - Change: The status dot also says whether your code has every edit: green when it does, amber when some edits haven't reached the files yet (the app is down, writes aren't allowed yet, an edit is waiting on the agent, or a file changed on disk), grey when the app doesn't answer. Beside the route control's actions, a 10 unsaved button carries the design-wide count, the dot's tooltip spells it out (10 changes aren't in your code yet), and the canvas pill adds it while the app is down. Each screen with unsaved edits gets an amber dot in Screens, so ten edited screens are visible at a glance.
  - Prototype: Scenario: Local app, unsaved changes. Three screens have amber dots in Screens, and the toolbar shows 10 unsaved.
- **SAVE-04** · proposed
  - Change: With unsaved edits, the 10 unsaved button opens Review changes. On the left, the changed files sit in their project folders (the hierarchy a flat list loses), each with a shadcn checkbox and its added and removed line counts (+4 −4); the folder's checkbox selects or clears every file and shows the mixed state when only some are checked. Choosing a file shows its diff on the right, one file at a time: Modified with the file name, its counts and five-block bar, View file (opens it in Code mode at its first change, CODE-04) and Mention in chat, then the diff with one line-number column, gaps between separate hunks, light JSX coloring, and the changed words marked inside a changed line. The footer is one primary action, Save 2 files, which saves the checked files; the connection isn't repeated here, and the button is disabled while the app is down. A file that changed on disk after your edits (someone saved it in their editor) is never overwritten: it shows a warning in the tree, its checkbox is off and disabled, and its diff opens with one line saying the file changed on disk after these edits and saving now would overwrite that work, with Reapply my changes. Reapply replays the edits, which Design keeps as visual-edit intents, onto the newer file; only an edit that no longer fits goes to the agent. Retry connection says how many changes are ready. Unsaved edits are never dropped: they stay in Design, marked, until they're saved.
  - Prototype: Scenario: Local app, unsaved changes. Retry connection (the reload button), then 10 unsaved. Choose the /docs file for the changed-on-disk case; uncheck files or the folder to leave them out.
- **SAVE-05** · question
  - Change: When a file changed on disk, is Reapply my changes enough, or should the review also offer Overwrite the file and Discard my changes?

## Code mode (CODE, step 20)

- **CODE-01** · context
  - Today: Design already has a code workbench: a Monaco editor with tabs, breadcrumbs, and a status bar, a file Explorer, project search, quick open, and format on open. It reads two workspaces, the design's own files and each connected localhost app's repo. It's a left panel ("code") behind the build-time `SHOW_DESIGN_CODE_LEFT_PANEL`, the same switch that hides Tokens, so nobody sees it today.
- **CODE-02** · proposed
  - Change: With its Labs flag on (CODE-05), Code becomes the third mode in the top bar: Interact | Design | Code. It puts the workbench where the canvas is and hides the inspector, the floating toolbar, and zoom. The File panel lists Files instead of Screens and Layers: one root for the design's own files and one for the connected app, named like the top bar's route control. The top bar's center holds Go to file… with ⌘P, the workbench's quick open, and ⌘P opens it anywhere in Code. The rail's other panels (Agents, Tokens, Threads) work as in the other modes.
  - Prototype: Choose Code in the top bar. Scenario: Local app screen adds the app's files.
- **CODE-03** · proposed
  - Change: Restyle the workbench to the app's density instead of VS Code's: the file tree uses the Layers row (32px, 24px per level, the same disclosure chevrons and icons), tabs are 40px with the underline the share popover's tabs use, breadcrumbs and the status bar are 24px with 11px text, and code is 12/20 mono with line numbers in the muted color. Monaco's theme takes its colors from the app's tokens (`monaco-theme-palette.ts`).
- **CODE-04** · proposed
  - Change: Code shows unsaved Design edits (SAVE-03) where they'll land: an amber mark in the gutter on each unsaved line, the amber dot on the file's tab and its tree row, and a status bar item (3 changes not in your code) that opens Review changes. Review changes' View file opens the file in Code at its first changed line.
  - Prototype: Scenario: Local app, unsaved changes, then Code; or Review changes › View file.
- **CODE-05** · decided
  - Change: Code ships behind a `design.code` lab in `shared/labs.ts`, like Tokens (TOK-02): read with `useLab`, listed in Settings › Labs as Code, and leaving the build switch. With it off, Code isn't in the mode switch, and turning it off while in Code returns to Design.
  - Prototype: Review strip › Labs: Code, or Settings › Labs › Code.

## Color picker (COLOR, step 21)

- **COLOR-01** · context
  - Today: `DesignColorPicker` is a 252px popover: paint-type tabs, a 192px saturation and brightness field, the eyedropper beside hue and alpha with a current-color swatch, a Hex ▾ model pill (Hex, RGB, HSL, HSB) with an opacity %, then Document colors. It works in sRGB only and doesn't show the color you started from.
- **COLOR-02** · proposed
  - Change: Previous and New sit beside the hue and opacity sliders as one 36px swatch: New on top, Previous below. Clicking Previous restores the color and the mode it was written in; Esc does the same and closes.
  - Prototype: Select the headline, click its Fill, drag the field, then click the lower half of the swatch.
- **COLOR-03** · proposed
  - Change: One picker in every mode. The popover is 272px wide; the 248px saturation × brightness square, hue, opacity, eyedropper, and Previous/New look and work the same whatever the mode, so nothing has to be relearned. Mode is one property: Hex, RGB, HSL, HSB (sRGB) and Display P3, OKLCH (wide gamut). It changes only how the numbers read and which CSS the picker writes. The wide modes let the square reach Display P3, with one quiet dashed line where sRGB ends, and hovering New says when the color is outside sRGB: screens without Display P3 show the nearest sRGB color. Hue holds what the mode holds: in HSB-based modes it keeps saturation and brightness; in OKLCH the strip runs in OKLCH hue order and keeps lightness and chroma, so every hue reads equally light and the square's knob moves to wherever that color sits, as in Paper's picker.
  - Prototype: Open a Fill, switch Mode to OKLCH, pick a vivid green, and hover New.
- **COLOR-04** · proposed
  - Change: The picker opens in the mode the value is written in and writes that notation: #hex, rgb(), hsl(), color(display-p3 …), or oklch(); HSB writes hex. Switching to an sRGB mode maps a wider color into sRGB by keeping its lightness and hue and lowering chroma, and New shows the result before you keep it. The value rows use the inspector's own controls: the Mode select beside the opacity field, then one 24px field per channel and a copy button with its letter as the prefix (R G B, H S L, L C H, # for hex). Dragging a prefix scrubs that one channel, like the inspector's X and W: in OKLCH, dragging L lightens a color without its hue drifting. OKLCH keeps the chroma you asked for: a hue or lightness that can't hold it clamps it, and the next one that can gets it back. With DTCG storage (TOK-15) the mode becomes the color's `colorSpace`.
  - Prototype: In OKLCH, drag the L prefix: lightness changes and C and H hold.
- **COLOR-05** · proposed
  - Change: The inspector's picker adds Custom and Libraries tabs in one fixed-size cell; Libraries searches the design's color tokens, and picking one binds the fill to the token. The Tokens panel's picker has no tabs. When the fill is already bound to a token, the picker opens on Libraries with that token checked.
  - Prototype: Open a Fill and choose Libraries › Link: the fill reads Link.
- **COLOR-06** · decided
  - Today: The eyedropper button uses Tabler `color-picker`, which has no bulb and reads as a pen. Tabler has no other pipette.
  - Change: Use an app-owned eyedropper drawn on Tabler's grid (24px, 2px round strokes): a round squeeze bulb, a collar, and a slender tube with a fine tip, all on one diagonal axis and centered in the 24px box. It's the one exception to Tabler-only icons, and it lives with the app's other icons so the next change finds it.
- **COLOR-07** · proposed
  - Change: A copy button ends the channel row and copies the color as CSS in the current mode (oklch(54.1% 0.183 256.5), color(display-p3 …), #hex); its tooltip shows exactly what it copies. Any CSS color pasted or typed into any channel field is read as the color and shown in the current mode.
  - Prototype: In OKLCH, paste #0a6bd6 into L, then click copy.
- **COLOR-08** · proposed
  - Change: With the Tokens lab on, the inspector picker's header has + (Create a color token from this color). It opens Libraries with a named draft row at the top holding the current color; Enter or leaving the row creates the token (--color-<name>) and binds the fill to it, and Esc drops the draft without closing the picker.
  - Prototype: Open a Fill, click +, type Brand blue, and press Enter: the fill reads Brand blue and the Tokens panel lists it.
- **COLOR-09** · decided
  - Change: Every edge sits on the 8pt grid. The popover is 272px with a 12px inset and one 248px column: the 248px square; the slider row is eyedropper 24 · 8 · two 16px tracks of 168 · 8 · a 40px Previous/New swatch (two tracks and their gap); the value rows share columns 64 · 64 · 64 · 32 with 8px gaps, where Mode spans the first two and opacity the last two, L · C · H (or hex across three) sit beside copy, a 24px icon button centered in the trailing 32 like the inspector's; document colors are 8 × 24px with 8px gaps. Slider knobs are 16px, the track's height, and travel from 8px to width − 8px so they never leave the track; each is filled with its value (the hue, or the color at its opacity over the checker), and the track's gradient maps onto that travel so the color under the knob's center is the value.
  - Prototype: Drag opacity to 100%: the knob stays inside the track, filled with the full color.
- **COLOR-10** · proposed
  - Change: On a text layer's fill, the header gets an Aa button beside +, styled like it and the same in every state; its tooltip gives the WCAG 2.2 ratio on what's behind the text (rounded down, so it never overstates). Clicking it opens a menu with no label row: Fix for AA and Fix for AAA, each showing its status on the right (Passes, or Needs 3:1 / 4.5:1 / 7:1 for body or large text, which is 24px or 18.66px bold) and off once met, then Ask Agent to fix contrast, which hands the agent the text, background, ratio, and target so it can fix the same pairing on every screen. A fix moves OKLCH lightness to the passing value nearest the current one, keeping hue and chroma, and steps past rounding so the value as written in the current mode (a hex code, say) still passes. Each action sits next to what it acts on: eyedropper by the sliders, copy by the value, + and contrast in the header, and swapping on the Fill field (COLOR-11).
  - Prototype: Select the headline, open its Fill, type AAAAAA, click Aa, and choose Fix for AA: it lands on 949494, which still passes when retyped.
- **COLOR-11** · proposed
  - Change: The inspector's Fill field gets a ▾ like W's width tokens (RESP-05): the design's color tokens with their values, to apply or to swap to, with Detach token first on ⌫ while one is bound. Swapping keeps the fill bound; detaching keeps its color as a plain value. A bound fill shows the token as a chip in the field, beside its swatch.
  - Prototype: Open the Fill's ▾ and pick Link, then pick Primary, then press ⌫ with the menu open.
