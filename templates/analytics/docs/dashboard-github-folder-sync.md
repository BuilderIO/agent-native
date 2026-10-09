# GitHub folder sync for dashboards

Dashboard folders can be linked to a folder in a GitHub repository. Each
dashboard in the linked folder is stored as one JSON file, `<dashboardId>.json`.
From the folder's menu, **GitHub sync** opens a dialog with three actions:

- **Pull from GitHub** writes changes made in the repo into the app.
- **Export to GitHub** opens a pull request with changes made in the app.
- **Check GitHub** compares both sides without writing anything.

Sync is optional. A folder without a link behaves exactly as before, and
dashboards outside a linked folder are never read from or written to GitHub.

## Setup

1. Connect GitHub for the workspace, or sign in with GitHub, so the app has a
   token with access to the repo. The token is resolved on each request and is
   never stored in the folder.
2. Open the folder's **GitHub sync** dialog and enter the owner, repo, branch,
   and path. Branch defaults to `main` and path to `dashboards`.
   - The branch is checked when you save. A missing branch fails the save.
3. Export first to seed the repo. Every dashboard in the folder gets a file
   with the same content as the app.

Saving a link, or unlinking, clears the sync base of every dashboard in the
folder. The next preview treats them as new.

## The unit of sync

Changes are compared by unit, not by file:

| Unit          | What it covers                                             |
| ------------- | ---------------------------------------------------------- |
| `panel:<id>`  | One panel, identified by its stable panel id               |
| `order`       | The sequence of panel ids                                  |
| `meta`        | Everything else in the dashboard config, including title   |

So an edit to one chart in the app and an edit to a different chart in GitHub
both apply. A conflict only happens when both sides changed the same unit
differently. Conflicting units are reported and left alone; the rest of the
dashboard still syncs.

## Statuses

| Status              | Meaning                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `in-sync`           | Nothing changed on either side                                      |
| `github-changed`    | GitHub has changes that pull would apply                            |
| `app-changed`       | The app has changes that export would write                         |
| `both-changed`      | Both sides changed, on different units. Pull and export both apply  |
| `conflict`          | Both sides changed the same unit differently. Nothing is applied for it |
| `not-exported`      | A dashboard in the folder has no file in GitHub yet                 |
| `new-in-github`     | A file has no dashboard yet. Pull creates it in the folder          |
| `removed-in-github` | The file was deleted in GitHub. The dashboard is kept and export refuses |
| `export-pending`    | An export PR for this dashboard is open                             |
| `no-access`         | You cannot edit this dashboard, so it is not touched                |

## Pull

Pull reads each changed file and applies only the units GitHub changed. It:

- updates or deletes panels whose content GitHub changed, and skips panels the
  app changed;
- adopts GitHub's panel order when the app did not reorder the same panels;
- creates a dashboard for each file that has no dashboard yet;
- validates every changed panel's SQL and config before writing, so an invalid
  panel fails that dashboard without writing a partial result.

Pull never deletes a dashboard, even when its file was deleted in GitHub.

Pull is safe to run again. If it stops partway, the next run re-reads the
dashboards and converges, because a unit that already matches GitHub needs no
write.

## Export

Export writes the app's version of each dashboard that changed since the last
sync, and opens one pull request for the folder. A dashboard is skipped with a
reason when:

- its GitHub file changed since the last sync (pull first),
- its GitHub file was deleted (export does not recreate it),
- or the user cannot edit it.

Until the PR merges, the exported dashboards stay in the state they were in
before the export, so a later export proposes the same changes again. After the
PR merges, the next pull, export, or apply records the exported state as the
new base. If the PR is closed without merging, the base is left alone and the
changes export again.

Only one export PR can be open per folder. Pull and export refuse to run while
it is open, and name it in the error.

## Conflicts

A conflict is shown in the dialog with its unit names, for example
`Panel: Churn by plan` or `Panel order`. To resolve it, make the two sides match:
edit the dashboard in the app to the GitHub version, or change the file in
GitHub to the app version, then pull or export again. The first sync of a
folder that already had files can produce conflicts wherever the two versions
differ.

## What sync does not cover

- Explorer dashboards. Only SQL dashboards in a folder are synced.
- Sharing, visibility, and ownership. A file never changes who can see a
  dashboard. A new dashboard created by pull is owned by the user who pulled.
- Deletions. Deleting a file does not delete its dashboard, and deleting a
  dashboard does not delete its file.
- Moving a dashboard into or out of a folder. Pull creates only new
  dashboards in the folder; it does not move existing ones.
- Scheduled sync. Pull and export run only when the dialog's buttons or the
  matching actions are used.

## File format

Each file contains one dashboard:

```json
{
  "config": {
    "panels": [
      {
        "id": "panel-1",
        "title": "Signups",
        "sql": "SELECT ...",
        "source": "first-party",
        "chartType": "line"
      }
    ],
    "title": "Growth"
  },
  "id": "growth-dashboard",
  "kind": "sql"
}
```

Keys are sorted and panels keep their order, so diffs show only real changes.
Do not hand-edit the id. It must match the file name.

## Actions

| Action                                  | Writes | Purpose                                              |
| --------------------------------------- | ------ | ---------------------------------------------------- |
| `configure-dashboard-folder-github-sync` | yes    | Link or unlink a folder                              |
| `preview-dashboard-folder-github-sync`   | no     | Compare both sides and report each dashboard's status |
| `apply-dashboard-folder-github-sync`     | yes    | Pull from GitHub                                     |
| `export-dashboard-folder-to-github`      | PR     | Open a pull request with app changes                 |

## Permissions

Linking requires editor access to the folder. Pull writes only the dashboards
the caller can edit. Export reads only the dashboards the caller can edit. The
GitHub token is the caller's own GitHub connection, so the repo must be
readable and writable by that account.
