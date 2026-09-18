# Large-canvas rendering investigation — 2026-09-18

Evidence for [PR #5345](https://github.com/BuilderIO/agent-native/pull/5345),
with the final runtime changes at `20f1189fbb`.

## Outcome and limits

Restarted-Chrome testing reproduced missing Inspector/sidebar pixels during
low-zoom canvas navigation. An explicit backdrop root on the untransformed
canvas viewport removed the oversized backdrop-filter mask layers, with
authored effects and full frame dimensions preserved. The native Chrome
scenarios listed below no longer showed the reported panel gaps.

This establishes a targeted rendering correction, not universal canvas
stability, production latency, beta readiness, or Figma performance parity.
Sustained pinch, Inspector scrolling, and edit/undo stress remain unverified.

## Reproduction environment

| Item                         | Observed configuration                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser                      | Chrome 152.0.7977.82, restarted during the investigation                                             |
| Platform                     | macOS 26.6.2, Apple M5, ANGLE Metal, Skia Graphite                                                   |
| Acceleration                 | Hardware compositing and rasterization; zero reported GPU-process crashes at inspection              |
| App                          | Local Design development server, local dev authentication, existing imported design                  |
| Imported documents           | Three desktop frames at 1440 × 32204; three responsive frames at 390 × 42728                         |
| Board                        | Live window 24576 × 24576; static sample 4096 × 4096, representing a 131072 × 131072 logical surface |
| Final Layers comparison      | Normal desktop viewport 4010 × 2646 physical pixels, DPR 2; camera zoom 3.71%                        |
| Separate Performance capture | Emulated 1440 × 1024 CSS pixels, DPR 2; no CPU/network throttling; approximately 2.78–3.35% zoom     |

The reproduction is DOM/iframe-based. A WebGL context loss was not observed.
Missing UI rectangles remained present in accessibility/DOM inspection while
native screenshots showed missing paint. Reloading alone was insufficient:
the same failure reproduced after the user restarted Chrome.

## Findings and retained fixes

### Backdrop-filter mask bounds

At 3.71% zoom, Chrome Layers exposed dozens of anonymous 108195 × 71430 layers
interleaved with backdrop-filter nodes. These dimensions approximately match
the physical viewport divided by camera scale, including mask outsets. A
selected `nav.nav` layer reported a backdrop-filter compositing reason.

The isolation sequence was:

| Experiment                                                            | Result                                                                         | Disposition                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| `clip-path: inset(0)` on host iframes                                 | Enormous anonymous layers remained                                             | Reverted                             |
| Same clip on iframe document roots                                    | Enormous anonymous layers remained                                             | Reverted                             |
| Temporarily disable only document backdrop filters                    | Enormous masks disappeared; tested pan kept panels painted; 58 layers remained | Diagnostic only; reverted            |
| Restore effects and set `html { will-change: opacity }` inside frames | Enormous masks disappeared, but each document acquired its own boundary        | Replaced by shared viewport boundary |
| `will-change: opacity` on the untransformed canvas viewport           | Enormous masks disappeared with effects restored                               | Retained                             |

The retained boundary is `data-design-canvas-container` in
[DesignEditor.tsx](../app/pages/DesignEditor.tsx). It contains overview,
single-screen, and responsive Interact, including the canvas background. It
does not change actual opacity, author filters, source content, or responsive
dimensions. Existing `isolation: isolate` alone did not produce the successful
backdrop-root boundary.

Chromium's [property-tree implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/graphics/compositing/property_tree_manager.cc)
delegates backdrop effects to the outermost synthetic clip. That implementation
and the experiments support the explanation that the shell's rounded clip was
being projected into the scaled effect coordinates. This is an inference from
source and observed layer behavior, not a Chromium bug-fix claim.

### Other paint and camera defects

- Wheel gestures applied `filter: blur(0.001px)` to iframes, including pan-only
  gestures, then cleared the filter. This bypassed size-aware retention and
  overwrote existing inline filters. Removed; pan/zoom regressions failed
  before the change and passed afterward.
- The static board replica used a 131072 × 131072 world-space wrapper. Its
  camera clip followed debounced React state rather than the imperative camera
  tick. The wrapper now lives in viewport coordinates outside the scaled world;
  its transform and retention policy update on the camera animation frame.
- Small camera zoom could incorrectly re-enable paint retention on large native
  iframe dimensions. Eligibility now considers at least native/display size,
  not only the shrunken screen footprint.
- Canvas containment changed the containing block of fixed transform feedback.
  That feedback is now portaled outside the canvas; release, Escape, and
  unmount cleanup are covered by regressions.
- Toolbar zoom updated React's world transform while leaving an imperative
  `--an-chrome-scale` value stale, producing enormous frame labels. The rendered
  world style now updates both properties. The new regression failed before the
  fix and passed at 3.71%, 25%, 50%, 100%, and 3.35% afterward.
- Wheel-camera updates remain imperative, with React/application-state commits
  deferred until gestures settle. Explicitly fixed frame heights remain fixed.

Relevant implementation:
[MultiScreenCanvas.tsx](../app/components/design/MultiScreenCanvas.tsx),
[overview-layout.ts](../app/components/design/multi-screen/overview-layout.ts),
[scaled-iframe-paint.ts](../app/components/design/scaled-iframe-paint.ts), and
[DesignCanvas.tsx](../app/components/design/DesignCanvas.tsx).

## Layer measurements

**All memory figures below are Chrome DevTools estimates from layer bounds.
They are not resident GPU memory measurements, allocation totals, or FPS
benchmarks. Do not describe their reduction as a measured speedup.**

| Observation                                                    | Layer count | Displayed total estimate | Notable layer bounds                                                   |
| -------------------------------------------------------------- | ----------: | -----------------------: | ---------------------------------------------------------------------- |
| Earlier hot-reloaded session, before static-replica relocation |         115 |                 40112 MB | Replica-associated 85971 × 61135; its estimate was 21023 MB            |
| Earlier hot-reloaded session, after replica relocation         |         114 |                 19088 MB | Oversized replica wrapper removed                                      |
| Restarted Chrome, before backdrop-root fix                     |         157 |               1409694 MB | Dozens of anonymous masks at 108195 × 71430                            |
| Same normal desktop viewport and zoom, final shared boundary   |          98 |                 17992 MB | Remaining anonymous UI masks approximately viewport-sized, 4014 × 2650 |

The two sessions have different viewport conditions; do not combine them into
a single before/after benchmark. The replica change improved one source of
paint pressure but did not resolve the fresh-process reproduction by itself.

Read-only inspection after the final boundary confirmed:

- Desktop iframe dimensions remained 1440 × 32204.
- Responsive iframe dimensions remained 390 × 42728.
- Authored navigation backdrop filters remained `blur(14px)`.
- Live board/static sample dimensions remained unchanged.
- No temporary diagnostic style remained in the frame documents.

## Rejected experiments and data integrity

Reducing the live board window did not reliably eliminate corruption. CSS
`zoom` and inverse-zoom compensation changed responsive layout: a nominal
1440 px iframe became approximately 1432 px wide. Forced whole-world transform
compositing increased layer estimates. These changes, temporary board hiding,
live-board relocation, and profiling effects were reverted.

The rejected CSS-zoom experiment persisted three responsive measured heights
as 70284. Those three measurements were restored to 42728 through the existing
`update-design` action and verified after reload. Source content, frame
positions, and height modes were not changed by the restoration.

A separate local PGlite runtime abort caused background action failures while
static modules still served. The same server/database was restarted; no
database was deleted or reinitialized. This was distinct from the painting
defect.

After the final attempted Inspector-edit check, action-read SHA-256
fingerprints confirmed all four design files and screen metadata unchanged.
The edit did not commit, so it is not counted as an edit/undo pass.

## Development-build Performance trace

A separate capture covers zoom-to-fit and three pan reversals. The selected
DevTools range spans 65,145 ms, including idle time between interactions.

| Category  | Time displayed |
| --------- | -------------: |
| Scripting |        4174 ms |
| System    |        1681 ms |
| Rendering |         227 ms |
| Painting  |         130 ms |
| Loading   |          23 ms |
| Messaging |          15 ms |

DevTools identified a 2087 ms INP event: approximately 2.09 s input delay,
0 ms processing, and 1 ms presentation delay. Within the selected interaction
range, Bottom-up reported 908.7 ms inclusive for `Run console task`, 185.8 ms
for `createTask`, and 249.0 ms for React `exports.jsxDEV`. These inclusive times
overlap and must not be summed.

Offline trace inspection found that the longest renderer task, 1306.86 ms,
contained 1298.679 ms in `CpuProfiler::StartProfiling`. Development/debug work
and measurement overhead are substantial in this capture. These results
locate development costs; they do not establish production latency or identify
every contributor to the slow interaction.

An earlier single-wheel rAF probe measured a 365.8 ms maximum interval. A
167.5 ms interval belonged to the rejected CSS-zoom experiment and is not a
final-patch speedup. Another 60-second probe was interrupted by tab switching
and excluded from performance conclusions. No temporary probe is shipped.

### Raw artifact provenance

- Filename: `canvas-boundary-pan-trace.json.gz`
- Compressed size: 17,611,031 bytes
- SHA-256: `5c0d6b2094a0f2090de63807fd107e0a555fd2dbe090880b280088c5fb7009a6`
- Trace events: 1,289,245
- Resource bodies and source maps: excluded at export
- Screenshots: included

The raw capture is retained locally, not committed or attached to the PR. It
contains captured page imagery and browser/page metadata. This report exposes
the relevant measurements without publishing that payload, private design
identifiers, or local machine paths. A shared raw artifact requires a separate
privacy review and an appropriate attachment location.

## Verification at runtime commit `20f1189fbb`

Native Chrome, including checks with DevTools closed:

- Zoom-to-fit at 3.71% and canvas panning.
- Element selection with the Inspector populated.
- 50% and 100% zoom, including high-zoom panning.
- Normal-size labels after the counter-scale fix.
- Single-screen Interact and document scrolling.

No missing Inspector/sidebar rectangles were observed in these scenarios with
the final boundary. This is bounded coverage, not proof that no rendering bugs
remain.

Automated validation:

- 246 tests passed across nine focused files, listed below.
- App no-emit TypeScript check passed.
- Formatting and `git diff --check` passed.
- All 76 repository guards passed.
- Independent read-only diff review found no actionable regressions.

From `templates/design`, the focused test command was equivalent to:

```sh
pnpm exec vitest run \
  app/pages/DesignEditor.paintBoundary.test.ts \
  app/components/design/MultiScreenCanvas.wheel.test.tsx \
  app/components/design/MultiScreenCanvas.camera-command.test.tsx \
  app/components/design/MultiScreenCanvas.primitives.test.ts \
  app/components/design/MultiScreenCanvas.gestures.test.tsx \
  app/components/design/MultiScreenCanvas.fit.test.tsx \
  app/components/design/MultiScreenCanvas.hydration-camera.test.tsx \
  app/components/design/DesignCanvas.embedded-frame-live.test.tsx \
  app/components/design/scaled-iframe-paint.test.tsx
pnpm exec tsc --noEmit -p tsconfig.json
```

Repository guards were run from the repository root with `pnpm guards`.
Source-contract/component tests do not exercise GPU compositing; native
Chrome observation supplies the rendering evidence above.

## Follow-up acceptance checks

1. Repeat sustained trackpad pinch, pan reversals, Inspector scrolling,
   overlays, and edit/undo with uninterrupted browser ownership.
2. Benchmark a production build separately from Vite/React development
   instrumentation. Record gesture cadence, viewport/DPR, hardware, warm-up,
   frame intervals, input latency, and profiler overhead before comparing
   builds or claiming a speed target.
3. Recheck full imported dimensions, responsive layout, text sharpness, and
   authored blur/shadows/masks. Do not obtain stability by shrinking the design
   or removing effects.
4. Treat renewed panel corruption as a failed rendering check even if DOM,
   component tests, and aggregate timing summaries appear healthy.
