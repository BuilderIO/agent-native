---
name: design-canvas-bench
description: >-
  Measure Design canvas performance (pan, fling, zoomed pan, zoom, idle, cold
  load, drag) with `pnpm perf:canvas-bench` on a production build, and compare
  a change against main with `pnpm perf:canvas-bench:compare`. Use when asked
  to measure canvas performance, benchmark a canvas change, prove a fix made
  pan, zoom or load faster, or find out why a specific design janks.
scope: dev
metadata:
  internal: true
---

# Measure canvas performance

`scripts/canvas-bench/` drives the canvas in headed Chromium with synthetic
input and records rAF frame intervals and Long Animation Frames per action.
Its README is the reference for every flag, action, JSON field and known
limitation. `design-editor-performance` explains what the canvas costs and
why.

A number is only a result when it comes from a production build, without
`--video`, with `numbersValid: true`, compared against a baseline measured the
same way on the same machine. Anything else is a smoke test; say so.

## 1. Start a production build

Dev React and Vite dominate a dev profile, so never measure the dev server.

**Never let a local server reach a production database.** The app prefers
`DESIGN_DATABASE_URL` over `DATABASE_URL` (`packages/core/src/db/client.ts`),
and the framework loads the repo root `.env`. If that variable is set there or
in your shell, a local server reads and writes the database it names, whatever
`DATABASE_URL` you pass, and `migrate:production` and the benchmark's seeding
and drag write to it. Before starting a server, check without printing values:

```sh
cd "$(git rev-parse --show-toplevel)" && \
  grep -cE '^[[:space:]]*(export[[:space:]]+)?[A-Z_]*DATABASE_URL=' .env; \
  env | grep -c '^[A-Z_]*_DATABASE_URL='
```

Both must print `0`. Otherwise stop and ask the user to comment the line out
or unset it. Never read, print or edit `.env` yourself.

**Postgres.** Use the local Postgres `DATABASE_URL` the user gives. If they
gave none, ask for one; don't guess. `pnpm migrate:production` creates the
app's tables in whichever database the URL names, so never point it at a
database holding real data. Don't fall back to dev numbers.

**Build and start.** Shell state does not persist between tool calls, so
every command below `cd`s into `templates/design` itself. Always run
`pnpm build` for the checkout you are measuring; an existing `build/` may be
from another commit. `BETTER_AUTH_SECRET` takes any local string. Replace
`<DATABASE_URL>` with the user's URL.

```sh
cd "$(git rev-parse --show-toplevel)/templates/design" && pnpm build
cd "$(git rev-parse --show-toplevel)/templates/design" && \
  DATABASE_URL=<DATABASE_URL> pnpm migrate:production
cd "$(git rev-parse --show-toplevel)/templates/design" && \
  DATABASE_URL=<DATABASE_URL> \
  AUTH_DISABLED=1 AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS=1 \
  BETTER_AUTH_SECRET=local-bench PORT=9444 APP_URL=http://127.0.0.1:9444 \
  nohup pnpm start > ../../.tmp/canvas-bench-server.log 2>&1 &
```

Wait until `curl -sf http://127.0.0.1:9444` succeeds (read
`.tmp/canvas-bench-server.log` at the repo root if it doesn't within a
minute). Before starting, check that nothing already listens on 9444
(`lsof -ti :9444` prints nothing), so the server you stop later is yours.

When done, stop it by port, not by `$!`: `pnpm start` forks a node child
that keeps the port after the pnpm wrapper exits.

```sh
kill $(lsof -ti :9444 -sTCP:LISTEN)
lsof -ti :9444 -sTCP:LISTEN || echo "port 9444 free"
```

## 2. Measure

```sh
pnpm perf:canvas-bench --base-url http://127.0.0.1:9444 \
  --action pan,pan-fling,pan-zoomed,zoom,idle,load
pnpm perf:canvas-bench --base-url http://127.0.0.1:9444 --action drag
```

- An invocation takes minutes: 4 actions took about 90-120 s at 2 runs, so
  expect more at the default 3, and much more on heavy designs. That outlasts a default tool timeout, so
  run it in the background with output going to a log file
  (`> <log> 2>&1`), and read the log when it exits. Piping through `tail`
  shows nothing until the end.
- To measure one action, pass only that name (`--action zoom`). Actions are
  independent.
- Use the default `--copies 6` (48 screens) unless the task targets heavier
  boards; then pick a value, and use the same one for the baseline.
- Before starting, tell the user that Chromium windows will open for a few
  minutes. They can keep working in other apps (that only adds a
  `focusWarnings` entry), but must not minimize or hide the window, which
  invalidates the run. If you have no way to reach the user first, say so in
  your report.
- One action's sanity failure does not discard the others: it is recorded in
  `failures`, the rest still run, and the invocation exits 2. `compare`
  refuses a result with failures.
- To skip the ~30 s seed on repeat invocations, pass
  `--keep-design --reuse-design` on every invocation: the first one seeds and
  keeps the design, later ones reuse it. The design is kept in
  `.tmp/canvas-bench/design-cache.json`; delete it (`delete-design`) when
  finished.
- Run one benchmark at a time on the machine, with the laptop plugged in
  (battery caps Chrome at 30 Hz). Parallel benchmarks, agents or builds wreck
  the numbers, and nothing in the result shows it. A lock file in the OS temp
  dir makes a second benchmark refuse to start (exit 2, naming the holder),
  across checkouts; a lock left by a dead process is replaced. It does not
  cover builds, other agents' browsers or anything else heavy, so keep those
  away too.
- The last console line names the output folder
  (`<repo>/.tmp/canvas-bench/<timestamp>/`, or under `--out`).

Then check the result before using it:

- `canvas-bench.json` must have `numbersValid: true`. If not, report
  `numbersInvalidReasons` and rerun; never quote those numbers.
- Checkpoint PNGs are written only for blank checkpoints and failures by
  default. To eyeball a run, pass `--screenshots always` and open, for example,
  `run-1-pan-after-forward.png` and `run-1-zoom-zoomed-in.png` with Read.
- Exit 2 means a step did not take effect (or seeding failed). Read `failures`
  in the JSON, then go to step 5.

## 3. Compare a change

1. Measure the baseline from a worktree of `main`, built and started the same
   way on another port, then the change. Same machine, same `--copies`, same
   actions, same `--runs`, measured one after the other, not at once.
2. Compare them:
   `pnpm perf:canvas-bench:compare <baseline-folder> <change-folder>`.
   It prints a Markdown table per action and a verdict per metric: `better`
   or `worse` only when each median falls outside the other's run-to-run
   range, otherwise `no measurable change`. It exits 2, with the reason, when
   either result is invalid or the runs are not comparable (different
   copies, viewport, refresh rate, design or source file).
3. If it refuses because visible screens did not load in the change, treat
   that as a regression even if frames got faster. If they did not load in
   the baseline, remeasure the baseline.

## 4. Measure a real design or find why it janks

- Import an exported design with `--source <export.json>` (shape
  `{ title, projectType, data, files }`), or measure one already on the server
  with `--design <id>`. Keep exports under the repo root `.tmp/`, never in
  committed fixtures. `--design` exits 2 at once when the id is not found.
  It refuses `drag`, which saves to the design; to measure drag on a real
  design, export it and import it with `--source`.
- Remote images and fonts load over the network during the run, so repeat
  runs of such a design vary more; say so when quoting them.
- To test a cause, make variant exports that change one thing (smaller images,
  a script removed, a screen stubbed) and measure each the same way. `compare`
  refuses results from different source files, so report the variants'
  per-run numbers side by side and say compare could not judge them.
- The benchmark says how much; a Chrome trace says why. Use
  `design-editor-performance` and its `references/measuring.md` to attribute a
  long frame. Long animation frames that are nearly all render time with no
  script attribution point at raster or image decode, not JavaScript: look
  for `LayerTreeHost::WaitForCommitCompletion` on the main thread overlapping
  `Decode Image` / `ImageDecoder` work on raster workers.
- Check a variant still contains what you think. For example, a screen that
  builds its `<img>` tags in JavaScript loses its images too when you remove
  its scripts.

## 5. Debug a failing or new action

Only here use video, because recording distorts timing:
`pnpm perf:canvas-bench --base-url <url> --action <name> --video --screenshots always --runs 1`.
Watch `run-1-<name>.webm` next to the PNGs to see what the script actually
did. To add an action, follow the README's Design section, then prove it this
way before measuring with it.

After changing the sampler or any action, prove it still detects problems:
`--inject-jank 100@500` must show frames over 50 ms in that action, and
`--break-input` must make every input action exit 2. Both are test-only;
`compare` refuses their results.

Never loosen an action's sanity check to get numbers. If the board shape makes
an action fail, report that action as unmeasured, say why, and measure with
the actions that do run. Adapting a check to a board shape is allowed only when
a known-answer test still proves it catches broken input (the `pan` family
accepts an unchanged set of visible screens only when every screen was already
in view and the screens moved with the camera).

## Report

Lead with the verdict. Then paste the compare tables for the actions that
matter, and state: build mode, refresh rate (`runs[i].actions[<name>].idleHz`
in the JSON), copies or source, runs, both output folders, and whether
`osFocusCheck` was `enabled`. Never round away a `worse`, and never claim
`better` the compare script did not print.

## Gotchas

- The default board (6 copies, 48 screens, opening at 10%) barely loads the canvas: pan, zoom and
  idle show no frames over 50 ms there. Raise `--copies` when the change
  targets heavy boards, and use the same value for the baseline.
- Screens become live editors only once the camera rests, so a moving pan
  mostly measures static previews (see `design-editor-performance`).
- Boards of a few very tall screens (Startup School) and sparse tall boards
  (Stripe) run every action: `pan-zoomed` pans down the column when no screen
  lies to the right, `drag` first wheels a title bar into reach and shortens
  the drag to the room there is, and screens count as visible through any of
  their breakpoint copies. On such a board `pan` and `pan-fling` travel only a
  few hundred pixels; `pan-fling` then samples about 15 frames, so lean on
  `pan` for percentiles.
- A failed `--source` import (for example 422 `DESIGN_HTML_INTEGRITY` when a
  variant uses `x-data` without the Alpine script) leaves an empty design
  behind. Delete it with `delete-design`.
- `drag` saves through `update-design`, which needs private blob storage for
  designs over 256 KiB. `AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS=1` registers a
  local provider, but only when `NODE_ENV` is not `production`
  (`server/lib/local-import-asset-upload.ts`). If drag fails with
  `DesignCheckpointBlobUnavailableError`, report drag as unmeasured rather
  than working around the check.
- Clean up: delete designs you created (check `list-designs`), close browsers
  and stop the server you started.
