# Slides — Agent Guide

Slides is an agent-native deck editor. The agent creates, edits, imports,
exports, styles, shares, and navigates decks through actions and shared SQL
state.

Detailed deck, slide-editing, image, design-system, and export workflows live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for deck lifecycle, slide edits, imports, exports, images, design
  systems, and sharing. Do not write deck/slide rows directly.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. Read the action schema if a parameter is unclear.
- Use `view-screen` before editing when the active deck, selected slide, or
  current layout is unclear.
- Preserve deck structure and visual consistency. Prefer focused slide edits over
  regenerating whole decks unless requested.
- Follow linked design-system tokens and custom instructions.
- For raw Figma `.fig` uploads, call `import-file --format fig`, then create a
  design system from the returned `designSystem` and `customInstructions`.
- Use image-generation and image-selection actions only when the deck genuinely
  needs imagery; keep citations/asset provenance when available.
- Use framework sharing actions for deck visibility and grants.

## Application State

- `navigation` exposes the current deck, slide, selection, and editor view.
- `navigate` moves the UI to decks, slides, imports, exports, and settings.
- Use app actions for full deck/slide data instead of relying on ambient context.

## Skills

Read the relevant skill before deeper work:

- `create-deck` for new decks and outline-to-slide flows.
- `slide-editing` for targeted slide changes.
- `deck-management` for organization, sharing, import/export, and metadata.
- `slide-images` and `image-generation-via-a2a` for image work.
- `design-systems`, `frontend-design`, `shadcn-ui`, and `actions` as needed.
