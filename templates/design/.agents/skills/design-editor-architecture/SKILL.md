---
name: design-editor-architecture
description: >-
  Where design editor behavior lives and how to navigate DesignEditor.tsx. Use
  before changing any editor behavior — undo/redo, paste, delete, duplicate,
  style commit, layer move/rename, export, structure change — or before opening
  `app/pages/DesignEditor.tsx`.
scope: dev
metadata:
  internal: true
---

# Design Editor Architecture

## The routing rule

Editor **behavior** lives in `app/pages/design-editor/`, not in
`app/pages/DesignEditor.tsx`.

`DesignEditor.tsx` is ~20,900 lines and holds only three things: state
declarations, the `useCallback` wrappers that gather arguments, and the JSX.
Every wrapper delegates to a `run<Name>()` command module.

**To change what an editor action does, edit the command module.** Opening
`DesignEditor.tsx` to change behavior is almost always the wrong move — it will
exhaust your context before you find the code.

| Directory | Holds |
| --- | --- |
| `design-editor/commands/` | 86 one-per-action modules, each exporting `run<Name>(args, …)`. Start at `commands/README.md` |
| `design-editor/effects/` | Subscription and autosave loops (collab text, motion autosave, agent selection mirroring) |
| `design-editor/derive/` | Pure derivations (`overview-screens.ts`, `design-breakpoints.ts`) |
| `design-editor/domains/` | Whole-domain hooks owning state + refs + effects + handlers together (`use-tweaks.ts`) |
| `design-editor/*.ts` | Shared helpers: `history.ts`, `selection-state.ts`, `pending-edits.ts`, `editor-state.ts`, `editor-helpers.ts`, … |

## Common task → file

| Task | File |
| --- | --- |
| Undo / redo | `commands/undo.ts`, `commands/redo.ts` |
| Paste | `commands/editor-paste.ts` routes; `commands/paste-selection.ts` and `commands/paste-over-selection.ts` do layers |
| Copy | `commands/copy-selection.ts` |
| Delete | `commands/delete-selection.ts` (layers), `commands/delete-files.ts` (screens) |
| Duplicate | `commands/duplicate-selection.ts`, `commands/duplicate-screen.ts` |
| Style commit | `commands/commit-visual-styles.ts` |
| Inspector style edit | `commands/style-change.ts` (one property), `commands/styles-change.ts` (many) |
| Structure change | `commands/visual-structure-change.ts`, `commands/screen-visual-structure-change.ts` |
| Layer move / rename | `commands/layer-move.ts`, `commands/layer-move-to-screen.ts`, `commands/layer-rename.ts` |
| Lock / hide a layer | `commands/toggle-layer-locked.ts`, `commands/toggle-layer-hidden.ts` |
| Export | `commands/render-png-blob.ts`, `download-pdf.ts`, `download-svg.ts`, `copy-as-figma-svg.ts` |
| Save / persistence | `commands/save-file-content.ts`, `commands/apply-file-content-update.ts` |
| Breakpoints | `responsive-breakpoints` skill; `derive/design-breakpoints.ts` |

A `screen-` prefix means the command is addressed by an explicit `screenId`
(overview canvas or board). The unprefixed twin acts on the focused screen.

Before adding a `domains/` hook, count what it would expose. Past roughly 16
returned values the hook stops hiding anything and just relocates the wiring —
measured surfaces for share/export (20), generation (18), and motion (48) are
all why those still live inline. Also check no input it needs is declared after
the point where its own outputs are first consumed; responsive-interact fails
that test and cannot be extracted without changing when values are read.

## Navigating DesignEditor.tsx when you must

The file carries ~82 section banners. This prints a table of contents:

```bash
grep -n "──" app/pages/DesignEditor.tsx
```

Read one region with an offset and a limit instead of opening the file. Every
section is under ~800 lines. Banners use `// ── Name ──` in the component body
and `{/* ── Render: name ── */}` inside the JSX.

When you add or move a region, add a banner for it.

## Hard constraints

**`DesignEditor.tsx` must keep exactly one runtime export — the default — and
zero runtime named exports.** Type-only exports are fine. Both routes
(`app/routes/design.$id.tsx`, `app/routes/visual-edit.$id.tsx`) import that
default. A named export breaks React Fast Refresh for the whole editor.

**The render-callback trio's dependency arrays are load-bearing.**
`DesignEditor.routeRefreshBoundary.test.ts` parses the file with the TypeScript
compiler and enforces:

- `renderScreenContent` deps are exactly `[renderEditableScreenContent]`
- `renderBreakpointContent` deps are exactly `[renderEditableScreenContent]`
- `renderEditableScreenContent` deps include `activeBreakpointWidthState`,
  `motionDefaultEase`, `motionDurationMs`, `inScreenGradientEditTarget`,
  `handleInScreenGradientEditChange`, and `statePreviewTarget`

That last one exists because cached overview canvases must invalidate on
preview-only state changes. Dropping a name from it renders a stale canvas.

**Many specs read source as text.** ~20 specs `readFileSync` either
`DesignEditor.tsx` or a command module and slice it with `indexOf` markers, then
assert on the source string. Moving code breaks them with a confusing failure.
Re-point the path and the marker in the same commit that moves the code. Prefer
asserting against the command module (`commandSource("undo.ts")`) over the
editor file.

## Prove the gesture, not just the outcome

A gesture test can pass without the gesture. `Shift+drag locks movement to one
axis` asserted only that `top` was unchanged — true of a drag that moves
nothing — and would have kept passing if dragging broke entirely.

Audit by mutation, not by reading. Neuter the gesture in the shared helper and
re-run: every test whose name promises it must fail. You need more than one
mutation, because removing the travel (`{ steps: N }`) leaves a click, and a
click still creates a default-sized primitive — `frame-screen-nesting` passed
8/8 that way and failed 6/8 once `mouse.down()` was removed instead. Prefer the
mutation that removes the precondition over one that corrupts it: committing a
*wrong* inspector value hid a hole that committing *nothing* exposed in one run.

Two traps make a "clean" result meaningless. Mutating one helper audits nothing
that builds its own gesture — inline `mouse.move`, `locator.dragTo()`, keyboard
nudges, and the synthetic events `dragInsideScreen`/`pressPrimaryShortcut`
dispatch inside `page.evaluate` each need their own. And a literal-matching
mutator silently skips variable call sites (`press(undoShortcut)`) and reports
them passing. Map the mutation back to the enclosing tests before concluding.

Five hole shapes, each of which passed with the gesture removed:

- **Only the property that stays still** — assert the one that must change.
- **Only survival** (exists / not hidden / in viewport) — capture position
  first and require it to change.
- **Two runs compared only to each other** — they agree when both are equally
  wrong. Anchor one side to the value actually requested.
- **`indexOf`'s `-1` used as a position** — a *deleted* element reads as
  "correctly ordered". Check both indexes are `> -1` first.
- **A read that coerces its own failure into the asserted value** —
  `.catch(() => [])` before "the list is empty", or `.catch(() => false)`
  before `.toBe(false)`. Let the read throw, or prove the thing exists.
  `guard:e2e-harness` fails on new ones.

A negative-only test ("Escape cancels the move") cannot distinguish any of this
alone; it is sound only while a positive test for the same gesture sits beside
it, and deleting that partner silently guts both.

## Prove the bug before you fix it

Drag, drop, reparent, undo, and duplicate are the behaviors this editor keeps
re-breaking, and they are the ones a reader cannot verify by eye. So a fix to
any of them lands as two things: a test that **fails on the current code for
the reason you claim**, then the change that turns it green. Run the test
before the fix and paste the failure; a test written after the fix only proves
the code does what it does.

**Prove it at the fastest layer that can express the bug.** The E2E suite is
post-merge only, so a bug proven *only* there cannot fail anyone's pull
request — it will rot the way 63 of these specs already did. Reach for the
browser last:

1. A pure function — `tool-state.ts`, `code-layer.ts`, `shared/`, a module
   under `commands/`. These run in PR CI with ~500 other vitest files, in
   seconds. Most drag/undo defects are decidable here once the geometry or
   placement decision is extracted from the gesture.
2. A component test, when it needs React state but not a real iframe.
3. E2E, only when the bug genuinely needs the bridge, a real pointer, or a
   cross-document boundary.

If a bug is only reproducible in E2E, that is worth saying out loud in the PR:
it means the regression net for it is a post-merge run nobody is blocked by.

Most of what looks like a bug here is not. Sweeping this suite turned up tests
asserting an `"Add layer"` label no component renders, a Stroke section that
never had layer rows, a `data-smart-selection` attribute nobody built, a port
(`9340`) nothing serves, and a Frame tool that grew a Frame/Screen split. So
before changing product code, establish which side is wrong:

- **Does the control exist?** `grep` the label and the i18n key. A label that
  lives only in `i18n-data.ts` is rendered nowhere.
- **Does the gate allow it?** Read the condition, not the intent —
  `frameToolDraws === "screen"`, `canRenderAuthenticatedShare`,
  `responsiveInteractActive`. A test that skips the gate is the broken one.
- **Is the assertion self-consistent?** Two specs asserted opposite rectangle
  drop behavior. No code change satisfies both; that needs a contract decision.

When the bug is real and you are not fixing it now, `test.fixme` it with the
symptom in a comment directly above — the observed value, not a guess.
`guard:e2e-quarantine` fails on a parked test with no reason and on the count
growing past its ceiling, so silencing a test to get green is a visible choice
rather than a quiet one.

`pnpm guards` runs that check. Lower the ceiling whenever you fix one.
