# Agent-Native verification map

This directory is the maintained source for verifying user-facing behavior of
the Agent-Native template apps. Read this index before driving an app, then
use the matching feature file as the recipe.

## Baseline preconditions

- Writes run against an isolated instance:
  `node .agents/skills/verify-agent-native/scripts/launch.ts --app <app> --run <run-id>`.
- Read-only checks may use the gateway at `http://127.0.0.1:8080/<app>`.
- `doctor.ts` passes for the instance you are about to drive.
- Chromium DevTools answers at `http://127.0.0.1:9222`.
- Never drive an isolated instance this run did not launch.

## Driving conventions

- Run every recipe through `scripts/drive.ts`, which opens and closes its own
  tab.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Recipes create uniquely named data (`--param title=…`) so reruns on one
  instance do not collide.
- Treat commands as literal.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a screenshot plus an ARIA snapshot (`ctx.shot`).
- Mutation proof includes an independent read through `ctx.action`.
- `result.json` must be `ok: true`. Explain every `failedResponses` entry.
- Report an unreachable path with the command you ran and the unmet
  precondition. Do not report a skipped entry point as verified through a
  different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible
behavior, then exactly four H2s in this order: `Sub-features`, `How to get to
it (user POV)`, `Driving it with drive.ts`, and `Gotchas`. Keep implementation
details out. Name only user paths, stable handles, required state, commands,
and observable proof.

## Features

- [Open an app through the gateway](./gateway-open-app.md): lazy boot and
  landing for any template, read-only.
- [Create and publish a form](./forms-create-publish.md): Forms blank-form
  creation, title edit, empty-publish rejection, field add, publish, and list.
- [Submit a form response](./forms-submit-response.md): public `/f/<slug>`
  submission and the Results tab.
- [Agent composer](./agent-composer.md): the agent sidebar opens, and the
  composer state matches model connection. Works in any app (`--param
  path=/inbox` for Mail).

### Mail

On a fresh instance, run `mail-connect-gate` first, because any recipe that
creates mail lifts the gate. Run `mail-compose-draft` before
`mail-navigation`. The others can run in any order.

- [Mail Connect Google gate](./mail-connect-gate.md): the account-free hero,
  settings and draft-queue exemptions, and the 404 page.
- [Compose and reopen a draft](./mail-compose-draft.md): compose fields,
  autosave, and reopening from Drafts.
- [Send an email](./mail-send-local.md): empty-recipient rejection, undo
  window, local synthetic send, and Sent.
- [Schedule send](./mail-schedule-send.md): presets and Scheduled.
  **Currently fails because of a product bug** (an int4 overflow in
  `scheduled_jobs`).
- [Drafting settings](./mail-settings-drafting.md): signature, autocomplete,
  and save state.
- [Tracking settings](./mail-settings-tracking.md): open and click tracking
  switches.
- [Aliases](./mail-aliases.md): create a recipient group.
- [Snippets](./mail-snippets.md): create reusable text.
- [Automation rules](./mail-rules.md): create a rule and the empty-label no-op.
- [Draft queue](./mail-draft-queue.md): queue a draft request and review it.
- [Mail navigation, tabs, and notifications](./mail-navigation.md): drawer
  links, inbox tabs, Configure tabs, and the notifications panel.

#### Mail surfaces that are verified-unreachable here

Each of these needs an external prerequisite that isolated instances don't
have. Report it as unreachable, not as verified.

- **Gmail account:**
  - receiving and syncing mail, real delivery, replies, and forwards
  - thread view (`/:view/:threadId`) and archive, star, snooze, and trash on
    real threads
  - Settings → `Gmail filters` (`manage-gmail-filters` errors without an
    account)
  - `Import from Gmail` on Drafting
  - draft-queue `Send`
- **Jev configured:** Settings → `AI triage` (`/settings/app/ai-filter`)
  changes.
- **Connected AI model:**
  - agent chat (`/chat`)
  - compose `Generate`
  - creating extensions (`/extensions/new`)
  - asking the agent to create rules.
