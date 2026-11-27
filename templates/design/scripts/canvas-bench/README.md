# Canvas bench

A local benchmark for the Design canvas. It seeds the perf-stress design, drives the canvas in Chromium with synthetic input, and records requestAnimationFrame intervals and Long Animation Frames per run and per action. There are no budgets: it measures and reports.

Each (run, action) pair gets a fresh browser context, so actions do not warm each other. The script deletes the design it seeded on exit. A design passed with `--design` is not deleted. `--keep-design` and `--reuse-design` keep it across invocations.

## Design

- `canvas-bench.ts` is the harness. It parses flags, seeds the design, launches the browser, runs each action, and writes the JSON.
- `lib.ts` holds the shared types, constants and helpers. It has no side effects, so actions can import it. Never import `canvas-bench.ts` from an action; it runs the whole benchmark on load.
- `actions/<name>.ts` is one action. Actions load by file name from `--action`, so adding one needs no registry edit. A typo fails before anything is seeded.

An action default-exports `{ name, run, ownsNavigation? }`. `name` must equal the file name. `run(ctx)` returns `{ frames, longFrames, extra }`. Top-level numeric `extra` fields also go into the console lines and the per-action median.

The `ActionContext` the harness passes in:

- `page`, `designId`, `designUrl`, `run` (1-based), `actionName`, `options`, `constants`.
- `idleFrameMs`: idle rAF median measured before the action (null when `ownsNavigation`).
- `sampler.start()` / `sampler.stop()`: bracket the window whose frames and LoAFs are reported. Anything outside is not measured.
- `checkpoint(label)`: records the visible screens and, per `--screenshots`, writes `run-<n>-<action>-<label>.png`. A screen counts as visible when any of its breakpoint copies is in the canvas area. It counts as loaded when at least one copy in view has a preview frame and every in-view copy that has one has loaded; a copy still showing a placeholder is skipped, but a screen with only placeholders in view is not loaded. A checkpoint with no visible screens logs the canvas area and the screen rectangles.
- `screenCount`: screens in the design's `canvasFrames`.
- `waitReady()`, `readBoardExtent()`, `clearArea()`, `measurePxPerTick()`.
- `fail(message)`: throws a `SanityFailure`.

By default the harness navigates, waits until every visible screen loaded, parks the mouse on the canvas and measures idle frames before `run`. With `ownsNavigation: true` it hands over a blank page and does none of that.

To add an action: create `actions/<name>.ts`, import helpers from `../lib.ts`, call `ctx.fail` whenever a step did not take effect, and check your own work before returning (camera moved, screens changed, frames sampled). Then run `--action <name> --video --runs 1`.

## Run it

From `templates/design`. For checking the script, the dev server is enough (PGlite, no Postgres):

```sh
AUTH_DISABLED=1 pnpm dev
```

For real numbers use a production build, which needs Postgres:

```sh
pnpm build
AUTH_DISABLED=1 pnpm start
```

Then:

```sh
pnpm perf:canvas-bench --base-url http://localhost:<port>
pnpm perf:canvas-bench --base-url http://localhost:<port> --action pan,idle,zoom
```

`--action` takes comma-separated names or repeated flags. The default is `pan`. Within a run, actions execute in the order given.

## One run at a time

Two benchmarks on one machine ruin each other's frame timings and nothing in the result shows it, so the harness takes a lock before it seeds or launches anything: `agent-native-canvas-bench.lock` in the OS temp dir, shared by every checkout on the machine. It holds the pid, the process start time, the working directory and the command line. A second invocation prints who holds the lock and exits 2. A lock whose process is gone, or whose pid now belongs to a different process, is replaced with a warning. A lock file that is not valid JSON is never treated as stale: the run refuses and asks you to delete it. The lock is released on exit, including `Ctrl-C`, a failed run and a thrown error. It only guards benchmarks; builds and other browsers still contaminate a run.

## Workflow

1. Run `--video --screenshots always --runs 1` to check the script does the right thing. The JSON is marked `numbersValid: false` because recording distorts timing.
2. Look at the checkpoint PNGs and the video.
3. Run for numbers with the machine idle. Do not touch the keyboard or mouse. Another app in front is recorded in `focusWarnings` and does not invalidate the run; minimizing or hiding the window does.

## Actions

All actions except `load` start from a loaded board with the mouse on the canvas and checkpoint the visible screens (a checkpoint with no visible screens fails). Sampling always runs from the first input event to two animation frames after the last.

### pan

Wheels vertically (120 delta, 16 ms between ticks) from the top of the board to its bottom, then back. Pixels per tick are calibrated first, so leg length is measured, not assumed. When those two legs total fewer than 200 ticks, a third sampled leg follows (at the default 6 copies the two legs are 154 ticks, so it always runs; a zoomed-out board is shorter still): one continuous wheel gesture that sweeps back and forth until the pan has run at least 200 ticks, about 900 frames. Without it a zoomed-out `pan` samples about 100 frames, so p95 is decided by its 5 slowest edge frames and the same code measured 9 to 50 ms at 300 screens. Each leg waits 300 ms after its last tick before sampling stops, so the frame that commits the camera to React after a gesture is sampled too. At 120 Hz and the default 6 copies it is 77 ticks per leg and `cameraDistancePx` 18480.

`frameP95Ms` and `frameWorstMs` cover every sampled frame. `extra` splits them: `steadyP50Ms`, `steadyP95Ms` and `steadyWorstMs` exclude the first and last 300 ms of each leg; `gestureEdgeWorstMs` and `gestureEdgeFrames` cover those edges; `framesOver100Ms` counts frames over 100 ms across everything (`jiraWorstFrameBarMs` is that bar).

`extra`: `panMethod` (2; `compare` refuses results with different or missing values), `cameraDistancePx` (sum of every leg's `travelPx`), `liveIframesAtEnd`, `wheelElapsedMs`, `legFrameCounts`, `pan` (board and viewport size, travel, `pxPerTick`, `ticks`), `legs` (dx/dy per leg, and `travelPx`, the distance the camera moved including reversals inside the sustained leg), and the steady and edge fields above.

Fails when: the board extends less than half a canvas area past the view, a leg needs more than 1500 ticks, calibration does not move and return the camera, a leg moves the camera under 100 px or under 80% of ticks x `pxPerTick`, the camera ends the back leg more than 10% of the forward leg from where it started (`returnedErrorPx`), or no frames were sampled.

The forward leg must also show it rendered. Normally the visible screens must differ before and after. When they are the same, that is accepted only if every screen of the design was already in view at the start (a few tall screens leave nothing new to reveal), every visible screen is loaded after the leg, and every screen that stayed mounted moved on screen by the camera's own movement within 4 px. A camera that moved without the screens following it still fails.

### pan-fling

`pan` with no gap between ticks and a 240 delta, the largest the canvas accepts. Events go out as fast as Playwright dispatches them, so one frame can absorb several deltas.

`extra`: everything from `pan`, plus `achievedTicksPerSecond`, `wheelElapsedMs`, `wheelDelta`, `pxPerTick`, `achievedPxPerSecond`. Same sanity checks as `pan`. `pxPerTick` is calibrated with the same delta and tick spacing the legs run at (0 ms), so the travel check compares like with like.

### pan-zoomed

Aligns the board's top-left corner into view, Ctrl+wheels to about 100% around it (not sampled), then pans across the board and back. It pans horizontally with deltaX across the columns; when no screen starts to the right of the view on the row the camera is looking at (a board stacked in one column), it pans vertically along the column instead, because a sideways pan would sweep empty canvas. A page-side timer polls live editor iframes every 50 ms during each leg.

The zoom-in is setup and is not sampled. It anchors on the visible screen nearest the top-left of the canvas area, waits for the camera to rest first, and sends ticks 40 ms apart (up to 150) because on a heavy board bunched ticks are clamped per frame and the zoom falls short. If the zoomed view shows no loaded screen within 20 s, the page is reloaded and the setup restarts, up to 4 attempts; the attempts used are recorded as `zoomAttempts`. On Stripe's 499-screen board the first attempt after a cold load usually fails and the second succeeds, so read `zoomAttempts` above 1 as "the legs ran on a reloaded page". The pan legs and their checks are the same either way.

`extra`: everything from `pan`, plus `zoom`, `axis` (`x` or `y`), `zoomAttempts`, `liveIframesMax`, `liveScreensDistinct`. Leg length is capped at 1500 ticks.

Fails when: the corner cannot be aligned, zoom ends under 80% of 100% or shows no loaded screen on every one of the 4 setup attempts, plus the `pan` checks.

### zoom

Ctrl+wheels from the opening zoom (about 10%) to about 100% around the screen nearest the canvas center, then back out. Zoom per tick is calibrated as ln(scale) per tick. Sampled: the wheel ticks of both legs. A page-side tracker records live and static-preview iframe counts every 50 ms.

`extra`: `zoomStart`, `zoomPeak`, `zoomEnd`, `ticksPerLeg`, `liveIframesAtPeak`, `staticPreviewsAtPeak`, `liveIframesAtEnd`, `legFrameCounts`, `iframeTimeline` (`in` and `out`), `zoom`.

Fails when: it starts already near 100%, Ctrl+wheel does not zoom in, a leg needs over 1500 ticks, the peak is under 80% of the target, the end zoom is not within 10% of the start, or no frames were sampled.

### idle

Parks the mouse on a point no screen covers (falls back to the clear area's corner) and does nothing for 10 s. This is the cost of an open, untouched board. Sampled: the whole 10 s, plus a long-task observer.

`extra`: `durationMs`, `fps`, `idleFrameMsExpected`, `liveIframesAtStart`, `liveIframesAtEnd`, `cameraMovedPx`, `longFrameBusyMs`, `longTaskBusyMs`, `longTasks`, `mouse`.

Fails when: the camera moved more than 1 px or changed scale, or no frames were sampled.

### load

Cold page load (`ownsNavigation`). Milestones are timed in the page against navigation start. The page is probed on a 100 ms timer, not per frame, and the clear area is cached and revalidated with a handful of hit tests per probe, so the probing does not show up in the frames. The resolution is therefore 100 ms: `canvasMountedMs` is exact (a mutation observer), the other milestones can be up to 100 ms late. `allVisibleReadyMs` is stamped at the start of the first period in which every visible screen was loaded and stayed loaded, with the same set of visible screens, for 1.5 s (`READY_STABLE_MS`). Sampled: from navigation to the start of that period plus two frames; the 1.5 s hold is not in the numbers.

`extra`: `domContentLoadedMs`, `canvasMountedMs`, `firstScreenDrawnMs`, `allVisibleReadyMs`, `visibleScreenCount`, `heapUsedMb`. The `ready` checkpoint is taken after sampling.

Fails when: the watcher is not armed, ready (stable for 1.5 s) is not reached within 60 s, zero visible screens, or a milestone or the heap reading is missing.

### drag

Picks the screen nearest the center whose title bar is grabbable, selects it, drags it sideways by its title bar in 30 steps, then drags it back. The distance is 500 px when the screen has that much room beside it, else 90% of the room (never under 100 px; `dragDistancePx` records it, negative for leftward). When no title bar is in the grabbable band, as with tall screens, it first wheels the camera until one sits mid-canvas; that move is not sampled. Sampled: the drag moves plus a 500 ms window that opens before mouse up, so the drop commit is included and also reported separately. A page-side probe measures mousemove to the next frame where the screen's style changed.

`extra`: `dragDistancePx`, `movedPx`, `returnedErrorPx`, `persistedOutWorld`, `persistedBackWorld`, `persistedErrorWorldPx`, `steps`, `legFrameCounts`, `frameId`, `inputToFrameMsMedian`, `inputToFrameMsMax`, `latencySamples`, `dropWindowMs`, `drop` (both legs' drop-window rAF intervals: `frameCount`, `frameP95Ms`, `frameWorstMs`, `framesOver50Ms`; `compare` lists these as `drop.*` rows), `dropFrames` (per leg: `worstMs`, `over50Ms` as drop-window frame intervals over 50 ms, `longAnimationFrames` as the Long Animation Frame count in that window, `frames`).

Fails when: no screen fits across the clear area even after the camera moved, there is no room for 100 px between the screen's edges (all its breakpoint copies together) and the clear area, the selecting click does not select or moves the screen, the screen moves more than 10% off the drag distance, the saved position (read through `get-design` without file content) does not move by the dragged distance in world px (movedPx / scale, within 3 screen px) within 15 s of the drag out, it does not return within 3 px, or the saved position is not the original again within 15 s of the drag back. The saved position is checked before the drag back starts, so the back leg does not overlap the first save. If a check fails after the first drag, the original position is written back with `update-design` and the failure message says whether the restore worked. This matters most with `--design`, which is not deleted.

## Flags

| Flag             | Default                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--base-url`     | none, required              | URL of the running app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--design`       | none                        | Id of an existing design to use. Skips seeding and the delete on exit. Exits 2 at once when the id is not found, or when an action that saves to the design (`drag`) is requested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--action`       | `pan`                       | Action names, comma-separated or repeated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--copies`       | `6`                         | Copies passed to the seed script. Positive integer. Cannot be combined with `--source`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--source`       | none                        | Path to an exported design JSON (`{ title, projectType, data, files }`). The seed imports it instead of generating archetypes; the JSON records the source's id (null when the export has none), title and content hash, `copies` is null (also for `--design`), and `screenCount` is the number of imported screens. `compare` refuses results whose source files differ: it matches the sha256 of the file (`source.contentHash`), because an export may carry no id. Replaced file ids are found by walking the parsed data (exact values and keys), the import fails if an old id survives anywhere, a create-file warning is logged, and the number of created files must equal `files.length`. Cannot be combined with `--copies` or `--design`. |
| `--runs`         | `3`                         | Number of cold runs. Positive integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--out`          | `<repo>/.tmp/canvas-bench/` | Output root. Each run writes into a timestamped subfolder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--headless`     | off                         | Run headless. Marks the numbers invalid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `--screenshots`  | `on-failure`                | `on-failure` writes a checkpoint PNG only when it shows no or blank screens, plus a `run-<n>-<action>-failure.png` when an action fails; `always` writes every checkpoint; `never` writes none. Checkpoint state checks run in every mode. Recorded as `screenshots`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--keep-design`  | off                         | Keep the seeded design after the run and record it in `<repo>/.tmp/canvas-bench/design-cache.json`, keyed by server URL plus `copies` or the source content hash. Delete it yourself when done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--reuse-design` | off                         | Use the cached design for this key if get-design still finds it with the recorded screen count and the recorded hash of every screen position; otherwise seed fresh. Before each later (run, action) the position hash is checked again and a drifted design is deleted and reseeded. Combine with `--keep-design` to fill the cache. Recorded as `designReused` (false once any reseed happened) and `designReseeds`.                                                                                                                                                                                                                                                                                                                                 |
| `--video`        | off                         | Record video. Debug only, marks the numbers invalid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--inject-jank`  | none                        | Test-only, `<busyMs>@<everyMs>` (for example `100@500`). While sampling, the top page runs a synchronous busy loop of `busyMs` every `everyMs`. Recorded as `injectedJank`. The numbers are a test of the benchmark, and `compare` refuses them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--break-input`  | off                         | Test-only. A capturing listener in the top page swallows wheel, pointer and mouse events during sampling, so the canvas never sees input. Recorded as `breakInput`. Input actions are expected to exit 2; `idle` and `load` are unaffected. `compare` refuses it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Output

Everything goes to `<out>/<timestamp>/`:

- `run-<n>-<action>-<label>.png`: checkpoints, per `--screenshots`; `run-<n>-<action>-failure.png` when an action failed.
- `run-<n>-<action>.webm`: one video per run and action, with `--video`.
- `canvas-bench.json`.

Console output has one line per (run, action) and a median across runs per action.

Only the top document runs the sampler and observers; preview and editor iframes do not.

Top-level JSON fields: `timestamp`, `debug`, `injectedJank`, `breakInput`, `timings` (wall ms: `seedMs`, `designCheckMs`, `browserLaunchMs`, and summed over runs `contextNavigationMs`, `waitReadyMs`, `idleProbeMs`, `actionMs`, `sampledMs`, `checkpointMs`, `screenshotMs`, `contextCloseMs`, plus `cleanupMs`, `totalMs`; each action entry has the same `timings` per run), `designReused`, `designKept`, `designReseeds`, `screenshots`, `failures`, `aborted` (why the invocation stopped early, else null), `cleanupError` (the seeded design that could not be deleted, else null), `focusWarnings`, `numbersValid`, `numbersInvalidReasons`, `osFocusCheck`, `osFocusReason`, `browserPid`, `browser`, `viewport`, `deviceScaleFactor`, `designId`, `screenCount` (screens in the design's `canvasFrames`), `copies`, `source`, `actionNames`, `constants`, `runs`.

`runs[i]` is `{ run, actions }`, and `runs[i].actions[name]` has: `readyMs`, `idleFrameMs`, `idleHz`, `frameCount`, `frameIntervalsMs`, `frameP50Ms`, `frameP95Ms`, `frameWorstMs`, `framesOver50Ms`, `longAnimationFrames`, `longAnimationFrameCount`, `extra`, `checkpoints`, `video`, `focus`, `focusValid`.

- `focus`: `lostFocus` (the window lost focus; a blur alone does not count, since a live editor iframe taking focus blurs the top window while the document still has focus), `hidden` (a `visibilitychange` while sampling, a hidden page at sampler stop, or two animation frames not arriving within 2 s at sampler stop), `osFocusCheck` (`checked` or `unavailable`), `osFocusReason`, `osFrontmostOther`, `osOtherApps`, `osPolls`. `osFrontmostOther` does not invalidate numbers; it is listed in the top-level `focusWarnings`.
- `focusValid` is false when the window lost focus or the page was hidden. Another app in front only produces a `focusWarnings` entry: with the same Chromium, a board measured behind another app matched one measured in front (0 frames over 50 ms, p95 within 1 ms, 120 Hz, injected jank counts within 2). A minimized or fully hidden window can still be throttled, and the hidden-page check still invalidates it.
- `numbersValid` is false when `numbersInvalidReasons` is non-empty: `--video`, `--headless`, or any action with invalid focus.

## Compare

`pnpm perf:canvas-bench:compare <baseline> <change>` takes two result folders (or `canvas-bench.json` paths) and prints a Markdown table per shared action: median (min–max) for each frame metric and numeric `extra`, plus a verdict. `better` or `worse` needs each median outside the other's run-to-run range and at least 3 runs on each side; otherwise `no measurable change`. It exits 2 when either result has invalid numbers, when the two are not comparable (different kinds of board; for `--design` a different `designId`; for `--source` a different `source.contentHash`; for seeded boards different copies; screen count, viewport, idle refresh rate or an action's `visibleScreenCount` differ), or when either result has a checkpoint where visible screens did not load (a blank screen can make frames look faster for the wrong reason). Nested `drop` extras are compared as `drop.*` rows. Live and static iframe counts and `cameraMovedPx` are always shown as `changed`, never better or worse.

## Exit codes

- `0`: the measurement completed. Check `numbersValid` before trusting the numbers; invalid focus does not change the exit code.
- `2`: another benchmark holds the lock, `--design` names a design that does not exist, an action name is unknown, seeding failed, anything threw outside a measured step, or an action failed a sanity check. A failing (run, action) is recorded in `failures` (`run`, `action`, `message`, `screenshot`) and left out of `runs`; the remaining actions and runs still execute, the JSON is written, the failures are printed at the end and the exit code is 2. `compare` refuses a result that has any failure. Seed failures abort at once with no JSON. If the reused design changes mid-invocation and reseeding fails, the invocation stops, writes the JSON with the runs so far, `aborted` set and `numbersValid: false`, and exits 2. A failed delete of the seeded design is reported in `cleanupError` and also exits 2.

## Sweeping one design property

`make-sweep-source.ts` writes a `--source` export from a few knobs, with locally generated images and no network: `--screens`, `--dom` (nodes per screen), `--height`, `--image-mp`, `--images-per-screen`, `--loops` (rAF loops per screen), `--out`. Rows are spread so a small board still extends past the view at 10%.

```sh
pnpm exec tsx scripts/canvas-bench/make-sweep-source.ts --screens 300 --out .tmp/sweep/screens-300.json
pnpm exec tsx scripts/canvas-bench/canvas-bench.ts --base-url http://127.0.0.1:9444 --source .tmp/sweep/screens-300.json --action pan
```

`sweep.ts` runs one axis at a time (`--axis screens|dom|height|image-mp|loops --steps 100,300,500`), calls `canvas-bench.ts` per step, and appends a summary line to `results.jsonl` in `--out`. It waits while another benchmark runs and stops an axis after two broken steps in a row (`--keep-going` to continue). A step is broken when a pan, zoom or pan-zoomed p95 is over 33.4 ms or an action failed.

## Known limitations

- `drag` needs private blob storage. On a local dev server without it, `update-design` fails with `DesignCheckpointBlobUnavailableError` for designs over 256 KiB, the app rolls the move back, and drag exits 2. `AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS=1` registers a local provider when `NODE_ENV` is not `production`.
- Zoom ticks per leg depend on the display refresh rate, so `ticksPerLeg` differs across machines.
- The canvas clamps each wheel pan delta at 240 px (`MAX_WHEEL_PAN_DELTA`), so a fling is at most 240 px per tick.
- Playwright wheel dispatch takes about 17 ms per event, which caps the achievable input rate.
- The display refresh rate sets the idle frame time (8.3 ms at 120 Hz). Compare `idleFrameMs` before comparing machines.
- Wheel and mouse input is synthetic, not a real trackpad.
- Headless and dev-server numbers are not a baseline.
- `pan-fling` on a board that barely extends past the view is a few ticks long and samples few frames (about 15 on Startup School), so its percentiles rest on little data. Prefer `pan` there.
- `pan-zoomed` sees few live editors during the gesture, because screens stay static previews while moving.
- The OS focus check only exists on macOS. It records another app in front as a warning; it does not change the numbers.
