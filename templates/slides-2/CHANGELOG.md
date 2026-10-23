# Changelog

All notable user-facing changes to Slides 2 are documented here. Open it any time from the command menu (Cmd+K → "What's new").

## 2026-10-21

### Added

- Decks created from templates and updated decks show previews and actions in chat.
- Slides now support deck-wide and per-slide transitions, matched-object morphs, and step-by-step reveals.
- Switch between light and dark themes from the command menu

### Improved

- Build step controls disable moves past the start and end of the reveal order.
- The editor shows the current page and total in the footer
- The Present button now matches the slide editor's reference accent color
- The slide editor rail, canvas backdrop, toolbar, and inspector empty state now align more closely with the editing layout.
- Jump to any presentation slide by typing its number, including multi-digit slide numbers.
- Slide text can now use light and extra-bold weights for more precise typography.
- Slide thumbnails now navigate with all four arrow keys.

### Fixed

- Agent text selections stay tied to saved slide content while edits are pending.
- Comments stay attached to slide objects when they move
- Position fields preserve an object's size after rotation
- Slide edit previews now match the exact version saved by the edit.
- The editor header and panels now match the reference more closely, zoom and motion tools are in the command menu, and recovered decks no longer show stale errors.
- Slide text keeps consistent line spacing in the editor.
- Slides that fail to render now show a clear message on the canvas.
- Mobile navigation supports keyboard dismissal, and slide chat links follow the slide's current position
- Slide editor panels now match the reference widths, and recovered decks no longer show an outdated failure message.
- Slides generated from a home-screen prompt now stay in the deck you started.
- Slides marked to skip are omitted from presentations, with correct slide numbers and totals

## 2026-10-20

### Added

- Browse saved deck versions and restore a previous snapshot from the editor.
- Copy slides between decks, rename decks in the editor, and get warned before leaving with unsaved changes.
- Public deck pages can export source-backed slides to PDF

### Improved

- Command-K opens the slide editor's command menu
- The slide-list toggle, deck title, and Present button now match the shared workspace controls.
- Long deck titles stay visible while editing, and the footer uses a shorter Notes label.
- Slide editing controls are grouped into compact toolbars, with clearer access to formatting and design panels.
- Open the slide overview directly from the slide rail.
- Presentations support Page Up, Page Down, Home, and End for keyboard slide navigation.
- The presenter console previews each remaining build step before moving to the next slide.
- Presenter controls use shared workspace buttons and inputs
- Resize and rotate selected slide objects with the keyboard.
- Style text with typography and color controls, then edit it directly on the slide.
- The slide editor follows your selected app theme across the canvas and selected-object controls.

### Fixed

- Clicking slide objects selects them when the frame misses the direct target.
- Deck generation waits for the requested number of completed slides before reporting success.
- Delete and Backspace remove the selected canvas object when the canvas has focus.
- Delete and Backspace remove the selected slide object from the canvas
- Document and slide media transfers stop within safe size and time limits
- Google Slides imports now report missing image data instead of adding empty images.
- PowerPoint and Google Docs imports now handle large image data more safely, and generated previews stay in sync when decks change.
- Images used by saved slides stay available in your library.
- Scope global media picks to assets the current deck can resolve.
- Slide regeneration keeps the original deck brief in context
- Stale slide previews clear before a different slide loads

## 2026-10-19

### Added

- Agents can insert, duplicate, and delete canvas objects in source-backed slides.
- Browse built-in slide themes, read their authoring guides, and start a deck with a selected theme.
- Create decks from a prompt and edit slides directly on the canvas.
- Creating and editing decks now starts with the tools most relevant to your task.
- Generated slides now appear inline in the agent chat, with actions to open the deck or keep building.
- Search the SVGL catalog and add SVG logos to a deck or the global asset library.

### Improved

- The editor highlights hovered objects and keeps image replace and crop actions on the canvas.
- The slide editor uses the shared Agent-Native controls

### Fixed

- Clicking a slide preview in overview selects that slide
- Escape cancels an in-progress slide drag without losing earlier edits
- Import failures now show clear, localized descriptions instead of server error-page markup.
- Presenter controls stay responsive when moving over the slide
- Slide generation explains when React effect hooks cannot run in static slides

### Security

- Deleting a deck revokes public presentation links linked to that deck. Older
  links without a deck association remain available until their 30-day expiry.
- Private presenter notes stay hidden from viewers and commenters, including in slide source and deck history.
- Remote image previews now accept supported raster formats only, blocking active or unknown content types.

## 2026-10-18

### Added

- Choose a template or start a new presentation from the Slides 2 home screen.
- Generate decks from a prompt, then edit slide elements directly in the visual editor.
- Generate presentation decks from a prompt and edit every slide visually.
- New presentation drafts save before generation starts, so you can retry without losing your prompt.

### Improved

- Apply an accessible design system to an existing deck before restyling.
- The assistant can undo, redo, and save pending edits in the visual editor.

## 2026-10-17

### Added

- Find and switch decks from the presenter console.
- Meet Slides 2: create and refine editable slide decks with an agent and visual editor.
- Slides 2 can export PPTX decks with each slide as an image.
- Slides 2 now opens each deck in a visual editor where you can arrange, resize, and style slide elements directly.

For the full list of updates, see the [changelog folder](./changelog/).
