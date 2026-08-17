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

`DesignEditor.tsx` is ~20,700 lines and holds only three things: state
declarations, the `useCallback` wrappers that gather arguments, and the JSX.
Every wrapper delegates to a `run<Name>()` command module.

**To change what an editor action does, edit the command module.** Opening
`DesignEditor.tsx` to change behavior is almost always the wrong move — it will
exhaust your context before you find the code.

| Directory | Holds |
| --- | --- |
| `design-editor/commands/` | 85 one-per-action modules, each exporting `run<Name>(args, …)`. Start at `commands/README.md` |
| `design-editor/effects/` | Subscription and autosave loops (collab text, motion autosave, agent selection mirroring) |
| `design-editor/derive/` | Pure derivations (`overview-screens.ts`, `design-breakpoints.ts`) |
| `design-editor/*.ts` | Shared helpers: `history.ts`, `selection-state.ts`, `pending-edits.ts`, `editor-state.ts`, `editor-helpers.ts`, … |

## Common task → file

| Task | File |
| --- | --- |
| Undo / redo | `commands/undo.ts`, `commands/redo.ts` |
| Paste | `commands/editor-paste.ts` routes; `commands/paste-selection.ts` does layers |
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

## Navigating DesignEditor.tsx when you must

The file carries ~79 section banners. This prints a table of contents:

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
