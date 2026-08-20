# Changelog

All notable user-facing changes to Design are documented here. Open it any time
from the command menu (Cmd+K → "What's new") or from Settings.

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

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
