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
  - Change: Zoom stays in the same spot in both modes and keeps its value. The route stays exactly centred from 1200px wide; below that it takes the leftover middle (120–264px) and presence avatars hide.
- **TOP-06** · decided
  - Change: In Design, the Screens panel picks the screen; routes and device sizes are Interact concepts.
- **TOP-07** · proposed
  - Change: Local app screens: Interact's route picker shows the localhost URL; Design shows Apply to source beside zoom.
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
- **MOVE-03** · proposed
  - Today: The localhost link and Apply to source sit in `rightSidebarActions`.
  - Change: The localhost link moves into Interact's route picker; Apply to source sits beside zoom in Design.
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
  - Change: Single layer (Figma 1834:719, shortcuts from `CanvasContextMenu.tsx`): Edit with Agent…, Send to ›, Copy, Paste to replace, Copy/Paste as › (Copy link to selection first), Rename, Frame selection, Add auto layout, Create component, Hide, Lock, Arrange ›, Transform ›. A component instance swaps the creation actions for Go to main component, Swap instance ›, Detach instance.
- **MENU-04** · decided
  - Today: Boolean operations: only Subtract (⌥⇧S) is implemented.
  - Change: Multiple layers (Shift-click): Edit with Agent…, Send to ›, Copy, Paste to replace, Copy/Paste as ›, Group selection, Frame selection, Add auto layout, Boolean operations › (Subtract only), Hide, Lock, Arrange ›, Transform ›.
- **MENU-05** · decided
  - Change: Empty canvas (Figma 1826:562): Paste here, Explore with Agent…, Send to › (the screen), Copy link to screen, Show UI, Show comments. Layer row: Copy, Copy link to selection, Rename (in place), Hide, Lock, Arrange ›, Transform ›, with LayersPanel's shortcuts.
- **MENU-06** · decided
  - Change: Edit with Agent… is the first row, styled like every other row (no tinted agent row). Clicking it opens the agent composer; its submenu is the Agent actions card (Figma 1826:562): Inspiration, Polish, Debug, Generate states, Make responsive, each with a one-line outcome.
- **MENU-07** · context
  - Today: Arrange and Transform commands: Bring to front ], Bring forward ⌘], Send backward ⌘[, Send to back [, Align left/right/top/bottom ⌥A/⌥D/⌥W/⌥S, Tidy up ⌃⌥T; Flip horizontal ⇧H, Flip vertical ⇧V, Swap fill and stroke ⇧X. (Figma's submenu card repeats instance rows as placeholders.)
- **MENU-08** · proposed
  - Change: The Agents composer + is Figma's “MVP Add context menu (prompt bar)” (2261:2104): Search…, Upload file, Attach Figma…, Reference a design….

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
  - Change: Tokens ships behind a `design.tokens` lab in `shared/labs.ts` (like `DESIGN_TWEAKS`), read with `useLab` for the rail item and listed in Settings › Labs. It leaves the build switch; Assets, Tools, and Code keep it.
  - Prototype: Toggle “Labs: Tokens” in the review strip or Settings › Labs.
- **TOK-03** · proposed
  - Change: Tokens is a rail item (after Agents) and a left panel on the shared 16px row strip: groups Colors, Typography, Spacing & Layout, Radius, Shadows & Effects, Other, each collapsible. A row is swatch or type glyph, name, and value; hovering shows the source.
- **TOK-04** · proposed
  - Change: Click a row to edit its value in place (Enter saves, Esc cancels). The color swatch opens the system color picker. Edits restyle the canvas live, like `apply-design-token-edit`.
- **TOK-05** · decided
  - Today: One create popover: Add one token is a CSS-variable field and a value field that defaults to `#000000`, and `classifyVar` guesses the group from the name and value.
  - Change: + Add token is a Nova menu of token kinds in the panel's group order: Color · Font family, Font weight, Font size, Line height, Letter spacing · Spacing, Container, Breakpoint, Radius · Shadow, Opacity. A kind adds a draft row at the end of its group with the kind's prefix and a starting value (Font size → `--font-size-`, 16px), stored with that type; Enter moves to the value, Enter or clicking away saves, Esc cancels.
- **TOK-06** · proposed
  - Today: The code's token types are color, typography, spacing, radius, shadow, motion, other.
  - Change: Container, Breakpoint, and Opacity are new kinds. Spacing becomes “Spacing & Layout” to hold Container and Breakpoint; Opacity lands in Shadows & Effects.
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
  - Change: Keep the Container, Breakpoint, and Opacity token kinds (TOK-06), or trim the + menu to the types the code has?
- **TOK-18** · proposed
  - Change: The token panel's strings get localized (en-US plus the 11 locale files) when it leaves the build switch.

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
  - Change: Agents use Tabler `sparkles` everywhere: the rail item, the toolbar's Agent button, Edit with Agent…, Explore with Agent…, and the agent actions. The Polish skill moves to `wand` so it doesn't share the agent mark.
- **RAIL-15** · question
  - Today: The Agent panel has a 320px minimum width (`activeLeftPanel === "agent" ? 320 : 220`).
  - Change: Should the Agents panel keep a 320px minimum when every other left panel starts at 232px?
- **RAIL-16** · proposed
  - Today: The Figma Navigation page notes on the collapsed rails (646:5188, 1850:8474) still say 72px.
  - Change: Update them to 56px and the Figma rail button.

## File header (FILE, step 7)

- **FILE-01** · decided
  - Today: The title is click-to-rename, beside a minimal-UI toggle; the project menu holds Back to designs, Save as template, Version history, Export, Edit, View.
  - Change: The file name opens the Design file menu from Figma: Rename, Duplicate, Version history, Save as template…, Export…, Move to trash.
- **FILE-02** · decided
  - Change: Under the name, a ghost button reads “Designs” and goes to /home. No arrow: the label sits flush with the file name, and the hover fill extends 4px past it.
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

## Outside agents (AGT, step 17)

- **AGT-01** · context
  - Today: Every Agent-Native app mounts a remote MCP server at `/mcp` (OAuth 2.1); calls run as the signed-in user under the design's sharing rules, so a link works from any machine. Design's connector allowlist is `EXTERNAL_CONNECTOR_TOOL_NAMES`.
- **AGT-02** · proposed
  - Today: Nothing copies a link to a layer or screen.
  - Change: Copy link to selection is the first item in Copy/Paste as › on a layer or multi-selection and sits after Copy on instances and layer rows; the empty canvas gets Copy link to screen. Links carry scope: `/design/<id>?screen=home&node=hero-title` (comma-separated nodes). Opening one selects the layers and zooms to them.
- **AGT-03** · decided
  - Today: Content's share popover has People and Agents tabs (`peopleTabLabel` / `agentsTabLabel`); the toolkit `ShareButton` popover takes `agentTabContent`.
  - Change: Share is that popover with People and Agents. Both panes share one grid cell, so switching tabs never resizes it. 24px controls, 32px rows, 12/16 text. No Social, Embed, password, or expiry (Clips-only).
- **AGT-04** · proposed
  - Today: The toolkit's general access options: Only people with access can view, Anyone in your organization can view, Anyone signed in with the link can view.
  - Change: People: an invite field with the role inside it (Viewer ▾) and a send button, Who has access (owner, people with role menus), general access, then Copy link pinned to the bottom.
- **AGT-05** · decided
  - Change: Send to › sits under Edit with Agent… on layers, instances, and multi-selections (the selection) and under Explore with Agent… on the empty canvas (the screen). One list of destinations, grouped Agents, Apps, and Channels, then Copy agent prompt and Manage destinations… (Settings › Integrations). Share › Agents shows the same list.
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
