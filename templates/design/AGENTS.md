# Design — Agent Guide

Design is an agent-native prototyping app. The agent creates and edits complete
interactive HTML prototypes, design systems, variants, and handoff exports
through actions against the shared SQL state.

Keep this file essential. Detailed generation, design-system, export, and UI
patterns live in `.agents/skills/`.

## Core Rules

- Use the app actions for designs, files, versions, design systems, variants,
  export, and sharing. Do not write design rows directly with SQL.
- In dev, call actions with `pnpm action <name>`; in production, call the native
  tool. The action schema is the source of truth for parameters.
- Call `view-screen` before editing a specific design if the current design or
  selected file is not already clear from context.
- Generated files must be complete, standalone HTML unless the user asks for a
  different export format. They should render in the iframe without a build step.
- Use Alpine.js and Tailwind CDN for interactive prototypes. Prefer Alpine
  directives over raw inline event handlers.
- Follow linked design-system tokens and `customInstructions` whenever present;
  explicit user instructions in the current turn still win.
- Persist useful work early: create/update the design and files as soon as a
  coherent candidate exists, then iterate.
- For multi-variant work, write candidates incrementally so the UI can preview
  progress. External MCP hosts should use `present-design-variants` so the same
  picker opens inline instead of writing `application_state` directly.
- Use framework sharing actions for design and design-system visibility/grants.
- When the user asks to download/export, use export actions or point to the
  editor download menu.

## Application State

- `navigation` tells you the current view, design id, file id, and related UI
  state.
- `navigate` moves the UI and is auto-deleted after the client consumes it.
- `show-questions` opens focused pre-generation questions when needed.
- `design-variants` contains in-progress candidates for the variant picker.

## App-Backed Skill Distribution

- The preferred hosted install path is
  `npx @agent-native/core@latest skills add design-exploration` (or `design`).
  It installs the exported Design exploration instructions and registers the
  hosted Design MCP connector together.
- For human-in-the-loop UI exploration, create a design shell, call
  `present-design-variants` with 2-5 complete HTML directions, wait for the
  user to pick one, then use `get-design-snapshot` and `generate-design` for
  follow-up refinements.

## Skills

Read the relevant skill before deeper work:

- `design-generation` for creating/editing prototype HTML and variant flows.
- `design-systems` for tokens, brand extraction, and linked systems.
- `export-handoff` for HTML/PNG/SVG/ZIP/code handoff.
- `frontend-design` and `shadcn-ui` for app UI changes.
- `actions`, `delegate-to-agent`, `security`, and `self-modifying-code` for
  framework patterns.
