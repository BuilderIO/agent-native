# {{APP_NAME}} — Agent Guide

Starter is the minimal agent-native app template. Keep template-specific
instructions here tiny and move real app guidance into `.agents/skills/` as the
app grows.

## Core Rules

- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.

## Application State

- `navigation` should describe the current view and selected entity ids.
- `navigate` may be used to move the UI when the app supports it.

## Skills

Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
