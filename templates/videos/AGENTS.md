# Videos — Agent Guide

Videos is an agent-native animation/composition studio. The agent creates and
edits compositions, timelines, animation tracks, design-system styling, folders,
exports, and sharing through actions and SQL-backed application state.

Keep this file short. Detailed animation, composition, and implementation rules
live in `.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for composition lifecycle, files, tracks, folders, design systems,
  export, and sharing. Do not mutate composition tables directly.
- In dev, call actions with `pnpm action <name>`; in production, call the native
  tool. Read the action schema when a parameter is unclear.
- Use `view-screen` before editing a specific composition if the active
  composition/scene/timeline is not clear.
- For linked design systems, fetch and follow tokens plus custom instructions
  before generating visuals.
- Treat timeline data as the source of truth. Document animated properties in
  track metadata and use the established track helpers instead of hard-coded
  animated values.
- Keep generated showcase animations polished: purposeful motion, registered
  interactive elements, natural cursor paths, and responsive framing.
- Compositions are private by default. Use framework sharing actions for
  visibility and share grants.
- TypeScript only for source changes. Use existing Remotion/React patterns.

## Application State

- `navigation` describes the current view, composition id, folder, selected
  element, and playback/editor state.
- `navigate` moves the UI and is consumed by the client.
- Use app actions or `view-screen` for refreshed timeline/editor snapshots.

## Skills

Read the relevant skill before deeper work:

- `composition-management` for creating, editing, folders, exports, and sharing.
- `animation-tracks` for track schemas, expressions, timeline behavior, and
  animated property metadata.
- `frontend-design` and `shadcn-ui` for UI changes.
- `actions`, `delegate-to-agent`, `security`, and `self-modifying-code` for
  framework patterns.
