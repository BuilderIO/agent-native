---
name: design-editor-performance
description: >-
  What each screen costs on Design's canvas, the budgets that bound it, and how
  to prove a change keeps them. Use when changing culling, previews, live
  editors, zoom/pan/drag, DesignEditor hooks or caches, or when Design lags,
  flashes, or grows memory.
scope: dev
---

# Design Editor Performance

The general rules (closure chains, cache budgets, view swaps, measuring after
GC) are in the root `performance` skill, §11. This is what they mean on the
board, where one user session holds dozens of multi-megabyte screens.

## What a screen costs

| Shown as | Runs in | Costs | Bounded by |
| --- | --- | --- | --- |
| Live editor | same-origin iframe, main thread | ~20 MB and ~380 ms of main thread to boot | 32 in the pool, 4 booting at once, 3 kept warm through a zoom-out |
| Static preview | sandboxed `srcdoc` iframe, preview process | its ~2 MB `srcdoc` string in the main heap; the preview process renders one at a time | 64, nearest first, then screens already seen |
| Placeholder | nothing | nothing | everything else |

A screen gets an editor at ≥240 px on screen and loses it below 180 px, only
once the camera has rested 250 ms; hovering promotes after 300 ms. The pool
sizes and thresholds live in `multi-screen/culling.ts`; the timings and the
warm count are constants at the top of `MultiScreenCanvas.tsx`.

## Rules for changes here

- **Decide in `multi-screen/culling.ts`, wire in `MultiScreenCanvas.tsx`.** The
  selection functions are pure; prove a policy change in
  `MultiScreenCanvas.culling.test.ts` or the boot-budget component test, not in
  a browser.
- **Swaps hand off; they never blank.** `staticPreviewHandoffById` keeps a
  painted preview over an editor until that editor's own ready signal (the
  8-second boot timeout frees a boot slot but proves nothing was drawn), and a
  demoted editor until its preview has painted. The preview slot stays ahead
  of `{screenContent}` in the DOM: that order puts it under a running editor
  and keeps the iframe from being re-inserted, which would reload it.
- **A screen already seen keeps its preview** (`retainedIds`). Unmounting one
  rebuilds it from blank when the camera returns, which users read as the
  board "rebuilding itself".
- **Previews are parsed off the main thread before they mount.** The canvas
  hands the workers the screens it is about to mount with `wantPreviewParses`,
  which replaces its last list, and admission waits for each result. Workers
  take one job at a time, so a pan never buries the screens now in view.
  Don't parse a screen on mount.
- **In `DesignEditor.tsx`, never capture a heavy value in a hook.** A
  `useCallback` or `useMemo` that closes over a projection, tree, layer model or
  file content pins that render, and every render chained behind it. Take
  trees and node maps from `cachedCodeLayerTree` / `cachedCodeLayerNodeById`
  (`shared/code-layer.ts`), and read the latest value through a ref.
- **Layer models are built on demand** (`derive/layer-model-coverage.ts`).
  Don't add an `isNeeded` condition that keeps a screen's model for the rest of
  the session; that is how the board's heap passed a gigabyte.
- **A command that knows its result before the server answers starts the work
  during the round trip.** `duplicate-screen.ts` annotates and parses the copy
  while `create-file` is in flight.
- **Drag isolation lasts only for the drag.** `isolateMovingPreviewIframes`
  gives a moving screen's iframes their own layer and removes it on drop.

## Proving a change

1. **A count in a unit or component test**, in the fast lanes. The existing
   ones show the shapes that work: `code-layer.recent-documents.test.ts`
   (documents retained), `memoize-by-content` (characters cached), the
   culling tests (previews retained, warm editors), and the boot-budget tests
   (preview survives a promotion, demoted editor waits for paint).
2. **`pnpm perf:runtime-budget`**, against a production build started with
   `AUTH_DISABLED=1`. It seeds the 48-screen stress board, runs four rounds of
   select, text edit, fill color, duplicate, a zoom cycle and screen visits,
   and compares with `scripts/runtime-budget.json`. It exits 0 within budget,
   1 over budget, and 2 when a step did not take effect. It runs as the
   `Runtime budget` check of the Design E2E workflow, on the same pull requests
   that workflow already runs for. The gates (heap, blanked screens, live
   editors) each carry their reason in the JSON; editor churn and frame times
   are reported only, because shared runners are too noisy for a fixed limit.
   When a change improves a gated number, lower its `max` in the same PR.
3. **When the budget fails or a report comes in**, read
   `references/measuring.md` for the local setup, the traps that faked results,
   and how to find what holds memory.
