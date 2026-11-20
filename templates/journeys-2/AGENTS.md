# Journeys

Journeys is a lifecycle marketing workspace: a visual journey canvas, email library, audiences, contacts, accounts with scoring, tokens, conversions, connections and settings. The UI and agent use the same actions and PostgreSQL data.

## Rules

- All AI work goes through the shared agent chat. Do not call a model from an action.
- Sending is simulated. Never claim an email, webhook or provider call really went out.
- Read `view-screen` before editing the open item, then re-read it with the matching `get-*` action to verify.
- Active journeys are read-only: pause with `set-journey-status` before changing steps.
- Update a canvas by sending the complete `nodes` and `edges` arrays to `update-journey`.

## Application state

`navigation` holds `view`, `id` and `path`. Routes: `/journeys`, `/journeys/:id`, `/journeys/:id/report`, `/emails`, `/emails/:id`, `/audiences`, `/audiences/:id`, `/contacts`, `/contacts/:id`, `/accounts`, `/tokens`, `/conversions`, `/connections`, `/settings`.

## Actions

Every operation lives in `actions/`: journeys (`list-`, `get-`, `create-`, `update-`, `delete-`, `duplicate-journey`, `set-journey-status`, `get-journey-report`, `list-journey-members`), emails, audiences (`preview-audience`), contacts (`import-contacts`), accounts, tokens, conversions, connections, settings, users, `get-overview`, `navigate`, `view-screen`.
