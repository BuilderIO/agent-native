# Changelog

All notable user-facing changes to Agent-Native Slides are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

## 2026-08-18

### Improved

- Private deck links now explain access and let viewers notify the owner

### Fixed

- Decks now appear correctly under Mine.
- Generated slides now preserve requested speaker notes.

## 2026-08-17

### Improved

- Slides now keep generated layouts stable, surface both-axis overflow, and make slide and text-box editing easier to discover.

## 2026-08-13

### Added

- Slide transitions can be set from a visible control in the slide toolbar instead of being agent-only

### Fixed

- Clicking a slide thumbnail now focuses it, so the slide copy, paste, and delete shortcuts work after a plain click
- Duplicating or undoing the deletion of a slide now keeps its transition, animations, and image data after reload
- Opening presentation mode from the agent now starts on the requested slide instead of the first one

## 2026-08-12

### Added

- Duplicate a slide from the film strip with Cmd/Ctrl+C then Cmd/Ctrl+V

### Improved

- Shared decks now distinguish read-only viewers from commenters who can add comments without editing slides.

### Fixed

- Arrow-key navigation in the slide film strip now scrolls slides below the fold into view
- Presenting a deck now returns you to the slide you were viewing when you exit

## 2026-08-11

### Added

- Slides can copy and paste element styles with Cmd+Option+C/V and the context menu

### Improved

- Agent chat now follows the current slide and selection
- Faster Slides chat deck reads
- History now opens from the deck overflow menu
- Images can be dropped directly onto slides and resized or repositioned freely
- Selected slide layers can be nudged precisely with arrow keys
- Share dialog roles now use Commenter terminology for people who can view and add comments.
- Slides chat can read one slide without loading the full deck
- Slides clearly indicate when an AI agent is editing alongside you.
- Slides support atomic code-style HTML patches without regenerating whole slides
- The style toolbar now uses the full available width

### Fixed

- Chrome no longer offers to install Slides as a desktop app.
- Imported decks now use slide content for their title instead of a placeholder filename.
- New decks now transition directly to a full-page editor loading state
- PDF requests to restyle and preserve a source deck now import the full deck before editing
- Slide edits preserve their layout without introducing hidden duplicate elements or stale click reveals
- Slides reliably imports uploaded PDFs and presentations
- Slides shows one compact AI marker and keeps your current slide selected while new slides load as skeletons
- Text edits preserve slide layout when no changes are made
- Undo and redo now move one visible slide state at a time

## 2026-08-10

### Improved

- AI editing status now uses a cleaner combined avatar badge.
- Imported reference decks now show clear success and stay selected for new deck generation
- New deck creation now shows progress, opens the editor directly, and remembers your reference choices
- Slides editing controls are consolidated into one focused menu

### Fixed

- Asking the agent for several slide animations at once now keeps all of them instead of only the last.
- Generated decks keep a clear, human-readable title
- Pasted Google Slides links import after reconnecting Google Drive when needed.
- Presentation reveals now follow validated ordered targets, queue rapid navigation, and settle cleanly after transitions.
- Slides now verify and restyle every imported slide in one pass
- Slides only suggests a Google connection for relevant requests, and the suggestion can be dismissed.

### Changed

- The Google Slides import option is now labeled Slides.

## 2026-08-09

### Added

- Highlight text on a slide and the formatting bar now offers "Revise with AI". Describe the change you want — shorter, punchier, on-brand — and the agent rewrites just that text without disturbing the rest of the slide.

### Fixed

- Fixed the Delete key doing nothing after selecting an image that sits inside a slide's layout, such as a picture in a card grid. Only images that had been moved freely on the canvas could be deleted before.
- Fixed direct edits to a PDF/PPTX-imported deck's slide text sometimes failing to save with a generic "Internal server error" — the source-preservation guard meant to stop an agent from silently dropping the original artwork or copy was also blocking ordinary human edits, which have no way to opt out of it.
- Fixed PDF and custom-size PowerPoint imports rendering with distorted, mispositioned images and text on non-16:9 pages.
- Fixed images vanishing from exported PDFs and PowerPoint files when they came from a site that blocks direct browser access, such as a blog or a stock photo host. Those images are now fetched through the app and appear in the export.
- Fixed imported PDF text losing the space between words when a line changes color or weight mid-sentence, which ran headings like "7 Air purifying house plants" together into "7 Airpurifying".
- Fixed imported PDF/PowerPoint slide text rendering larger than its original box (often overlapping neighboring text) whenever the source page's physical size didn't match the deck canvas's assumed size — font sizes now scale by the same factor as element positions instead of a fixed point-to-pixel conversion.
- Fixed decks with many slides loading slowly and rendering incorrectly in the editor. Every slide thumbnail measured its full layout on mount, so a long deck forced hundreds of page reflows at once; off-screen thumbnails now wait until they scroll into view, and the browser skips painting them entirely until then. The hover buttons on each thumbnail also no longer blur what is behind them, which was making the rail flicker and leaving dark patches over the editor.
- Fixed the deck editor staying covered by the mobile slide-rail dimming overlay after the window was narrowed, which washed the whole editor dark with no way to dismiss it.

## 2026-08-08

### Fixed

- Google Slides export now tells you why a deck fell back to a .pptx download instead of reporting success.

## 2026-08-07

### Fixed

- Deleting a deck no longer freezes the Slides browser
- Fixed generated slides briefly disappearing while they are being created
- Slide previews and Present now keep deck colors consistent
- Slides verify generated images are persisted on the target slide

## 2026-08-06

### Added

- Import PDF, Google Slides, and PowerPoint decks directly from the new deck prompt.

### Improved

- Deck thumbnails keep a consistent listing frame across aspect ratios.
- Google Slides exports now show clear import steps when direct Drive export is unavailable.
- Presentation prompts continue adding rendered slides until the requested outline is complete.
- Slides offers a direct Connect Google button when a Drive connection is needed.
- Slides preserve uploaded PDF layouts, accept larger reference files, and explain Google connection failures more clearly.

### Fixed

- Clicking the gray canvas around a slide clears its selection
- Deep-linked decks open directly instead of being interrupted by first-run onboarding.
- Imported PowerPoint exports keep text and images editable and ignore malformed grid metadata.
- Public decks now share read-only presentation links by default.
- Styled words stay part of their text box instead of becoming separate selectable objects
- Uploaded decks keep their slides and visuals when you improve and export them

## 2026-08-05

### Improved

- Deck browsing keeps All and Mine in the header with a tighter grid layout.
- Decks are now sorted by most recently updated
- New deck creation now flows through a clean full-screen reference step
- New presentation prompts now clearly describe presentation generation
- Website imports now include linked stylesheets for more accurate brand colors and fonts
- Website URL imports now capture hydrated browser-computed styles for more faithful deck themes.

### Fixed

- Failed deck creation and reference uploads now recover cleanly instead of leaving stuck drafts
- Slides recover completed generation results after a sync hiccup, and the agent prompt stays readable.

## 2026-08-04

### Added

- Bullet and numbered list buttons in the slide toolbar convert a text box to a real list
- Italic and underline are now one click away in the slide toolbar, without entering text edit mode

## 2026-08-03

### Improved

- Legacy slide outlines now prefer the lowest-cost Luna model when Builder is connected.
- Preview slide HTML while it is being generated

### Fixed

- Presenting a deck no longer bounces you back to the deck list when the request fails instead of the deck being missing

### Changed

- Colour controls in the slide toolbar are now just the swatch, with no hex code
  beside it. Font weight and text alignment collapsed from four buttons each into
  a single control with a dropdown, and alignment uses standard icons instead of
  words. Undo and redo moved out of the toolbar into the overflow menu, since
  Cmd+Z already covers the common case.

## 2026-08-01

### Added

- Get an email when someone comments on or replies in your deck, with a new toggle in Settings

### Improved

- Slide styling now appears in a contextual toolbar above the canvas, so the slide keeps its full width while you edit.
- The slide style side panel is retired; all styling now lives in the contextual toolbar above the canvas.

### Changed

- Adding a slide now starts from a `+` at the head of the editor toolbar, next to
  the deck title, instead of a header above the slide thumbnails. The rail itself
  drops that header, tucks the drag handle onto the thumbnail on hover, and is
  narrower — so more slides fit on screen and the canvas gets the width back.
- The contextual slide toolbar now opens with the actions that never change: add
  slide, undo, redo, and the text-box tool. Undo and redo previously worked only
  through Cmd+Z with no visible control; clicking them commits whatever text you
  are editing first, so nothing you just typed is lost.

## 2026-07-31

### Improved

- Design system details now show their source and indexing status while they load with a clean placeholder.
- Design system setup keeps focus rings visible and uses a simpler dialog title.
- Skip prompt is now available in the new deck prompt header
- Slides now detect real text and box overflow across the deck and verify bounded repairs.
- The Agent Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

### Fixed

- Design-system indexing keeps your chosen name when you upload a Figma file, supports unstar, and shares new organization systems with teammates.

## 2026-07-30

### Added

- Freeform objects on a slide can be moved as a group, copied and pasted with Cmd+C/V, duplicated with Cmd+D, and reordered with bring to front and send to back.

### Improved

- Drawing, text annotations, and pinned agent comments now use the same robust canvas tools as Design.
- Slide image generation now runs through the Assets app, so decks use your brand library, presets, and generation history.
- Slide previews keep their aspect ratio, isolate embedded styles, and remain usable at narrow widths
- Slide text now edits on first click, switches to movable resize handles with Escape, and uses the same compact styling controls as Design.
- Top toolbar controls now use consistent sizing, with undo and redo kept on keyboard shortcuts.

### Fixed

- Decks now show an editor-shaped loading placeholder instead of briefly appearing unavailable while access loads.
- Duplicating a deck from the deck list now opens the copy immediately instead of showing a "Deck unavailable" error, and edits made right after duplicating are no longer lost.
- The slide layout overflow warning is now easy to read and can be dismissed.
- New decks now start with an empty slide list when no slides are provided
- Slides no longer lose decks while organization access is loading
- Style panel now scrolls with speaker notes open and shows the slide background when nothing is selected, and view-only users no longer see slide add/duplicate/delete controls or an editable speaker notes box.

## 2026-07-29

### Added

- Google Slides exports can connect your Google account directly from the export menu

### Improved

- AI editing status is now quieter and only shows slide presence when it adds useful context.
- Design systems and reference decks are easier to choose together when creating a presentation.
- New deck setup now stays in the editor, with closable Style and Comments panels that share the same space
- Selected words and text runs can now be styled independently, with accurate mixed-style controls.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.
- Slide annotation tools are clearer, and Escape now exits annotation mode.
- Slide editing now opens with the app navigation collapsed for more canvas space
- Slide editing stays visually clean on hover without a canvas outline or instruction overlay.
- Slides now appear one by one while AI builds a deck, with steadier editing presence and progress.
- Text boxes now select, move, duplicate, resize, and style like a native slide editor.
- Untitled decks now show “This Deck” in the agent prompt chip.

### Fixed

- Generated decks now receive a concise, relevant title before the first slide is added.
- New deck prompts reuse the current chat when it is still completely empty.

## 2026-07-28

### Added

- Delete a design system you own from the Design Systems page; decks that used it keep their look and are simply unlinked.
- Pick an existing deck as a style reference when creating a new one, and star the decks you reuse most.
- Presenter view: open a second window while presenting to see speaker notes, the next slide, and a timer, with both windows kept in sync.

### Improved

- Export to Google Slides now creates the deck directly in your Google Drive when your Google account is connected, instead of only downloading a PPTX to import by hand.

### Fixed

- Opening a presentation link directly no longer bounces back to the deck list.

## 2026-07-26

### Fixed

- A newly created deck now appears in the deck list right away instead of leaving the "Create your first deck" empty state until a reload.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

### Fixed

- AI image generation uses the current Gemini image models.
- PDF imports keep extracting text when native canvas bindings are unavailable.

## 2026-07-24

### Added

- Typing a markdown-style dash-space at the start of a text block now converts it into an editable bullet list

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Fixed

- Full prompts stay visible in chat when creating decks or adding slides.
- New bullet rows created with Enter now keep the list item's font size instead of shrinking to the base font
- Opening or refining a deck no longer crashes with a blank error screen when the deck has an unrecognized aspect ratio
- Pressing Enter in generated checkbox/shape-marker lists now creates a new list item

## 2026-07-22

### Improved

- Manage agent navigation now uses the connected-nodes icon.

### Fixed

- New deck prompts now open in their own visible chat thread.
- Slides no longer fail intermittently on fresh server instances.
- Uploaded screenshots can now be analyzed and recreated as editable slides.

## 2026-07-21

### Fixed

- Decks list now refreshes when you switch organizations

## 2026-07-17

### Added

- Resources can be added to Creative Context from their action menus.
- You can add exact, approved artifact versions to governed Creative Contexts for safe reuse.

### Improved

- Library now flags published decks with newer versions and lets you submit the update in place.

### Fixed

- Duplicated slides now stay in the deck after the editor saves the change.
- PDF and PowerPoint imports now work reliably in hosted decks
- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-16

### Added

- The Agent workspace now includes a Library for reusing verified creative context and choosing when it applies to presentations.
- Google Slides references can now be cloned as editable slides with their original layout, text, shapes, tables, and images intact.

## 2026-07-15

### Fixed

- Image search and generation controls now use the registered Slides actions
- PDF deck references can be imported for slide inspiration again
- The slide Style inspector now stays in a stable dock while selecting and editing elements, so the canvas no longer jumps or changes zoom.

## 2026-07-14

### Fixed

- PowerPoint template uploads now work in hosted Slides deployments.

## 2026-07-13

### Added

- New Agent page: see and manage your agent's context, files, connections, jobs, and external access in one place

## 2026-07-11

### Added

- The assistant can now resolve, reopen, and delete slide comments

### Improved

- Comment pins now clear with a faster, smoother confirmation after they are sent.
- Comments now update from live collaboration events without continuous background requests
- Editor toggles and toolbar menus now animate smoothly
- Viewing slides no longer loads every deck's full contents in the background

### Fixed

- Comment load failures now show a retry action instead of saying there are no comments.
- Deck and design system load failures now show a retry action instead of an empty collection.

## 2026-07-10

### Improved

- Deck lists load much faster and no longer re-download slide content in the background

## 2026-07-09

### Fixed

- Fixed the slide rail going permanently stale during a long agent run if the live-update connection dropped, so new slides now show up without needing a page reload

## 2026-07-08

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

### Fixed

- Deck generation now follows hydrated Builder design-system guidance before adding slides.
- Dropping an image onto a slide and sending it to the agent works even when Builder.io storage isn't connected yet
- Generated slide images now return hosted file-storage URLs instead of inline data URLs.
- Undo works after the agent edits a slide, so you can reverse chat-driven changes from the toolbar

## 2026-07-06

### Fixed

- Mobile layouts no longer stack a desktop header under the navigation bar.

## 2026-07-03

### Added

- See the AI working with you: when the agent edits a slide it now shows up as a live collaborator with a presence avatar, an editing indicator, and a highlight on what it just changed

### Improved

- Design system setup now indexes Figma, code, and design.md sources through Builder DSI.
- Slide editing is cleaner and more Figma-like, with direct style controls for selected elements.
- Slide editing now keeps thumbnails, speaker notes, styling, and the canvas in stable resizable panes with cleaner top controls.
- Undo/redo is now precise and safe with collaborators: it only reverts your own changes, never a teammate's or the AI's, and unsaved edits flush when you close the tab

## 2026-06-30

### Fixed

- Deck thumbnails collapse cleanly to one column when the chat pane narrows the deck list.
- PowerPoint downloads now keep slide text editable while preserving the rendered layout for Google Slides imports.
- Unavailable decks open in a cleaner full-height centered state.

## 2026-06-29

### Improved

- Design system setup now indexes uploaded design files through Builder.
- Slide layouts adapt when the agent sidebar is open.

### Fixed

- Hosted deck generation and editing chats have a longer background run window, reducing timeouts during complex creative turns.

## 2026-06-28

### Improved

- Left sidebar collapse motion and footer controls now feel smoother and use less divider chrome.

## 2026-06-27

### Improved

- Improved mobile navigation chrome and sidebar drawer motion.

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-26

### Fixed

- Deck links now use the workspace gateway when available so generated workspace URLs open correctly.

## 2026-06-25

### Fixed

- Read-only decks no longer show editable hover or image replacement cues.

## 2026-06-24

### Added

- A new Settings page gives quick access to language, workspace, and agent preferences.
- Added a language picker and localized app chrome for supported languages.

For the full list of updates, see the [changelog folder](./changelog/).
