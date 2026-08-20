# Changelog

All notable user-facing changes to Agent-Native Slides are documented here. Open it any
time from the command menu (Cmd+K → "What's new").

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

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
