---
name: verify-agent-native
description: >-
  Drive Agent-Native template apps (Forms, Dispatch, Mail, …) in a real
  browser the way a user does, and capture screenshots, ARIA snapshots, and
  action read-backs as proof. Use when you need to prove a template UI change
  works: launch an isolated instance on a scratch database, or read-only
  through the dev-lazy gateway, then drive a mapped feature over Chromium CDP.
scope: dev
metadata:
  internal: true
---

# Verify Agent-Native apps

The user-facing surface is each template's web UI. Apps run as Vite dev
servers, either behind the `dev-lazy` gateway (`http://127.0.0.1:8080/<app>`)
or standalone. You drive them through a headed Chromium with DevTools on
`http://127.0.0.1:9222` using Playwright's `connectOverCDP`. The helpers below
wrap all of that. Run them from the repo root. They need Node 22.18+ because
they run `.ts` directly.

Before driving anything, read [`features/README.md`](features/README.md),
then open the feature file that matches what you changed.

## Pick a mode

| Mode | Use for | Data |
| --- | --- | --- |
| **Isolated** (`launch.ts`) | Anything that writes: creating, editing, publishing, submitting | Scratch PGlite under `.tmp/verify/<run>/scratch/`, deleted at cleanup |
| **Gateway** (`--gateway`) | Read-only checks of the instance the user is looking at | Whatever the gateway app uses. In Builder containers that is often a **shared remote Neon DB** |

Never mutate through the gateway. `doctor.ts --gateway` prints `REMOTE …
read-only proofs only` when the app is on a shared database. Do not start a
second `pnpm dev`/`dev:lazy` either: at startup it kills whatever is listening
on the gateway and template ports, which takes down the user's running session.

## Launch

```bash
node .agents/skills/verify-agent-native/scripts/launch.ts --app forms --run <run-id>
```

- Spawns `pnpm exec vite` in `templates/<app>` on a free port, in its own
  process group. It strips every inherited `*_DATABASE_URL` and sets
  `<APP>_DATABASE_URL=pglite:.tmp/verify/<run>/scratch/pglite`.
- Ready when it prints `"ready": true` with the URL (about 5-10 s, first boot
  runs every migration). It writes `.tmp/verify/<run>/instance.json` and
  `server.log`.
- `--run` defaults to `<app>-<timestamp>`. Pass `--port` to pin a port.
- Isolated instances sign you in as `dev@local.test` automatically. No login
  step is needed.

Gateway mode needs no launch. In Builder.io containers the platform runs
`pnpm dev:lazy`, so restart it with the DevServerRestart tool, never by hand.
Locally, the developer runs `pnpm dev` (pass `-- --apps <a,b>` to limit apps).
The first request to `/<app>` lazily boots that app.

## Doctor

Run this first, and again whenever anything looks off. It is read-only and
exits 1 if any check fails.

```bash
node .agents/skills/verify-agent-native/scripts/doctor.ts --run <run-id>
node .agents/skills/verify-agent-native/scripts/doctor.ts --gateway --app dispatch
```

Isolated checks: `cdp`, `process` (the process group is alive), `port-owner`
(the listener belongs to our group), `scratch-db` (the listener's env points at
our PGlite), and `http`. Gateway checks: `cdp`, `gateway` (the app is exposed,
plus its port and `running` flag), and `db` (pglite or remote).

## Drive

```bash
node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> \
  --recipe .agents/skills/verify-agent-native/recipes/<feature>.ts [--param key=value ...]
node .agents/skills/verify-agent-native/scripts/drive.ts --gateway --app <app> \
  --recipe .agents/skills/verify-agent-native/recipes/gateway-open-app.ts
```

`drive.ts` opens a **new tab** in the shared Chromium, so it never touches the
user's tabs. It runs the recipe's default export, records console errors and
every response with status 400 or higher, then closes the tab and disconnects.
It exits 1 if the recipe throws, and saves a `failure.png`.

A recipe is `export default async (ctx: DriveContext) => {}`:

- `ctx.open(path)` navigates and waits out the cold-compile `Loading
  application` status and the gateway's `Dev server is restarting…` page.
- `ctx.shot(name)` writes a numbered `.png` plus a `.aria.txt` ARIA snapshot.
- `ctx.action(name, query)` calls `GET /_agent-native/actions/<name>` with the
  page's session. This is the same action surface the agent uses, and gives you
  a second view of stored state. It throws on a non-2xx response.
- `ctx.page`, `ctx.params`, `ctx.note(msg)`.

For a new flow, copy the closest recipe into `.tmp/verify/<run>/` and edit it.
Promote it into `recipes/` and the feature map once it passes. Use role and
accessible-name locators (`getByRole("button", { name: "Publish" })`), and get
the names from a `shot` ARIA file, not from CSS.

## Evidence

Everything lands in `.tmp/verify/<run>/evidence/<recipe>/` (root `.tmp/` is
gitignored): screenshots, ARIA snapshots, `action-*.json`, `drive.log`, and
`result.json` (with `ok`, `consoleErrors`, `failedResponses`, and
`artifacts`).

A proof:

- Drives the real user path, such as clicking `New form`. It never seeds rows
  or calls a write action in place of the UI.
- Captures both the action and the resulting state, plus an independent read
  of the stored state (`ctx.action("get-form", …)`), not just a toast.
- Accounts for every `failedResponses` entry. An expected rejection (like the
  empty-form publish 400) is named in the recipe. An unexplained one is a
  finding.
- Covers every entry point the feature file lists, or explicitly reports
  which ones were skipped.

In Builder.io containers, wrap the drive in StartRecording/StopRecording and
publish with PublishEvidence when those tools are available. Put a screenshot
in the final reply.

## Cleanup

```bash
node .agents/skills/verify-agent-native/scripts/cleanup.ts --run <run-id>
```

Cleanup sends SIGTERM to the recorded process group (SIGKILL after 10 s),
confirms the port is free, deletes `scratch/`, and renames `instance.json` to
`instance.stopped.json`. Evidence and `server.log` stay. It never kills by
name. Run it after failed iterations too. Gateway runs leave nothing to clean
except their evidence dir.

## Gotchas

- PGlite is single-process. `pnpm action <name>` cannot open the scratch DB
  while the instance runs (`already owned by process …`). Read state through
  `ctx.action` instead.
- Mutations through the gateway hit shared data. If you must check a write
  there, ask first.
- The agent composer cannot send without a connected model. In fresh
  instances it shows a **Connect AI** card. Do not prove a feature through the
  agent chat unless a model is connected.
- `@playwright/test` resolves from the repo root, but `playwright` does not.
  Import `chromium` from `@playwright/test` in ad-hoc scripts.
- Gateway Dispatch logs a 400 from `get-builder-credit-status` when Builder
  isn't connected. It's pre-existing, not caused by your change.

Keep the map honest as the app changes with `/maintain-verification-skill`.
