# Soft delete across all apps

## Goal

Deleting anything a person made becomes undoable in every first-party app.
Delete stamps `deletedAt`, all reads hide stamped rows, a restore action
clears the stamp, and removing rows for good is a separate purge step. The
stamp's date lets an app add retention later ("purge after 30 days") without
requiring it now.

The rules for new code live in the `soft-delete` skill
(`.agents/skills/soft-delete/SKILL.md`), which ships to every template and
generated app. This document covers migrating what already exists.

## What already works

| App | Object | Column | Restore | Purge |
| --- | --- | --- | --- | --- |
| Forms | form | `deleted_at` | `restore-form` | `delete-form --purge` |
| Clips | recording | `trashed_at` | `restore-recording` | `delete-recording-permanent` |
| Clips | meeting | `trashed_at` | — | — |
| Content | document, database | `trashed_at` | `restore-document`, `restore-content-database` | trash purge plan + worker |
| Plan | visual plan, plan comment | `deleted_at` | `delete-visual-plan restore` | `mode: "hard"` with approval |
| Mail | email | Gmail trash | `untrash-email` | Gmail |
| Brain | source | `status = 'archived'` | — | — |
| Core chat | thread archive | `archived_at` | archive toggle | delete is hard |

Forms is the reference implementation. Content registers an `availability`
rule so share links report "in the trash"; Clips does not yet.

## What is still a hard delete

Ordered by how much is lost on one mistaken call. "Children" are rows the
delete cascades into today and would come back automatically once the parent
is only stamped.

| # | App | Action(s) | Children removed today |
| --- | --- | --- | --- |
| 1 | Slides | `delete-deck` | versions, slide comments |
| 1 | Slides | `delete-slide-comment` | — |
| 1 | Slides 2 | `delete-deck`, `delete-slide-comment`, `delete-asset` | shares, share links, events, versions, uploaded assets, comments |
| 2 | Design | `delete-design`, `delete-file`, `delete-design-template` | 10 tables: shares, files, versions, state, review snapshots, motion timelines, component index, … |
| 3 | Content | `delete-content-space` | every document in the space, recursively |
| 3 | Content | `delete-comment` | reactions |
| 4 | Analytics | `delete-explorer-dashboard`, `delete-sql-dashboard`, `delete-analysis` | revisions, shares |
| 4 | Analytics | `delete-monitor`, `delete-status-page`, `delete-data-note`, `delete-key-date(-set)`, `delete-dashboard-view` | check results, incidents, key dates |
| 5 | Tasks | `delete-task`, `bulk-delete-tasks`, `delete-inbox-item`, `bulk-delete-inbox-items`, `delete-custom-field` | custom field values |
| 6 | Factory | `delete-factory`, `delete-factory-workflow` | versions, runs, steps, item state/events, receipts, cursors |
| 7 | Assets | `delete-asset(s)`, `delete-folder`, `delete-library`, `delete-template` | library contents |
| 8 | Clips | `delete-comment`, `delete-folder`, `delete-space`, `delete-cta`, `delete-dictation` | — |
| 9 | CRM | `delete-crm-saved-view`, `remove-crm-list-entry` | saved view shares |
| 9 | Calendar | `delete-booking-link` | slug redirects |
| 10 | Core chat | thread delete | submission inbox, thread shares |

### Stays a hard delete

Per the skill's exemptions; each action's description should say why:

- Credentials and connections: `delete-data-source-credentials`,
  `delete-db-admin-connection`, `delete-workspace-connection`,
  `disconnect-calendar`.
- Revocations: `remove-member`, `remove-space-member`,
  `remove-overlay-person`, `remove-external-calendar`, unsharing.
- Derived or ephemeral: `delete-staged-dataset` (every app),
  `delete-design-state`, `remove-content-recent`, `delete-user-pref`,
  `purge-first-party-analytics-postgres`.
- Provider-owned: Calendar `delete-event(s)` (Google Calendar), Mail
  `trash-email` (Gmail trash is already reversible).
- Version deletes where restore-version already covers undo:
  `delete-factory-automation-version`.
- Low-value config rows where a toast Undo can re-create the row from the
  returned payload instead: `delete-email-rule`, `delete-alias`,
  `delete-analytics-alert-rule`, `delete-generation-preset`,
  `delete-data-dictionary-entry`. Revisit only if users ask.

## Phase 0: foundation

1. **Skill** (done in this change): `soft-delete` in `.agents/skills`, listed
   in `STANDALONE_APP_SKILLS` so every template and scaffold gets it, linked
   from `adding-a-feature`.
2. **Guard** `no-new-hard-delete`: diff-scoped like the other guards. It flags
   added `.delete(` / `DELETE FROM` lines under `templates/*/actions`,
   `templates/*/server`, and `packages/core/src` unless the line carries
   `// hard-delete-ok: <reason>`. The skill alone is guidance; this is what
   makes "new delete features soft-delete" hold. Purge actions and the
   exemptions above use the pragma.
3. **Decide whether `accessFilter` / `resolveAccess` should honor
   `availability`.** Today `availability` only changes what a share link says;
   every app must also add `isNull(deletedAt)` to each read, and one missed
   read path leaks a deleted object through a public link or the agent. A core
   option on the registration (e.g. `availability.hideFromAccess: true`) that
   adds the predicate inside `accessFilter` and makes `resolveAccess` return
   null for stamped rows would remove most of that per-app surface. Restore and
   trash-list actions would read through an explicit `includeDeleted` path.
   This touches every ownable read, so it needs its own design review before
   app migrations start; apps migrated before it lands keep their explicit
   filters, which stay correct afterward.
4. **Undo toast.** Check the toolkit organization kit (archive, trash) first.
   If nothing fits, add one shared `toastWithUndo(message, onUndo)` client
   helper so every app's delete reads the same and goes through i18n once.

## Phase 1: per-app migration

One PR per app, in the order of the table above. Each PR follows the skill's
recipe:

1. Additive nullable `deleted_at` column on the parent table (and on children
   that can be deleted on their own, like comments). Reuse `trashed_at` where
   it exists.
2. Delete action stamps instead of deleting; cascade code moves into the purge
   path unchanged.
3. Restore action, callable by the agent.
4. Every read path filters: list, get, search, counts, exports, public/SSR
   routes, share links, embeds, view-screen, agent context, A2A.
5. `availability` on the share registration.
6. Partial unique indexes where a slug/name is unique (e.g. Calendar
   `booking_links.slug`); audit each app's `.unique()` columns.
7. UI: optimistic delete with an Undo toast; a Trash view for top-level
   artifacts (decks, designs, dashboards, factories, libraries). Drop the
   confirm dialogs that only existed because delete was permanent.
8. Purge: existing cascade behind `--purge` or `delete-<thing>-permanent`,
   approval-gated, requiring the row to be stamped first.
9. Update the app's own skills/AGENTS.md wherever they describe delete as
   permanent, plus a changelog entry (`agent-native changelog add`).

App-specific notes:

- **Slides / Slides 2**: realtime `deck-deleted` notifications stay; add a
  `deck-restored` event so open tabs recover. Public deck links must 404 while
  stamped.
- **Design**: do not delete blobs for files on soft delete; only purge does.
- **Content**: documents already have the full trash; `delete-content-space`
  should stamp the space and rely on its documents being unreachable through
  it, rather than trashing every document individually (restoring the space
  must not resurrect documents that were trashed before it).
- **Tasks**: bulk delete returns the ids it stamped so one Undo restores the
  whole batch.
- **Factory**: unschedule the workflow's job on soft delete and reschedule on
  restore; parked items keep their state.
- **Core chat**: thread delete becomes `deleted_at` on the threads store
  (append a `defineStore()` migration; see `framework-stores`). Needs a
  changeset.

## Phase 2: retention (optional, per app)

Not required to ship Phase 1. When an app wants it:

- A `recurring-jobs` task per app that purges rows with
  `deleted_at < now() - retention`, using the same purge path the manual
  "Delete forever" uses so blobs and children go too.
- Retention is an app config field (`packages/core/src/app-config/`), off by
  default. Never run purges at startup.
- Content's purge plan/worker is the model for large trees: plan, then purge
  in bounded batches with an operation record.

## Verification per app PR

- Delete from the UI, see the Undo toast, click Undo, and the object returns
  with its comments/versions intact.
- Ask the agent to delete it, then ask the agent to undo; same result.
- While stamped: the list, search, public link, and agent `view-screen` do not
  show it; the owner's share link says it is in the trash.
- Purge from the Trash view; the rows and blobs are gone.
