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
| 1 | Slides, Slides 2 | `delete-design-system` | shares |
| 2 | Design | `delete-design`, `delete-file`, `delete-design-template` | 10 tables: shares, files, versions, state, review snapshots, motion timelines, component index, … |
| 2 | Design | `delete-design-system`, `remove-motion-timeline` | shares |
| 3 | Content | `delete-content-space` | every document in the space, recursively |
| 3 | Content | `delete-comment` | reactions |
| 3 | Content | `delete-document-property` | that property's values on every row of the database |
| 4 | Analytics | `delete-explorer-dashboard`, `delete-sql-dashboard`, `delete-analysis` | revisions, shares |
| 4 | Analytics | `delete-monitor`, `delete-status-page`, `delete-data-note`, `delete-key-date(-set)`, `delete-dashboard-view`, `delete-explorer-config` | check results, incidents, key dates |
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

## Phase 0: foundation (done)

1. **Skill**: `soft-delete` in `.agents/skills`, listed in
   `STANDALONE_APP_SKILLS` so every template and scaffold gets it, linked from
   `adding-a-feature`.
2. **Guard** `guard:no-new-hard-delete`: diff-scoped like the other guards.
   It flags added Drizzle deletes on a database handle and `DELETE FROM` SQL
   under `templates|community-templates|apps/*/{actions,server}` unless the
   statement carries `// guard:allow-hard-delete — <why>`. Purge actions and
   the exemptions above use the pragma. Core source is out of scope: its
   deletes are almost all runtime bookkeeping, so core chat threads are
   handled by hand in Phase 1.
3. **Core access honors soft delete.** `registerShareableResource` takes
   `deletedAtColumn`. Stamped rows drop out of `accessFilter`, and
   `resolveAccess` / `assertAccess` return no access to them, so child actions
   that check the parent id (comments, slides, files) stop at a deleted parent
   with no per-app code. Restore and Trash views pass `includeDeleted`. Link
   status reports `trashed` to people who could open the row.
4. **Undo toast**: no new helper. Apps already use sonner's
   `toast(message, { action: { label, onClick } })` (Mail's undo send), and
   the skill shows the one-liner.

## Phase 1: per-app migration

One PR per app, in the order of the table above. Each PR follows the skill's
recipe:

1. Additive nullable `deleted_at` column on the parent table (and on children
   that can be deleted on their own, like comments). Reuse `trashed_at` where
   it exists.
2. Delete action stamps instead of deleting; cascade code moves into the purge
   path unchanged.
3. Restore action, callable by the agent.
4. `deletedAtColumn` on the share registration, plus `includeDeleted` on every
   access call the restore, Trash, and purge paths make, including app
   `authorize` helpers that call `resolveAccess` (Forms'
   `requireFormsPermission` denies restore otherwise).
5. Reads that skip the access check filter stamped rows: public/SSR and embed
   routes, counts, exports, search, jobs, view-screen, agent context, A2A.
   Resources not registered for sharing (Tasks, Factory, Analytics monitors)
   need one app helper that rejects a stamped parent.
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
- **Content**: documents already have the full trash, and they are their own
  shareable resource: `resolveDocumentAccess` grants on the document's owner,
  shares, and public visibility before it ever consults the space. Stamping
  only the space would leave its public and shared pages open. So
  `delete-content-space` stamps the space and trashes every live document in
  it, marking them through the existing `trash_root_id` / `trash_origin`
  columns as trashed by the space; restoring the space restores only those,
  so pages trashed before the space stay in the trash.
- **Tasks**: bulk delete returns the ids it stamped so one Undo restores the
  whole batch.
- **Factory**: unschedule the workflow's job on soft delete and reschedule on
  restore; parked items keep their state.
- **Core chat**: thread delete becomes `deleted_at` on the threads store
  (append a `defineStore()` migration; see `framework-stores`). Needs a
  changeset.

## Verification per app PR

- Delete from the UI, see the Undo toast, click Undo, and the object returns
  with its comments/versions intact.
- Ask the agent to delete it, then ask the agent to undo; same result.
- While stamped: the list, search, public link, and agent `view-screen` do not
  show it; the owner's share link says it is in the trash.
- Purge from the Trash view; the rows and blobs are gone.
