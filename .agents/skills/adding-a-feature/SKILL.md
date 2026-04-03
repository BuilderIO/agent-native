---
name: adding-a-feature
description: >-
  The four-area checklist every new feature must complete. Use when adding any
  feature, integration, or capability to ensure the agent and UI stay in parity.
---

# Adding a Feature — The Four-Area Checklist

## Rule

Every new feature MUST update all four areas. Skipping any one breaks the agent-native contract — the agent and UI must always be equal partners.

## Why

Agent-native apps are defined by parity: everything the UI can do, the agent can do, and vice versa. A feature that only has UI is invisible to the agent. A feature that only has scripts is invisible to the user. A feature without app-state sync means the agent is blind to what the user is doing.

## The Checklist

When you add a new feature, work through these four areas in order:

### 1. UI Component

Build the user-facing interface — a page, component, dialog, or route.

### 2. Script

Create agent-callable scripts in `actions/` so the agent can perform the same operation. If the user can create something from the UI, the agent needs a script to create it too.

### 3. Skills / Instructions

Update `AGENTS.md` and/or create a skill in `.agents/skills/` if the feature introduces patterns the agent needs to know. At minimum, add the new scripts to the script table in the template's `AGENTS.md`.

### 4. Application State Sync

Expose navigation and selection state so the agent knows what the user is looking at. Write to the `navigation` app-state key on route changes. Update the `view-screen` script to fetch relevant data for the new feature. Add a `navigate` command if the agent needs to open the new view.

## Examples

### Adding "compose email" to a mail app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | Compose panel with tabs, to/cc/bcc fields, body editor                                  |
| Script          | `manage-draft` script (create/update/delete drafts), `send-email` script                 |
| Skills/AGENTS   | Document compose state shape, draft lifecycle, script args in AGENTS.md                  |
| App-state sync  | `compose-{id}` keys for each draft tab, `navigation` includes compose state              |

### Adding "create form" to a forms app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | Form builder page with drag-and-drop fields, preview, settings                           |
| Script          | `create-form` script, `update-form` script, `list-forms` script                          |
| Skills/AGENTS   | Document form schema shape, field types, validation rules in AGENTS.md                   |
| App-state sync  | `navigation` includes `{ view: "form-builder", formId: "..." }`, `view-screen` fetches form data |

### Adding "chart type" to an analytics app

| Area            | What to build                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| UI              | New chart component, chart type selector in dashboard                                    |
| Script          | `create-chart` or `update-dashboard` script that sets chart type and config              |
| Skills/AGENTS   | Document supported chart types, config options, data requirements                        |
| App-state sync  | `navigation` includes selected chart/dashboard, `view-screen` returns chart config       |

## Anti-Patterns

- **UI without scripts** — The user can create forms but the agent cannot. The agent says "I don't have access to that" when it should be able to do it.
- **Scripts without AGENTS.md** — The scripts exist but the agent doesn't know about them because they're not documented. The agent reinvents solutions instead of using the scripts.
- **Features without app-state** — The agent cannot see that the user is looking at a specific form, email, or chart. It asks "which one?" instead of acting on the current selection.
- **Scripts without UI** — The agent can do something the user cannot. This is less common but still breaks parity.

## Verification

After completing all four areas, verify:

1. Can the user perform the operation from the UI?
2. Can the agent perform the same operation via scripts?
3. Does `pnpm action view-screen` show the relevant state when the user is using the feature?
4. Can the agent navigate to the feature view via the `navigate` script?
5. Is the feature documented in AGENTS.md with script names and args?

## Related Skills

- **context-awareness** — How to expose UI state to the agent (area 4 in detail)
- **scripts** — How to create agent-callable scripts (area 2 in detail)
- **create-skill** — How to create skills for new patterns (area 3 in detail)
- **storing-data** — Where to store the feature's data
- **real-time-sync** — How the UI stays in sync when the agent writes data
