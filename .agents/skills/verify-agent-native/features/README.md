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
  composer state matches model connection.
