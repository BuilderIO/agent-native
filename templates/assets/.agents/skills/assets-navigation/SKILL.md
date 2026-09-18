---
name: assets-navigation
description: >-
  Assets routes, tabs, chat surfaces, and `navigate` targets. Use when sending a
  user to a screen, interpreting navigation state, deciding which surface owns a
  workflow, or wiring chat into the Create tab or agent sidebar.
---

# Assets Navigation

`navigate` moves the UI to picker, library, generation, asset, and settings
surfaces. Use `view-screen` when the active library, selected asset, picker,
generation, or embed target is unclear.

## Human Library surface

- `/library` is the cross-kit browsing surface.
- `/library/:libraryId` opens a single brand kit.
- Embedded picker hosts still use `/library` with their iframe/auth bridge
  params.

## Create tab chat surface

- The Create tab (`/`) is the full-page Assets chat surface. Use the shared
  `assets` chat thread storage there, keep past chats in the left sidebar, and
  use the right agent sidebar only on non-Create routes with view-transition
  handoff back to `/`.

## Templates

- Humans browse Templates at `/templates` and edit one at
  `/templates/:templateId`. Use `navigate` with `{ view: "templates" }` or
  `{ view: "template", templateId }`. Legacy `{ view: "preset", libraryId,
  presetId }` navigation still resolves for existing conversations.
- Global templates work with any accessible brand kit. Associated templates are
  limited to their kit and are required for pinned images, skeletons, and logo
  compositing. See `logo-composite` for the
  `settings.skeletonSpec` shape and compositing behavior.

## Context tab

- The Context tab hosts governed Creative Context membership. See
  `creative-context` for submission and reuse rules.

## Related Skills

- `library-management` — what lives behind the Library routes.
- `inline-embeds` — rendering an Assets route inline in chat.
- `creative-context` — the Context tab's reuse and provenance rules.
