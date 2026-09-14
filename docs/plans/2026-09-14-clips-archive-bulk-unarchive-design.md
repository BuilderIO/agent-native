# Clips Archive Bulk Unarchive Design

## Purpose

When users select clips on the Archive tab, the bulk toolbar must offer Unarchive and restore the selected clips to the Library. The current toolbar always offers Archive even though the Archive view contains only archived recordings.

## Approach

Keep the shared bulk toolbar layout and make its archive action mode explicit. `LibraryGrid` derives the mode from `view === "archive"`, passes it to the toolbar, and chooses the existing `restore-recording` mutation for archive selections or `archive-recording` elsewhere.

The mutation keeps the existing partial-failure behavior: successful ids leave the selection, failed ids remain selected, and localized success or error feedback is shown. Existing translations are reused.

## Components

- `bulk-action-toolbar.tsx` renders Archive or Unarchive from an explicit mode prop.
- `library-grid.tsx` owns view context, mutation selection, and success/failure handling.
- Existing source-level component tests provide focused regression coverage for the archive-view wiring.

## Data Flow

1. The Archive route mounts `LibraryGrid` with `view="archive"`.
2. `LibraryGrid` passes unarchive mode to `BulkActionToolbar`.
3. The user selects Unarchive.
4. `LibraryGrid` runs `restoreRecording.mutateAsync` for each selected id.
5. Successful rows disappear from Archive after query invalidation and are removed from selection; failures remain selected.

## Error Handling

Use `Promise.allSettled` as the current bulk archive flow does. Report successful restores and failed restores separately without treating partial failure as full success.

## Verification

Run Clips formatting, focused tests, and typecheck. In the rendered Archive view, confirm selecting clips shows Unarchive and using it removes restored clips from Archive.
