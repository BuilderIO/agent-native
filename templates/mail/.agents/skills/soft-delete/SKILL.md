---
name: soft-delete
description: >-
  Delete features soft-delete by default: stamp `deletedAt`, hide the row from
  every read, and offer restore, so a user or the agent can always undo. Use
  when adding or changing any delete, remove, trash, archive, or purge action or
  button, a table that holds user-created objects, or a list/read path over one.
scope: dev
---

# Soft Delete

## Rule

Deleting something a person made must be undoable. A delete action stamps
`deletedAt` on the row instead of removing it, every read hides stamped rows,
and a matching restore action clears the stamp. Removing the row forever is a
separate, explicit purge step.

## Why

Agents delete things on request, and requests are ambiguous: "clean up these
decks" can take out the wrong deck in one tool call. Users misclick. A hard
delete makes either mistake permanent and also destroys everything that hung
off the row (comments, versions, responses). The stamp also records *when* it
was deleted, which is what lets an app later purge rows older than N days
without having to guess.

## What it covers

Soft-delete user-authored data: top-level artifacts (decks, designs, forms,
documents, dashboards, plans, tasks, recordings, assets, saved views) and the
user-authored children inside them (comments, slides, responses, notes).

Hard delete is still right for these, and the action description should say
why in one clause:

- Credentials, tokens, and connections: removing one must revoke it now
  (`security`, `secrets`).
- Revocations: unsharing, removing a member, leaving a space. The audit log
  keeps the history (`audit-log`).
- Derived or ephemeral rows: caches, staged datasets, thumbnails, sessions,
  `application_state`.
- Data the provider owns (Gmail, Google Calendar): call the provider's own
  trash or delete; do not mirror it in a local column.
- Version history rows when restoring a version already covers undo.

## Recipe

In the agent-native repo, Forms is the reference implementation
(`delete-form`, `restore-form`, `list-forms`), and Clips shows the same shape
with a separate permanent action (`trash-recording`, `restore-recording`,
`delete-recording-permanent`).

1. **Schema.** Add a nullable `deletedAt: text("deleted_at")` column. This is
   additive and old rows read as not deleted, so no backfill. Keep an existing
   `trashedAt` column where an app already has one; do not add a second.
2. **Delete action.** Set `deletedAt` (and `updatedAt`) to now and return
   `deletedAt`. Keep the same access check the hard delete had. Leave the
   children unstamped, so restoring the parent brings back all of them exactly
   as they were; step 4 is what hides them meanwhile.
3. **Restore action.** `restore-<thing>` sets `deletedAt` back to null after
   the same access check. The agent needs it as much as the UI does: undo is
   how it recovers from its own mistake.
4. **Every read filters.** Add `isNull(table.deletedAt)` to list, get, search,
   count, export, public/SSR, share-link, embed, and agent-context reads.
   Missing one is the main bug this pattern causes: a deleted deck that still
   renders from its public link, or a deleted comment the agent still quotes.
   A get of a deleted row returns not-found, except the restore action and the
   trash list. Children filter on their own `deletedAt` when they can be
   deleted on their own.
   **Children are not hidden by the parent's stamp.** Child actions usually
   call `assertAccess("deck", deckId)` and then query comments by `deckId`,
   and `assertAccess` still passes for a stamped deck (step 5). Put one
   app-level helper in front of the parent's access check that also rejects a
   stamped parent, and route every action that takes a parent id through it:
   reads and writes, so nobody can add a comment to a trashed deck either.
5. **Share links.** If the resource is registered with
   `registerShareableResource`, add
   `availability: { columns: ["deletedAt"], isAvailable: (r) => !r.deletedAt }`
   so a link tells someone who can open it that it is in the trash. This only
   changes link status; `accessFilter` and `resolveAccess` still return the
   row, so step 4 is still required.
6. **Uniqueness.** A stamped row still holds its slug or unique name. Scope a
   unique index to `deleted_at IS NULL`, or make restore fail with a clear
   error when the name is taken.
7. **UI.** Delete is instant and optimistic: no confirm dialog, and a toast
   with an Undo button that calls the restore action. A top-level artifact
   with many rows also gets a Trash (or Archive) view listing deleted rows with
   Restore and Delete forever. Copy goes through the app's i18n catalog
   (`internationalization`).
8. **Purge.** Only the purge path removes rows: a `--purge` flag or a
   `delete-<thing>-permanent` action that requires the row to already be
   stamped, keeps `needsApproval`, and also deletes blobs and child rows.
   Automatic retention (purge rows stamped more than N days ago) belongs in a
   `recurring-jobs` task, not in a request path or at startup.

## Checklist

- [ ] `deletedAt` column added (or the existing `trashedAt` reused)
- [ ] Delete action stamps instead of deleting; children untouched
- [ ] Restore action exists and the agent can call it
- [ ] Every read path filters stamped rows, including public and agent reads
- [ ] Actions that take a parent id reject a stamped parent (reads and writes)
- [ ] Share registration has an `availability` rule, if shareable
- [ ] Unique slugs/names don't block a new row or a restore
- [ ] UI: optimistic delete with Undo; Trash view for top-level artifacts
- [ ] Purge is separate and approval-gated, and removes blobs too

## Related Skills

- **storing-data**: schema and migration rules (additive only)
- **sharing**: `registerShareableResource`, `accessFilter`, `assertAccess`
- **actions**: `defineAction`, `needsApproval`
- **recurring-jobs**: scheduled retention purges
