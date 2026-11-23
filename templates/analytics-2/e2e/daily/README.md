# Daily-use suite (`e2e:daily`)

Broad, keyboard-first coverage of everyday analytics paths, run locally against a fake of every
external provider. A read-only QA donor identity check contacts Labs before the isolated run; provider calls use local fakes.

```sh
pnpm --filter analytics-2 e2e:daily                  # whole suite, five bounded workers
pnpm --filter analytics-2 e2e:daily notebook.spec.ts # one family
pnpm --filter analytics-2 e2e:daily --production setup.spec.ts # fresh compiled app with the same provider fakes
```

Needs Node 24, repo dependencies and Playwright Chromium. Startup verification uses an isolated Chromium browser.
Five bounded workers then share the same server and the QA browser; each test starts with clean local/session storage,
permissions, routes and online state. Storage survives explicit reloads within a test. Setup starts
alongside the other paths, and provider mutations run under a shared lock. A local proxy
caches unchanged source assets and rejects external traffic. The runner stops its server in `finally`.

## How it works

- `e2e/local/serve.ts` starts the real dev server on a fresh isolated PostgreSQL database, signs in a synthetic
  local user and serves the fakes from `e2e/local/fake-providers.ts` (Google token exchange,
  BigQuery REST, HubSpot, Builder.io) and `e2e/local/fake-model.ts` (a scripted model).
  `e2e/local/preload.ts` rewrites those hosts to loopback and blocks other outbound sockets.
  Browser contexts block non-loopback requests, including popups; service workers are disabled.
- Daily runs allocate an isolated loopback app port; standalone `e2e/local/serve.ts` defaults to 8105.
  Each run gets fresh optimizer and child-compiler caches. Before warming other routes, the runner
  checks cold Home for errors, failed assets, and recovery navigation. The loopback fake also uses
  an ephemeral port. PostgreSQL 18 tools
  are required at `/opt/homebrew/opt/postgresql@18/bin`. The runner owns and removes its database.
- `fixtures.ts` holds the invariants every step checks (`daily.check()`): no full page reload, no
  console/page error or unexpected failed request, no error text on screen, focus never stranded
  on a hidden element, URL matches the screen. `daily.press()`/`daily.click()` measure visible
  feedback in the page from the keydown or pointerdown; the limit is 400 ms.
- The server keeps state across the tests of a run: tests name what they create with
  `uniqueName()` and clean up global state (connections, keys, settings) they change.

## Findings

A test marked `test.fail()` with `// FINDING <id>` asserts the reference behaviour and fails today
because ours differs; the suite stays green while it fails. When you fix the path the test passes,
Playwright reports "expected to fail but passed", and you remove its `test.fail()`. Never loosen
the assertion instead.

## Live Labs lane

The live lane is deliberately smaller than the local fake-provider suite. It uses only the existing
headless QA browser at `127.0.0.1:9455`, creates an isolated browser context with QA cookies,
and verifies both `qa-fleet@builder.io` and the configured QA workspace before each test. It does
not start a local server or launch another browser. The QA browser and profile fixture must already
be configured on this machine.

```sh
BASE_URL=https://labs.agent-native.com/analytics-2 pnpm --filter analytics-2 e2e:daily
BASE_URL=https://labs.agent-native.com/analytics-2 pnpm --filter analytics-2 e2e:daily navigation.spec.ts
BASE_URL=https://labs.agent-native.com/analytics-2 pnpm --filter analytics-2 e2e:daily live-notebook.spec.ts
BASE_URL=https://labs.agent-native.com/analytics-2 pnpm --filter analytics-2 e2e:daily objects.spec.ts
BASE_URL=https://labs.agent-native.com/analytics-2 pnpm --filter analytics-2 e2e:daily --grep 'Home composer'
```

`live/navigation.spec.ts` checks the Home draft, Archive layout, and opening an empty thread;
`live/live-notebook.spec.ts` creates a project, edits a SQL cell, and verifies its saved contents across
reload. `live/objects.spec.ts` runs the same recent-project control assertions as local OBJECTS-16, including durable favorites and Command-click navigation. The thread and project are test-owned and are deleted with readback in teardown. No prompt
is submitted and no external provider is configured. Other local checks and runner options are
unsupported in live mode and fail explicitly. A different `BASE_URL` is rejected. Live JSON results
and failure screenshots are written to `.tmp/analytics-daily-live-results/`. The release owner runs
the full live lane; use `--grep` for a focused probe while developing.
