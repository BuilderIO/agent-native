# Agent Native App

Agent Native apps treat the UI and the AI agent as equal partners. Anything the
UI can do should be available through the same SQL data and action surface that
the agent can use.

## Core Contract

- Data lives in SQL through Drizzle. Keep schemas provider agnostic.
- Define app operations in `actions/` with `defineAction`; the frontend and the
  agent should share those actions.
- All AI work goes through the agent chat. Do not call LLMs directly from UI
  components.
- Application state belongs in SQL `application_state` so the agent can know the
  current route, selection, and focused object.
- Keep UIs in sync through `useDbSync()` and `/_agent-native/poll`.
- Every feature should cover UI, actions, skills or instructions, and
  application state when those areas apply.

## Implementation Rules

- Use TypeScript for app source.
- Use shadcn/ui primitives for standard controls and dialogs.
- Do not use browser `alert`, `confirm`, or `prompt`; use app dialogs.
- Keep schema changes additive. Do not drop, rename, truncate, or destructively
  alter tables or columns.
- Tables with ownership columns require scoped reads and writes through the app's
  access helpers.
- Keep template code database agnostic and hosting agnostic.
- Prefer optimistic UI updates for routine actions, with rollback on error.

## Skills

Read the relevant `.agents/skills/*/SKILL.md` file before changing that area:

- `adding-a-feature` for the four-area feature checklist.
- `actions` for shared UI and agent operations.
- `storing-data`, `portability`, `security`, and `sharing` for data work.
- `frontend-design` and `shadcn-ui` for interface work.
- `client-side-routing`, `context-awareness`, and `real-time-sync` for
  navigation, agent-visible state, and live updates.
- `delegate-to-agent` when AI work should be handled by the agent chat.
