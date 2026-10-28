# Changelog

All notable user-facing changes to Slides 2 are documented here. Open it any time from the command menu (Cmd+K → "What's new").

## 2026-10-27

### Improved

- Onboarding and setup copy now uses a clear, collaborative voice.

## 2026-10-25

### Fixed

- Generation no longer updates a presentation after you leave it.

## 2026-10-22

### Fixed

- New decks and added slides open in the full Slides 2 app from their chat links.

## 2026-10-20

### Added

- Public deck pages can export source-backed slides to PDF

### Improved

- The slide-list toggle, deck title, and Present button now match the shared workspace controls.

### Fixed

- Google Slides imports now report missing image data instead of adding empty images.
- PowerPoint and Google Docs imports now handle large image data more safely, and generated previews stay in sync when decks change.
- Images used by saved slides stay available in your library.
- Scope global media picks to assets the current deck can resolve.

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
