# Changelog

All notable user-facing changes to Design are documented here. Open it any time
from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-08-18

### Improved

- Design chat keeps context out of the composer and uses shorter completion summaries.

### Changed

- Advanced Design editor panels are hidden by default while they are refined.

## 2026-08-13

### Added

- The design audit now catches a screen that renders behind a full-frame Alpine overlay — the failure a screenshot cannot show, because the capture waits for Alpine to settle and the overlay is gone by then.
- The design audit now reports when a screen uses none of its linked design system's fonts, colors, or token names.

### Improved

- Attach a UI screenshot and the design is reproduced from it instead of being reinterpreted as three alternative directions.
- The design system preview now shows how many named tokens were captured, so a large imported system no longer looks like a handful of colors.

### Fixed

- A screen whose Alpine overlay would cover it on load — `x-cloak` without its hiding rule, or a broken Alpine script URL — is now caught when it is saved instead of shipping as a blank or covered design.
- Linking a design system means you never get generic direction cards: exploring variants without real HTML is now refused for that design rather than rendering placeholder screens that ignore your tokens.
- Your design system, original prompt, and reference screenshots now reach the turn that actually generates the design, instead of being spent on the questions step.

## 2026-08-12

### Improved

- Shared designs now keep viewers read-only and let commenters add review comments without editing the design.

## 2026-08-11

### Improved

- Design sharing now identifies viewers who can add review comments
- New designs now skip the intake questions and follow your existing work when Creative Context already holds closely related pieces.

### Fixed

- Chrome no longer offers to install Design as a desktop app.
- Design agent prompts copy successfully in the desktop app.

## 2026-08-10

### Improved

- The frame tool draws a plain frame by default, with Screen available in its dropdown

### Fixed

- Marquee-selecting layers far down a tall screen now selects the layers you dragged over

## 2026-08-07

### Improved

- Design cards now show who created each design, with a filter by creator when your workspace has more than one person.
- Hold Option/Alt while dragging a frame on the overview canvas to drop a copy of it, including a whole multi-frame selection.

### Fixed

- Alt-dragging an element to copy it now keeps the copy visible on the canvas instead of only adding it to the layer list.
- Cmd+C now copies selected text in the agent panel instead of being captured by the canvas copy shortcut
- Drawing a shape on the overview canvas now keeps the shape selected instead of its screen, so duplicating copies the shape rather than the whole screen.
- Real-time voice can now read the current selection and edit the design, instead of failing to verify the agent thread

## 2026-08-05

### Improved

- Renaming a layer now focuses its name field automatically.
- Website URL imports now capture hydrated browser-computed design systems for more faithful reuse.

### Fixed

- Chat attachments now warn before upload when they exceed the 4 MB total limit, instead of failing with an unexplained error.
- Deleting a design from the home page no longer leaves the app unresponsive.
- Design token imports classify typography dimensions correctly.
- Figma .fig uploads now show a clear 4 MB limit up front instead of failing partway through the upload.
- Missing design systems now return a clear not-found response.

## 2026-08-03

### Improved

- Arrow keys now reorder a layer inside an auto layout or grid frame the way Figma does, and nudge free-placed layers by an amount you can set in the Cursor tab of the keyboard shortcuts panel.
- Auto layout flow icons show the direction at a glance instead of needing a hover.
- Auto layout icons share one outlined-square style, so flow, gap and padding read as one set.
- Export has a named Preview section you can expand, replacing the unlabeled image icon.
- Inspector sections show an expand indicator, so it is clear which ones open.
- Pasting with a frame selected now places the copy inside that frame, joining its auto layout when it has one, while pasting with an object selected still places the copy beside it.
- The add-breakpoint button sits outside the breakpoint selector, so it no longer looks like a breakpoint you can pick.
- The agent's follow-up questions share the chat panel's background, so they read as part of the conversation.
- The text tool uses a T icon, matching the letter it inserts.

### Fixed

- Design token indexing now skips malformed saved token values instead of crashing
- Export preview shows the selected element instead of the whole screen, with its real pixel size.
- Stale design links now return a not-found response instead of a server error
- The agent's follow-up questions keep space below the Continue buttons instead of pinning them to the bottom edge.
- The Agent sidebar now links to the full Agent workspace so its context, resources, connections, automations, and access tabs remain reachable.
- The export panel no longer stacks a duplicate Export block on every inspector update.
- Screens no longer blink out and back in while zooming a multi-screen canvas.

## 2026-08-01

### Added

- Review comments, replies, and mentions now send an email to the people involved

## 2026-07-31

### Improved

- Clicking the Agent Native logo now toggles the app sidebar.

### Fixed

- Design-system indexing keeps your chosen name when you upload a Figma file and shares new organization systems with teammates.

## 2026-07-30

### Improved

- Design HTML is now validated with a spec-grade HTML parser instead of hand-rolled scanning, so markup inside attributes and scripts is no longer mistaken for real tags.
- Designs now load their Tailwind and Alpine runtimes from the app itself instead of a public CDN, so an ad blocker, a restricted network, or being offline cannot leave every screen unstyled.

### Fixed

- A broken inline script in a generated screen is now caught on save instead of silently never running.
- Designs with a broken Alpine expression are now caught on save instead of rendering with every interaction silently dead.
- Editing a design no longer strips its styling: the canvas now keeps the page's compiled CSS instead of discarding it on every update.
- Fixed the keyboard shortcuts panel not opening with Ctrl+Shift+? on macOS, inside the canvas, or during agent question flows

## 2026-07-29

### Added

- Copy rendered UI between live local apps and Design files while preserving source locations and styles.
- A selected frame's size is now editable, with a device-preset picker on the Size section, so an existing frame can be set to a phone, tablet, or desktop size.

### Improved

- An edit that cannot be written to source now names the reason — repeated instances, a client-rendered screen whose served HTML has no app markup, or source that has not finished loading — instead of reporting the selected element as missing.
- Auto-layout direction buttons now show a direction arrow, so the flow direction is readable without hovering for the tooltip.
- Selecting layers and adding frames are faster: the layer projection is reused for unchanged screens and creating a frame no longer refetches every screen's contents.
- Canvas zoom now steps about 10% per mouse notch like Figma instead of nearly tripling, and frame labels hold a constant size throughout the gesture instead of scaling and snapping back.
- Added Figma-parity shortcuts: A also picks the frame tool, Shift+Cmd+G ungroups, and Shift+0 resets zoom to 100%.
- Localhost source errors now say what actually went wrong — which connection, which workspace, or that the bridge needs reconnecting — instead of a generic failure.
- The breakpoint + menu keeps offering device widths after the default Desktop, Tablet, and Phone breakpoints are added, instead of falling back to a bare number input.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.
- The Code panel and Apply design update control now use clearer, more compact editor chrome.
- The Tools panel now keeps extension creation and discovery hidden unless explicitly enabled.
- Visual edits on a mapped component instance now tell the agent where that instance was rendered from, not just which React key it had.

### Fixed

- Applying a primitive dropped onto a connected localhost screen no longer fails with an anchors-still-loading error.
- Adding a breakpoint now re-packs the board when the new frames would overlap a neighbouring screen, and the add control says it applies to all screens.
- Changing a style in the inspector now updates a connected local app immediately and queues the edit for Apply design updates
- Choosing Edit or Annotate from a focused screen now returns to the infinite canvas instead of leaving the screen stranded, and Interact hides the canvas toolbar it does not own.
- Concurrent source edits now return a clear conflict response instead of an internal error.
- Creating a component from an element that repeats in the source now names the conflicting match count instead of annotating whichever instance came first.
- Deleting an element you just dropped onto a live screen no longer leaves it queued to be re-added when changes are applied to source.
- Design boards stay dark and viewport-height content keeps its intended device size.
- Design frames no longer grow continuously when their content uses viewport-relative height.
- Double-clicking a frame now selects the layer under the pointer so its styling options open, instead of switching the editor into Interact.
- Dragging a layer across screens no longer dies when the pointer crosses into a live localhost screen, and drops onto plain block-layout pages now resolve a target instead of silently failing
- Dragging an element from a stored screen into a live localhost screen is now handed to the coding agent as a move instead of being silently copied in as new markup.
- Drawing a box on the canvas and dragging it into a connected localhost screen now inserts it into the running app, with undo, redo, and Apply.
- The inspector's export preview now shows the actual rendered output instead of a plain coloured rectangle, and says so when it cannot render.
- Fixed a loading-screen flicker when reopening designs with an in-progress generation.
- Interact mode has Edit and Annotate buttons again, so you can leave a responsive preview straight into either canvas mode.
- Layer groups can be dropped onto live localhost screens without corrupting the screen URL.
- Opening or refreshing a live localhost screen in single-screen view no longer blanks the running app and its layer list.
- Redo after undoing a drop onto a live screen puts the element back instead of silently doing nothing.
- Shapes can now be drawn directly onto live localhost screens while keeping the screen connected to the running app.
- Shapes drawn on the canvas board now appear immediately instead of only after a page reload, so you can draw one and drag it straight into a screen.
- Style edits on a running localhost screen now preview live and queue for the agent with their React source anchor, instead of silently disappearing when the element's runtime id goes stale.
- The text tool now reaches the board's own editing surface, so a text box you draw on the canvas can be typed into immediately, and boxes left empty are cleaned up instead of lingering invisibly.
- The Apply design updates control now appears as a clean, connected split button

## 2026-07-28

### Added

- Interact mode now shows a responsive device preview with presets, editable width/height, and zoom-to-fit, alongside the usual panels

### Improved

- Design edits can be applied through the host coding agent from an inline MCP canvas
- Figma .fig uploads now show indexing progress and an Open in Builder link to the generated project once decoding finishes.
- Layer hide and lock now apply to the live preview instead of only the layers list
- Locked layers now show a subtle dashed outline in the live preview so a locked layer is distinguishable from an unlocked one.
- Show or hide Design editing chrome from Cmd+K, the canvas menu, or Figma's Shift+\ shortcut.
- Visual edit on a local dev server no longer requires signing in

### Fixed

- Deleting a selected element now removes it from the live preview
- Deleting an element on a connected localhost screen now queues a pending live edit, so the deletion reaches app source and Cmd+Z takes it back.
- Generated design variants no longer overlap each other on the overview board, and zooming or panning a board with breakpoint frames no longer flashes screen content
- Generated designs with malformed HTML are now rejected at save with the exact line and character to fix, instead of persisting and rendering broken.
- Layers-panel selections on a connected localhost screen can now be deleted with Delete or Backspace.
- Apply design update now includes pending live text and structure edits, so deletions are applied with the rest of the session changes
- The design canvas no longer stalls on a render loop while a design is loading
- The model you pick when starting a new design is now used for the design's first generation turn instead of falling back to the default model.
- Visual edit now always shows the live running app in the canvas instead of a frozen HTML snapshot
- Visual edits on a React 19 app no longer report a source line that is really the dev server's transformed line — anchors now say whether a position is authored or transformed, and the deterministic writer refuses a transformed one instead of editing the wrong element.

## 2026-07-27

### Improved

- The collapsed sidebar keeps the Agent Native logo visible and removes the theme toggle from the sidebar.

## 2026-07-26

### Improved

- Apply design updates from a centered top toolbar without covering the canvas tools

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

### Fixed

- Design edits now retry safely when another collaborator changes the file.

## 2026-07-24

### Improved

- AI designs now default to a full-size desktop + mobile pair (Framer-style breakpoint frames) instead of duplicated desktop/tablet/home device frames
- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Design frames now fill the viewport height and grow to fit their content at each breakpoint width, so mobile and tablet frames no longer clip below the fold
- Sidebar utility controls now follow a consistent footer order.

### Fixed

- Generating an additional screen now places it beside the existing screens instead of stacking it on top at the same coordinates

## 2026-07-23

### Improved

- Agent settings are clearly labeled Manage agent in the sidebar.

## 2026-07-22

### Added

- Fill a no-token Figma paste's images by dropping the original .fig file — no Figma token or API quota needed.

### Improved

- Manage agent navigation now uses the connected-nodes icon.
- Narrow breakpoint previews keep their device labels readable
- Responsive peers now use a softer selection highlight without resize handles.
- Rotate selected elements from the canvas context menu with an instant-open menu.
- View-only designs now support Figma-style layer inspection without edit handles or drag controls

### Fixed

- Connecting a Figma token now actually fills in a pasted design's images (placeholders were previously left unresolved).
- Design owners can keep editing their designs after switching workspaces
- Figma line/arrow vectors and stroked icons now render instead of vanishing — fixed clipping of strokes and zero-size line vectors.
- Imported and pasted Figma frames now render faithfully — fixed off-canvas layers, collapsed groups, and over-clipping that could turn a frame into a black box.
- Inspector tabs keep their text labels at narrow widths
- Responsive breakpoint controls stay within narrow sidebars
- The selection outline now stays attached while moving screens

### Removed

- Removed the Draft status chip from the design editor.

## 2026-07-21

### Improved

- Upload a .fig file alongside a Figma frame link to import only that frame — no API quota needed, embedded images included. API rate-limit errors now suggest clipboard paste or .fig upload as no-quota alternatives.

## 2026-07-20

### Added

- Paste Figma frames directly onto the canvas — no token needed; connect Figma anytime to fill in images.

## 2026-07-17

### Added

- Resources can be added to Creative Context from their action menus.
- You can add exact, approved artifact versions to governed Creative Contexts for safe reuse.

### Improved

- Library now flags published designs with newer versions and lets you submit the update in place.

### Fixed

- Drawn shapes now land exactly where and how big you dragged them — they no longer snap to center, get trapped inside a container, or stretch into a tall ribbon.
- Shapes now show a live outline while you drag to draw them, even when drawing over an existing screen.

## 2026-07-16

### Added

- The Agent workspace now includes a Library for reusing verified creative context, including version-pinned Figma designs cloned as editable HTML/CSS without regeneration.

### Improved

- Design editing and review are now more predictable, with selection-based regeneration, clearer candidate approval, accurate layer comments, smarter agent prompts, and cleaner template behavior.

### Fixed

- Design agent chat now stays inline with the editor rail without a separate Chat or Workspace header.

## 2026-07-15

### Improved

- Viewer comment controls now sit inside the read-only notice instead of floating over the canvas.

### Fixed

- Prototype print and download buttons now work in preview
- Templates now open immediately after copying, even while the designs list refreshes.

## 2026-07-14

### Improved

- Templates now appear in the New Design picker with previews, linked design systems, and clear built-in labels.

### Fixed

- Reviewers can now pin comments from the canvas toolbar, target selected layers, and only see actions they can use.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place
- Reviewers can pin comments on shared designs and apply verified feedback through the agent

### Fixed

- Adding a shape to the overview canvas no longer changes the canvas background color.
- Clicking quickly between overlapping elements no longer makes the selection outline bounce before settling
- Design navigation links now support opening in a new tab.
- Design session replays now include activity inside the preview canvas and presentation frames.
- Dragged Design assets now appear at the visible drop location inside the target screen.

## 2026-07-11

### Improved

- Canvas context menus now open without motion jitter.
- Inspector tooltips appear instantly as you sweep across icons, and panel sections animate open and closed

### Fixed

- Designs, templates, design systems, and presentations now show a clear retry action when loading fails.

## 2026-07-10

### Added

- Ask chat what's in a Figma file or frame (structure, screenshot, components) without importing it
- The canvas now shows a live size readout while you draw, and holding Option while hovering another element shows the distance between them.
- Designs can now be copied or downloaded as editable Figma-ready SVG using the live rendered screen.
- Download all screens as one multi-page PDF from the overview export menu
- Figma links in chat and the Import tab now offer secure one-step connection and frame import.
- Frame tool now offers standard ad-unit size presets (Medium Rectangle, Leaderboard, Skyscraper, Mobile Leaderboard, Billboard)
- Local visual edits can now preview and save safe leaf text, class, and style changes directly to connected React source files.
- Save reusable Design templates with fixed dimensions and locked layers, then start a new design from a template and refine it with a prompt.
- Start designs from source-linked Material 3, Carbon, or Primer production systems.
- Uploaded .fig files can now become editable Design screens with safe image handling and clear fidelity warnings.

### Improved

- App workspaces now use clean, borderless main surfaces throughout.
- Editor panels are easier to distinguish, and design-intake questions stay visible while choosing options.
- Successful `.fig` imports stay compact while actionable file conversion warnings remain visible.
- Local visual editing now keeps authenticated sessions shared across screens, freezes app motion while editing, blocks accidental navigation, hides reload flashes, reliably redoes structure moves, and verifies React source changes in a fresh runtime before finalizing their flow or absolute layout behavior.
- New designs can open directly in the editor without requiring a prompt.
- New web designs open at desktop size and adapt across mobile and tablet breakpoints.
- Preview and apply inferred auto layout without changing your design until you approve the measured direction, order, spacing, alignment, and sizing.
- Screen overview frames now use a clearer Interact action with the matching toolbar icon.
- Short hex colors now expand like Figma when committed.
- Tweaks now explain how breakpoint- and state-specific overrides layer onto the base design and can be reset.
- Tweaks now explain how responsive and state overrides work and link to full documentation.

### Fixed

- Canvas edits now reject malformed HTML before it can corrupt a screen, and reconnect warnings only appear for real connection failures.
- Complex designs now export as valid, secure SVGs and crisp raster/PDF files, and undo can restore the design from before an agent redesign.
- Complex Figma masks, arcs, rich text, transformed images, and advanced strokes now preserve their appearance with explicit fallbacks instead of importing incorrectly.
- Concurrent agent and artboard edits no longer show misleading HTML error popups when an unsafe merge is rejected.
- Copied layers and screens now paste faithfully after switching designs or browser tabs.
- Copying design text now pastes readable text into other apps instead of internal HTML.
- Deleted screens can be restored with Undo and removed again with Redo
- Design changes now save before switching apps and retry when you return
- Design stays usable on phones by keeping editor panels and floating tools from covering chat and other controls
- Designs with HTML examples inside Alpine attributes or comments can now be edited without false integrity errors.
- Drawing annotations now stay available to retry when the agent chat cannot accept them, and repeated Send actions no longer duplicate the request.
- Duplicated layers now keep labels, ARIA relationships, fragment links, and SVG effects attached to the copy.
- Duplicating a design can no longer produce a copy with missing screens if something fails mid-copy
- Figma imports now load real fonts, fix rotated/gradient/dashed-stroke rendering, and no longer misclassify ordinary multi-line text as unsupported
- Fixed Cmd+Z not restoring content after an agent-driven design change when no live collaboration session was active
- Fixed Download PDF being unreachable from the export panel even though PDF export was fully implemented
- Fixed dragging a layer out of an auto-layout row/column no longer leaves stale flex sizing/alignment on it
- Fixed the Figma SVG export so multi-line text keeps its wraps, the exported document matches the screen's real size instead of an oversized canvas, and exporting a selected inner layer no longer fails.
- Fixed hiding or locking one layer no longer hides or blocks every other layer of the same kind
- Fixed PNG screenshots of tall screens being cropped to one viewport height instead of the full page
- Fixed PNG/SVG exports capturing broken layout when webfonts or Tailwind styles hadn't finished loading yet
- Full-view controls stay within their frame instead of covering nearby screens
- Hover, focus, focus-visible, pressed, and disabled states now preview and edit reliably across responsive and local code-backed screens.
- Interact mode now stays on the full canvas, matches Edit visuals, and selects nested elements directly.
- Interactive designs no longer appear blank in the canvas when an update introduces new scripts.
- Layer drops now land in the intended grid row, stay visually fixed through rotated or scaled parents, and undo Ignore Auto Layout atomically.
- Local Code workspaces now keep unsaved edits across panel switches and can save safe text files from the connected folder.
- Long overview editing sessions (lots of pan, zoom, screen switching, and edits) no longer accumulate excess memory over time
- Long-running agent work no longer shows a premature stuck warning or repeats work after Retry.
- Design now recognizes a securely managed Figma connection automatically instead of asking for another token.
- New screens are selected and brought into view immediately after creation, duplication, or redo.
- New text layers now undo as one safe creation without distorting the frame or leaving empty layers behind.
- Print PDF exports and paper-size presets (Letter, A4) now match true physical page dimensions and print at a sharper resolution
- Rapid breakpoint and edit-scope changes no longer jump back to an earlier responsive selection.
- Responsive breakpoint previews stay visible while panning across the Design overview.
- Responsive breakpoint frames are directly editable, show their edit scope, keep generated variation groups separated, and clearly include variants when deleting a screen.

### Security

- Rich Design clipboard markers are now accepted only from the current browser installation.

## 2026-07-09

### Added

- Typography properties now include underline, strikethrough, and text case controls.
- Component instances can now be detached (⌥⌘B) into plain, independently-editable elements.
- Export any design screen as a real vector SVG for Figma, with copy-to-clipboard and drag-import support
- Import Figma frames as pixel-accurate Design screens via a shared file/branch link
- The Component inspector panel and canvas context menu can now jump to a component's earliest instance ("Go to main component").
- Keyboard shortcuts are now discoverable in a Figma-style bottom panel from the app menu or Ctrl+Shift+?.
- Right-click overlapping or nested objects to choose the exact visible unlocked layer from a Figma-style Select layer submenu
- Component instances can now be swapped for a different component from the design, keeping matching prop overrides.

### Improved

- Drawing annotations sent to the agent now include a rendered screenshot with the drawing composited on top, not just coordinates
- Editor sidebars now use Figma-matched default widths for a roomier, more familiar canvas.
- Figma-style shortcuts, drawing annotations, and cross-screen drag interactions are now faster and more reliable.
- Inspect Code now hides internal styling metadata and wraps long attribute lists for easier reading.
- Local preview URLs now live in the inspector instead of taking space above the canvas
- Local React layers now keep exact source provenance and support safe same-screen reorder, reparent, group, ungroup, and Auto layout editing through the coding agent.
- Paste from Figma (Cmd+V) now imports exact, editable nodes when possible, with a clear fallback and hint when it can't
- Screen rows can now be reordered in Layers with matching canvas stack order, undo, and persistence.
- Screen selection stays responsive in designs with hundreds of screens and thousands of layers.
- Shift+A now enables Auto layout on a selected screen with flash-free undo, redo, and persistence.

### Fixed

- Annotate now draws across the All Screens canvas without switching views or reloading screen previews.
- Auto-layout children can now be dragged into freeform screens, other layouts, and absolute frames without jumping or losing their position.
- Board shapes now stay visible and nest correctly across the All screens canvas without iframe flashes.
- Component source navigation now opens reliably from the inspector and component interactions.
- Cross-screen local React layer moves now hand off exact source anchors safely instead of silently refusing the drop.
- Cross-screen moves, undo, and redo now keep both screens stable without preview flashes or lost selection
- Design edits, canvas positions, tools, and tab context now persist reliably across navigation and reloads.
- Dragging layers into auto layout now respects Ignore auto layout and stays visually stable during reparenting
- Empty frames and rectangles now expose full Auto layout controls, and promoted containers show the correct Layers icon.
- Grid auto layout now uses true responsive rows and columns with track sizing, independent gaps, and fluid canvas reordering.
- Hand and Scale tools now keep their active toolbar identity and show their keyboard shortcuts.
- Hidden and locked screens now behave consistently between Layers and the overview canvas.
- Image fills now preserve valid URLs and layered fit settings across page and layer edits.
- Inspector effects preserve sibling filters and fractional values, linking padding no longer overwrites asymmetric sides, and mixed layout or constraint selections now display honestly.
- Large multi-screen designs now stay responsive during long canvas sessions without accumulating hidden previews.
- Layer drags now land exactly where the insertion indicator shows, including multi-selection reorders.
- Layer selection now keeps Cmd or Ctrl toggles and Shift ranges intact in All screens view
- Layers dropped into Auto layout now participate correctly in ordering, spacing, and alignment.
- Local live-edit screens now enter and leave Full view without blank, URL-only, or duplicate-loading flashes.
- Local React layers can now be hidden and locked from Layers with source-backed persistence.
- Local React visual editing now loads reliably and shows live component layers with exact development source locations.
- Pressing Escape after selecting a screen now reveals Page properties instead of immediately reselecting the active screen.
- Scale, edge, stretch, and center constraints now preserve layer geometry when nested or auto-layout frames resize

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

### Fixed

- Design generation now follows hydrated Builder design-system guidance before creating screens.
- Local images added to designs now upload to file storage instead of being saved as inline data URLs.

## 2026-07-07

### Improved

- Local visual edit uses live app iframes for click-to-edit previews before applying changes.

### Fixed

- Dragging a free-floating element into a layout column or row no longer leaves it stranded far from the drop point; it now lands cleanly in the indicated slot.
- Dragging a repeated list item (like a to-do card generated from data) now shows a clear "Can't reorder repeated items" message instead of silently snapping back after the drop.
- Dragging an element onto a button or chip's middle no longer merges it inside the button's label; it now reorders as a sibling like other layout containers.
- Elements dropped into another board shape now stay exactly where you dropped them, render inside their parent, and previously misplaced nested elements are repaired automatically
- Fixed drag-reordering elements within a screen no longer silently loses edits after the first one when a reload happens shortly after
- Fixed dragging an element from a screen onto the canvas now drops it exactly under the cursor instead of drifting away
- Fixed dragging elements between screens into AI-generated content no longer corrupts the layout by landing inside hidden template markup
- Fixed moving elements between screens no longer bakes internal editor styling into the design's HTML
- Fixed the cross-screen drop indicator now points at the correct spot for duplicated or newly created screens
- Fixed the zoom menu no longer leaves the canvas unresponsive to clicks and scrolling after choosing a zoom preset
- Local visual edit keeps bridge access when opening previously connected localhost apps
- Local visual edit now keeps the live app connection authenticated when applying or discarding style previews.
- Text drawn on the canvas is now readable white instead of invisible black when the app is in light theme

## 2026-07-06

### Added

- 3D rotation and perspective controls on every element
- Dragging an element onto a rectangle now nests it inside with auto-layout, just like dropping into a frame
- Preview and edit hover, focus, and pressed states with real CSS output
- Responsive breakpoints: pick a device width from the inspector, edits at any width persist as cascading overrides, and breakpoint frames render side by side linked to the base screen
- Selecting multiple elements and dragging now moves the whole selection together, keeping their spacing
- Shader fills and effects: AI-authored or preset GLSL shaders with live uniform knobs, editable source in the Code panel, and WebGL rendering that works in exports

### Improved

- Breakpoint frames in the overview now support click-to-select, a width/remove menu, and full-view entry, and deleting an element while a breakpoint is active now hides it only at that width instead of removing it everywhere
- Breakpoint segments in the inspector now show a device icon (phone/tablet/desktop) for each width
- Breakpoint targeting now lives in one compact control in the inspector header, with per-breakpoint options to change width or remove it
- Cleaner inspector: removed the Ask AI box from the Design tab
- Dragging screens and objects on the canvas is now much smoother, especially in boards with many screens
- Edit gradients directly on elements inside screens, scale strokes proportionally with K, and drop assets exactly where you point
- Keyframe animation timeline — per-property keyframes, easing curves and springs, and loop modes
- Padding and corner-radius value scrubbing now snaps to whole pixels, and scrubbing the combined padding control no longer flips it into the per-side view mid-drag.
- Padding handles now only resize on the handle line itself, show a live value while hovering or dragging, and the drop-position indicator is visible again when reordering elements
- Reduced URL history churn and selection-overlay flicker while zooming or editing
- Removed the decorative dot before screen names in the overview
- The design agent now visually reviews rendered screenshots of each screen and checks cross-screen token drift before finishing.
- The zoom menu is more compact with tight rows and right-aligned shortcuts

### Fixed

- AI-generated and duplicated screens now get their editor selection IDs stamped automatically, and multi-screen generation sizes each screen to its intended device instead of forcing every screen to the same size
- Applying shaders and fills in quick succession can no longer corrupt a screen
- Canvas edits can no longer be overwritten by stale collaborative sessions
- Canvas edits inside screens save reliably again
- Clicking empty canvas space now deselects an element inside a screen, not just a selected screen frame
- Drawing a shape or text on the canvas no longer flashes away and back — it stays visible while it saves, and new text can be typed into immediately
- Dropping an element between two others inside a screen now shows the insertion line and lands exactly where you point
- Duplicating a screen now places the copy exactly where you drop it, matching the original screen's size
- Edits from collaborators and the agent now update the canvas in place instead of briefly flashing the screen
- Fixed a bug where most style, position, and text edits briefly flashed the whole screen preview, especially at responsive breakpoints
- Fixed a confusing raw error message when a file upload fails with a non-JSON server response
- Fixed a rare case where an edit could be silently overwritten if another change landed at the exact same moment
- Fixed inserted assets sometimes disappearing, reappearing, or corrupting the screen when added while other edits were in progress
- Fixed inspector value scrubbing producing erratic numbers and typed values reverting after pressing Enter
- Fixed padding, gap, and min/max size scrubbing not updating the canvas live while dragging
- Fixed text stroke color turning black and glyphs disappearing when the fill was removed on text with an outline
- Fixed the collapsed Effects and Stroke inspector sections showing an empty gap under their headers for plain elements
- Fixed the New Design dialog closing unexpectedly when using the project or design-system dropdown inside it
- Fixed the Typography section missing when selecting text nested inside a rectangle
- Full view no longer flashes back to the overview on entry, no bar covers the top of your page anymore, and zooming out keeps the screen centered
- Mobile layouts no longer stack a desktop header under the navigation bar.
- Moving, restyling, and scrubbing values on elements in AI-generated designs now works reliably — elements get a stable id the moment you select them
- Promoting an element to a component now works correctly for elements on any screen, not just the first one
- Screen labels no longer turn blue when you hover inside the screen, only when you hover the label itself or select the screen
- Scrolling a screen with an element selected stays smooth on complex pages
- Selection borders, handles, and value readouts now stay the same size on screen at any zoom level
- Selection handles and editing chrome now stay a constant size as you zoom in single-screen view
- Text drawn on the canvas now defaults to white and Inter in dark mode so it is readable, instead of invisible dark serif text
- Text dropped into a shape now stays readable instead of disappearing when its color matches the background
- The add-tweak-controls prompt no longer jumps to the corner of the screen while closing or opening
- The padding value readout now stays visible while you hover or drag a padding handle
- The selected element attachment now clears from the chat composer after you send an edit request
- Undo and redo no longer flash the screen — changes now apply in place instead of reloading the canvas
- Zoom presets like "Zoom to 50%" now stay on the focused screen instead of jumping back to the overview

### Changed

- .fig files now stay on the Builder indexing path through design-system setup instead of local screen import.

## 2026-07-05

### Added

- Press A to draw screens on the canvas; inside a screen it draws a plain frame div

### Improved

- Code sidebar tabs now use a quieter active highlight that matches the editor chrome.
- Designs get AI-generated names from your prompt

### Fixed

- Local-code screens keep their connection when duplicated, and source saves now detect conflicts

## 2026-07-03

### Added

- The AI now edits like a collaborator on canvas: its cursor glides to the element it changes, with a labeled selection ring and a fading highlight after each edit

### Improved

- Canvas interactions are sharper: rotation-aware resizing, shift constraints, smarter snapping with equal-gap guides, group rotation, and reliable alt-drag duplicating
- Design system setup now indexes Figma, code, and design.md sources through Builder DSI.
- Layers panel is smarter: top layer on top, drag with auto-scroll and spring-open folders, and hidden layers stay out of exports
- Much faster editor: smooth dragging, zooming, and panel updates in large multi-screen files
- Pen tool refinements: click the first point to close with a drag-to-curve, double-click to finish, alt to break handles, and anchors stay visible at any zoom
- The code editor is easier to use with top sidebar tabs, clearer screen names, no minimap, and fewer false reload conflicts.
- The Code panel is now a full VS Code-style editor with a file explorer, tabs, search, quick open (⌘P), a command palette, and automatic Prettier formatting

### Fixed

- Design chat can now wait longer for large background screen updates instead of retrying the same step too early.
- Design chat now keeps continuing when a quiet model recovery briefly overlaps with the previous run finishing.
- Design chat now keeps selected-variant screen edits moving when a large edit stalls during preparation, instead of leaving the chat waiting for a browser-side recovery.
- Design retries stalled screen edits with a smaller, safer follow-up instead of repeating the same stuck update.
- Inspector fixes: mixed selections show Mixed instead of wrong values, gradients edit safely, and hidden fills restore their original colors
- Keyframe timeline works reliably: drag keyframes smoothly, pick easing per keyframe, and motion edits save safely without reverting
- Text editing: Enter adds a line break, international (IME) typing works, and text keeps its content during live collaboration
- Undo and redo are dependable across agent edits, screen switches, and copy/paste between tabs
- Variant picks now more reliably expand the selected direction into the full requested screen instead of leaving a direction summary behind.

## 2026-07-02

### Improved

- Design assets are easier to search and can be dragged directly into the canvas.

### Fixed

- Creating two frames in a row no longer freezes and reloads the editor
- Design chat now recovers when the model connection goes quiet after reading a screen.
- Design chat now starts new requests from the design list without carrying over a previously selected screen.
- Design inspector and canvas controls stay consistent when selecting screens.
- Design now marks stopped agent actions clearly and keeps variant follow-ups focused on the selected screen.
- Design now recovers cleanly when an edit screen action stalls before streaming any content.
- Fixed a crash when opening the code editor.
- The Motion drawer now animates smoothly when opening and closing.

### Changed

- The temporary Code tab is hidden from the Design editor sidebar.

## 2026-07-01

### Added

- Design can import Figma paste, .fig files, and standalone HTML from a new Import tab.
- Designs can be edited in a new Code workspace from the left rail.

### Improved

- Exporting a design as PNG or SVG now downloads just the selected frame instead of the entire screen.
- Import is more compact, Local app setup is clearer, and Figma selections can be pasted from the canvas.

### Fixed

- Code workspace now opens a VS Code-like editor with real code editing affordances
- Design chat no longer shows an empty-state selection chip in the composer.
- Design editor polish makes zoom controls, asset insertion, sharing, collaborator following, and agent handoffs clearer.
- Design previews refresh immediately after agent screen edits.
- Design prompts that already ask for multiple directions now start generating variants instead of stopping at intake questions.
- Design QA fixes make exports, read-only permissions, tool filters, and screen overview controls behave more clearly.
- Design recovers sooner when an agent gets stuck preparing a large design edit.
- Design systems no longer crash when imported tokens include responsive values.
- Design variants can now be generated from compact directions, reducing long-running agent stalls.
- Improved variant-pick follow-ups so selected directions continue from the kept screen in a bounded pass.
- Motion tracks can be added in local Design editor sessions without failing to save.
- Org members can see Design projects created in their workspace.
- Share general access options now appear above the dialog when switching a design from private to organization access.
- Zoom menus in the design editor now open independently from the toolbar and inspector.

### Removed

- Design chat no longer shows a redundant context tab above the composer.

## 2026-06-30

### Added

- Accessibility findings can now be fixed in one click for common inline issues like low contrast, small tap targets, and focus visibility.
- Selecting a component instance now shows editable props in the inspector — change variants, toggle booleans, and edit labels, and the component updates live.
- Design can browse Figma library components and insert them into the active screen with source provenance.
- Design now has native components, embedded media, and Figma imports as separate asset tabs.
- Shader fill presets can now be applied to a selected element, not just previewed.
- The motion timeline can now add an animation track to any selected element and write it to CSS, with a live scrub preview.
- Tokens can now be imported from pasted notes, code files, folders, or the current design instead of entering each one by hand.

### Improved

- Component selections now use purple component chrome and show auto-layout parent outlines.
- Constraints now expand inline from a compact inspector preview toggle.
- Creating a component now opens in a compact inspector popover.
- Design no longer shows the connected local code warning banner.
- Design now has a slim left rail for File, Agent, Assets, Tools, and Tokens.
- Design opens with a cleaner empty canvas and loading preview.
- Design preview now includes a publish app waitlist option from the play menu.
- Design questions now use tighter editor typography and controls.
- Design's left rail now matches the sidebar chrome and uses tighter labels.
- Design tools now use a quieter, more compact list layout.
- Design tools use simpler, less decorative icons.
- Inspect code now shows the selected element’s opening tag (tag name and attributes) at a glance.
- Inspector element headers show the selected HTML tag and the code action previews highlighted HTML.
- Layers can be multi-selected from the canvas and edited together with mixed values shown in the inspector.
- Motion edits now save automatically without a separate CSS apply button.
- Motion is now available from the persistent left rail and the timeline opens and closes smoothly.
- Motion timelines now reopen as editable tracks after writing keyframes to CSS.
- New board shapes now start with neutral gray styling while preserving explicit fill and stroke choices.
- Pending visual style edits now warn before you leave the editor without applying them.
- Share options now make link sharing, export, and agent handoff easier to notice while keeping the dialog cleaner.
- Share options use a tighter Design editor popover with compact tabs and controls.
- Signed-out save and share controls use simpler labels and open sign-up in a new tab.
- The Motion timeline now opens from a quiet footer row in the Layers panel.
- The Design editor loading skeleton is simpler and its bottom toolbar uses one consistent surface.
- The Design inspector now shows States and Review in a tighter, less noisy sidebar layout.
- The empty Designs page now focuses on a single primary New Design action.
- Visual edit can open and refresh localhost screens in one authenticated step for faster chat-driven canvas updates.
- Visual style drags stay live while pending edits can be applied by an agent or copied as a prompt.

### Fixed

- Agent chat now reports saved Design generations clearly when only the final assistant note times out.
- Apply styles now appears only for localhost visual-edit screens.
- Applying the one-click fix for a small tap-target accessibility finding now clears it on re-audit instead of having it reappear
- Board shapes stay visible in the overview.
- Canvas creation, screen dragging, undo/redo, and image fill edits are more reliable in the visual editor.
- Canvas editing now keeps undo/redo and cross-screen layer moves reliable in All screens mode.
- Component prop edits and shader fills now preserve rapid same-tab Design Studio changes.
- Copying or dragging screen elements onto the infinite canvas preserves their styling.
- Design cards no longer show legacy project-type badges.
- Design chat now keeps new turns in the visible Design agent panel so thinking, tabs, streaming replies, and tool calls update live.
- Design editor panels now keep their compact text sizing consistently across controls.
- Design editor undo, drag/drop, style editing, and visual-edit save flows are more reliable.
- Design now opens to the Files panel unless a generation is actively running.
- Design's Tools create menu now stays compact instead of rendering the full chat setup flow.
- Design starter prompts now begin generating immediately and avoid stalled native tool calls.
- Design Studio canvas layers can be copied, pasted, and reparented more reliably across screens.
- Design token edits now stay visible in previews and token lists after saving new CSS variables.
- Dragging absolute elements no longer shows coordinate labels next to the cursor.
- Drawing rectangles on the all screens canvas no longer flashes a default-size preview and selects the new rectangle.
- Element drags can be cancelled with Escape before they commit.
- Fixed All screens opening too zoomed in by default.
- Fixed Code-Native Design Studio edits so component props, motion CSS, shader fills, audits, and exports persist cleanly.
- Fixed the public Design Assets sidebar so native components load for signed-out viewers.
- Fixed the screen overview board so empty board space no longer blocks pan, zoom, or layer selection.
- Fixed visual editing hover overlays and spacing handles so selection stays steady.
- Full-view screens can now scroll while remaining editable.
- Inspector inputs stay compact across desktop breakpoints.
- Local visual-edit links can edit localhost frames without signing in.
- Local visual-edit frames can now be panned, selected, and edited from the Design canvas.
- Marquee selection now works inside screens, multi-selected layers show resize handles, and mixed dimensions display clearly.
- Motion timeline collapse and reopen animations feel smoother.
- Multi-select outlines now stay consistent across All screens and root canvas marquee selection is more predictable.
- New design prompts with uploaded screenshots work reliably on hosted deployments.
- New designs open into a steadier loading state before the editor appears.
- New designs show a loading state during handoff and keep editing chrome hidden until the first screen appears.
- Public visual-edit Design links now open directly instead of showing the sign-in screen.
- Screen previews in all-screens view now keep rounded outlines visible at the corners.
- Selection outlines now sit flush on rectangles drawn directly on the all screens canvas.
- Share stays visible as soon as editable designs load.
- Text added on the canvas now focuses cleanly with the right editing outline.
- The design editor loading skeleton now follows the current theme while designs load.
- The Design inspector no longer shows child layout controls for empty layers or conversion prompts in Auto layout.
- The Layers panel header stays as Layers while multiple items are selected.
- The missing design screen now uses a neutral back button.
- The motion timeline now closes without squeezing the canvas and saves animation edits with lighter responses.
- The new-design Connect AI setup now lines up with the composer and keeps its actions compact.
- The screen overview board now blends into the canvas and new rectangles use neutral gray defaults.
- The sidebar keeps the organization picker space stable while account details load.
- Top-level canvas layers now show screen drop guides before moving into a screen.
- Top-level canvas layers now keep a transparent backdrop and drop into screens reliably.
- Top-level canvas layers now select reliably from All screens.
- Visual editor selection, layer dragging, paint blend modes, and drawing controls are more reliable.

### Removed

- Removed the confusing States section from the design editor inspector.
- Removed the Templates gallery from Design navigation.
- The design inspector no longer shows the Ask AI section above Export.
- The Design review panel no longer shows a separate inline audit run button.

## 2026-06-29

### Added

- Added a Review panel in the design editor's inspector with an on-demand accessibility audit and one-click inline fixes for contrast, tap-target, and focus issues
- Design editor extensions now run inline beside the artboard with live selection context and AI prompting.
- Selected containers show draggable padding and gap guides on hover.
- The Design editor gains a Studio layer — design tokens, multi-breakpoint responsive editing, code-backed components with Create component and Inspect code, accessibility and visual-diff review, and a Builder-powered real-app tier — with each capability gated to what the design's source can safely support.
- Agents can now use `/visual-edit` to open localhost routes as URL-backed screens in overview mode.

### Improved

- Active screens in the editor sidebar now use a quiet row highlight instead of an active badge.
- Agents can now open screen overview, focus screens, and add placed screens to the canvas.
- Copying and pasting layers no longer shows success notifications.
- Design agents now generate and refine variants from stronger product-grounded design guidance.
- Design inspector controls now use a softer, more refined dark chrome.
- Design mode top chrome now groups collaborators, preview, Share, and chat in a cleaner editor bar.
- Design questions now appear as a cleaner canvas intake with a chat waiting note.
- Design variant directions now appear as regular overview-board screens with one-click chat buttons for choosing which screen to keep.
- Inspector number fields have cleaner tooltips and draggable scrub handles.
- Layer names in the sidebar can scroll horizontally instead of truncating at deep nesting.
- Layer nesting in the sidebar now uses tighter spacing so names stay readable.
- Public visual-edit and shared design links now invite visitors to create a free account when they save or share.
- Screen overview full-view controls now sit above frames instead of covering the preview.
- Screen overview is easier to find and named screens open directly in the focused Design view.
- Screen overview tools can draw shapes, create screens, and keep handles visible while zooming.
- Screen overview zooming feels much faster and smoother, in-screen elements can be selected directly, and selection chrome stays crisp above overlapping layers.
- Share now groups link sharing, exports, and agent handoff in one tabbed menu.
- The design editor loading skeleton now uses a softer charcoal canvas while designs load.
- The device preview menu now sits beside collaborators in the inspector sidebar.
- The missing-design view is cleaner and matches the rest of the editor chrome.
- The Pen tool icon and tool option menus better match the editor chrome.
- The Pen tool now creates anchor-based Bezier vectors with handles and close-path feedback.

### Fixed

- Agent edits to a design are no longer occasionally dropped or corrupted when local and agent changes overlap.
- Box-shadow and gradient colors keep named CSS colors (like red or navy) when edited, instead of resetting to black; the eyedropper now updates the selected gradient stop instead of replacing the whole gradient.
- Canvas selection no longer flashes broken prototype HTML when screens include embedded scripts or styles.
- Command menu selections are clearer in dark mode.
- Containers no longer block selecting nested elements, and normal flow hides unavailable alignment and gap controls.
- Cut (Cmd/Ctrl+X) now removes the selected element to the clipboard; pasting repeatedly cascades the copies instead of stacking them exactly on top.
- Deleting with multiple layers selected in the Layers panel now removes all of them, not just the focused one.
- Design agents now handle broad copy edits, like translating a whole page, more reliably.
- Design generation now shows Connect AI before sending when no LLM is connected and switches into loading as soon as generation starts.
- Device presets in all-screens view resize the selected preview width and height together.
- Duplicating a screen now gives the copy its own layer ids, so selecting a layer in one screen no longer affects the other.
- Element selection no longer snaps back to the previous layer after selecting or pressing Escape.
- Element selection now stays on the intended layer after selector replay and reparenting.
- Fixed Design editor exports and gradient edits so multi-screen outputs and paint settings stay faithful.
- Frame resize measurements now stay beside the cursor while dragging.
- Hiding and re-showing a gradient fill now preserves each stop's opacity instead of flattening them.
- Layer and canvas drags keep the layer list stable while changes save.
- Layer locking, layer nesting, generated-question intake, and image-fill visibility behave more reliably in the visual editor.
- Layer moves can be undone and redone without flashing the canvas preview.
- Layers no longer repeat document wrapper rows when a screen contains malformed HTML.
- Hosted design generation and editing chats have a longer background run window, reducing timeouts during complex creative turns.
- Overview previews now keep element hover and selection tied to the correct screen.
- Picking a design direction now submits to the agent right away and reliably saves, instead of leaving the message sitting unsent in the chat box or firing twice on a double-click.
- PNG export handles modern CSS color functions more reliably.
- PNG export now ignores duplicate clicks while a download is already running.
- Pressing Escape now cancels a stuck screen drag in the overview canvas.
- Screen overview only highlights screens when the frame or title is directly hovered.
- Screen overview previews now resize to match the selected device.
- Design selection now uses a pointer cursor instead of the move cursor.
- Screen overview selection outlines now stay locked to screens while selecting or resizing.
- Screen overview zoom now reports real screen scale separately from focused-screen zoom.
- Screen overview zooming now stays on the overview canvas instead of opening a screen automatically.
- Screen previews use a single blue hover border in all-screens view.
- Selecting a nested layer from All screens now keeps you in All screens view.
- Sidebars use darker chrome with clearer dividers, and chat warns immediately when no LLM provider is connected.
- Style changes that set several properties at once (fixed-size text, constraints, padding, flip, stroke position) now all save reliably instead of dropping all but the last property.
- The editor no longer crashes when a screen ends up with duplicate or malformed layer ids (e.g. from a bad agent edit); the layer tree is now resilient to it.
- The inspector stays read-only while an empty design is still generating.
- Typography controls now keep the font name visible and move text box sizing into a details popover.
- Visual edit actions now reject missing design targets before running.

## 2026-06-28

### Improved

- Annotate mode now combines drawing and comment pins in one canvas submission.
- Left sidebar collapse motion and footer controls now feel smoother and use less divider chrome.
- Live cursors now use a sharper pointer with a cleaner adjacent name tag.
- The bottom toolbar now groups tool menus with a distinct mode section.
- Screen overview now selects screens on click and opens them on double-click.
- Screen overview zooms into the active screen with smoother edit transitions and consistent tooltips.
- The Design editor toolbar is more compact and the app menu mark is easier to see.
- Tweaks now live at the top of the design sidebar instead of behind a floating canvas button.
- Tweaks now live in the right inspector beside the Design tab.
- Design mode now has a full-featured visual code canvas with adaptive inspection, patch proof, artboard duplication, clarify cards, and annotation queues.

### Fixed

- Design editor panel borders are cleaner so the canvas edge stays rounded without doubled dividers.
- Drawing prompts now reliably open and submit to the design agent.
- Editor app menus now use an outline Agent Native mark with bordered, instant submenus.
- Layer selection now updates chat context without opening the agent sidebar.
- Layer selections now preserve hidden and locked canvas state more faithfully.
- Screen overview now handles zooming, drawing, opening, and deleting screens more reliably.
- Selected-element chips in chat are shorter and easier to scan.

## 2026-06-27

### Improved

- Improved mobile navigation chrome and sidebar drawer motion.

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.

### Improved

- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.

For the full list of updates, see the [changelog folder](./changelog/).
