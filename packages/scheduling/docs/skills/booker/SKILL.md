---
name: booker
description: Public booking flow — the state machine, animations, and URL/app-state sync.
---

# Booker

## Stages

1. **pick-date** — month grid shows days with availability
2. **pick-slot** — available slots on the selected day
3. **fill-form** — attendee form (name, email, custom fields)
4. **success** — confirmation with add-to-calendar buttons

Plus **reschedule** mode — prefilled from existing booking uid.

## Animations

Use framer-motion `AnimatePresence` with `fadeInLeft` variants. The outer
container animates its width across stages: narrow (calendar only) → wider
(calendar + slots) → widest (form).

## Timezone + 12/24h

- Detect browser timezone at mount; let user override via dropdown.
- Persist choice to localStorage key `scheduling.timezone`.
- 12/24h toggle near slot column; persist to user settings.

## URL + application-state sync

Selected date, slot, timezone, and duration are mirrored to URL query
params AND `application_state.booker-state` so:
- Page refresh preserves selection.
- Agent can read the user's current pick.

## Copy-link affordance

Every event-type row has a "copy link" button. On click, write to clipboard
and toast "Copied!" with Sonner. Works on mobile Safari too.

## Accessibility

- Month grid is ARIA `grid` + `gridcell` with arrow-key nav.
- Slot buttons are keyboard-focusable, with `aria-pressed`.
- Focus returns to trigger on modal close.
- Toast content announced via `aria-live=polite`.

## Mobile

`< 768px`: stack vertically. Calendar full-width, slot list below, form
slides in as full-screen sheet.
