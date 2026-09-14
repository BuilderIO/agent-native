# Clips Archive Bulk Unarchive Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Repository checkpoints are created automatically.

**Goal:** Make the Clips Archive tab bulk selection action unarchive selected clips instead of archiving them again.

**Architecture:** The Archive route already identifies itself through `LibraryGrid`'s `view` prop. Derive the bulk action mode at that boundary, configure the shared toolbar label, and choose the existing restore mutation while preserving partial-success selection handling.

**Tech Stack:** React, TypeScript, Vitest, Agent-Native action hooks, localized `useT` strings.

### Task 1: Make the bulk toolbar action contextual

**Files:**
- Modify: `templates/clips/app/components/library/bulk-action-toolbar.tsx`

**Step 1: Add an action mode prop**

Add `archiveAction?: "archive" | "unarchive"` to `BulkActionToolbarProps`, default it to `"archive"`, and keep the existing `onArchive` callback contract.

**Step 2: Render the localized action**

Render `clipsFinalRaw.unarchive` when the mode is `"unarchive"`; otherwise render `libraryGrid.archiveAction`. Keep the existing Archive icon because it is already used for archive lifecycle actions in this surface.

**Step 3: Format**

Run: `pnpm exec oxfmt templates/clips/app/components/library/bulk-action-toolbar.tsx`

Expected: The formatter exits successfully.

### Task 2: Wire Archive selections to restore

**Files:**
- Modify: `templates/clips/app/components/library/library-grid.tsx`

**Step 1: Pass the toolbar mode**

Pass `archiveAction={view === "archive" ? "unarchive" : "archive"}` to `BulkActionToolbar`.

**Step 2: Select the lifecycle mutation**

Inside the existing bulk archive callback, use `restoreRecording.mutateAsync({ id })` when `view === "archive"`; otherwise use `archiveRecording.mutateAsync({ id })`.

**Step 3: Select localized feedback**

For archive-view success and failure, reuse `trashRoute.clipsRestored` and `trashRoute.clipsRestoreFailed`. For other views, retain `libraryGrid.clipsArchived` and `libraryGrid.clipsArchiveFailed`.

**Step 4: Preserve partial failures**

Keep the existing `Promise.allSettled` flow and remove only successful ids from selection.

**Step 5: Format**

Run: `pnpm exec oxfmt templates/clips/app/components/library/library-grid.tsx`

Expected: The formatter exits successfully.

### Task 3: Add focused regression coverage

**Files:**
- Modify: `templates/clips/app/components/library/recording-card.test.ts`

**Step 1: Add archive-view assertions**

Add a focused source-level test that verifies the toolbar supports the unarchive label and `LibraryGrid` passes unarchive mode for the archive view and chooses `restoreRecording.mutateAsync`.

**Step 2: Run the focused test**

Run: `pnpm --dir templates/clips test app/components/library/recording-card.test.ts`

Expected: All tests in the file pass.

### Task 4: Verify the fix

**Files:**
- Verify only

**Step 1: Run typecheck**

Run: `pnpm --dir templates/clips typecheck`

Expected: Typecheck exits successfully.

**Step 2: Run localization guards**

Run: `pnpm guard:i18n-catalogs && pnpm guard:i18n-changed-copy`

Expected: Both guards pass because the implementation reuses existing localized strings.

**Step 3: Verify the rendered flow**

Open the Clips Archive route, select one or more clips, confirm the toolbar says Unarchive, trigger it, and confirm successful clips leave Archive and return to the Library.

Expected: Archive selections can be unarchived and no Archive-again action is shown.
