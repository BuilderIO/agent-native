# Analytics 2

An agent-native BI workspace for connected data questions and notebook projects.

## Skills

- Read `analytics-queries` via `docs-search --slug skill-analytics-queries` for data questions, warehouse queries, and notebook inputs.
- Use `tool-search` to discover current actions for semantic models, saved SQL queries, and collaborative chats.
- Before editing, find `SKILL.md` files under `.agents` and use `pnpm action docs-search --query` or `--slug`. Read `agent-native-toolkit` for shared UI and `customizing-agent-native` for customization.

## Core Rules

- Store data in PostgreSQL via Drizzle. Call `actions/` from UI with `useActionQuery`, `useActionMutation`, or `callAction`.
- Route analysis and generation through agent chat. Keep LLM calls out of UI and actions.
- Use granted credentials from the connection catalog. Never read customer credentials from `process.env`.
- Save personal preferences only through `save-memory` at `scope: "personal"`. Save org facts only after explicit confirmation through the approval-gated `scope: "current-org"` path; never write them directly to shared resources.
- Keep schema changes additive. Distinguish missing, unreadable, incomplete, and empty data.
- Acknowledge UI actions before network work, within 400 ms. Target 100 ms.

- Before code edits, find skills with `rg --hidden --follow --files -g SKILL.md .agents`; read the relevant guide and search local docs with `pnpm action docs-search --query` or `--slug`. For common workspace or agent UI, read `agent-native-toolkit`; for customization, read `customizing-agent-native`.

## Core Rules

- Projects contain notebook cells.
- Store app data in PostgreSQL via Drizzle. Define app operations in `actions/` and call them from UI with `useActionQuery`, `useActionMutation`, or `callAction`.
- Route analysis and generation through agent chat; UI components and actions do not call an LLM directly.
- For external integrations, inspect the workspace/provider connection catalog first; use granted credentials, never customer credentials from `process.env`.
- Save personal preferences only through `save-memory` at `scope: "personal"`. Save org facts only after explicit confirmation through the approval-gated `scope: "current-org"` path; never write them directly to shared resources.
- Keep schema changes additive. Distinguish missing, unreadable, incomplete, and empty data.
- UI feedback targets 100 ms, acknowledges before network work, and never exceeds 400 ms.
- Project edits and restores create drafts; publish only on explicit request after server-verified panel evidence. Viewers see the published snapshot during edits. Staged-data projects remain owner-scoped and private.
- Categories are owner/org-scoped folders. Access inherits only for published projects; viewers/commenters see published snapshots, folder editors/admins may edit drafts, and direct grants remain. Categories never expose an unpublished project; a direct viewer or commenter grant opens its working notebook read-only. Staged data blocks category sharing.

## Application State

- `navigation.view` and `navigation.path` give the view and route. `navigation.resourceKind` and `navigation.resourceId` identify the resource.
- `ask-app-state:<appId>` stores Ask inputs, source rows, and table sorts.
- `home-composer:<tabId>` stores a mount ID and Home intent (`app`, `notebook`, or null). Chat submissions carry the intent.
- App Builder uses a separate layout document. The scoped selection reports the tab as `kind: app-tab`. Sankey maps source to `xField`, target to `seriesField`, and numeric flow to `yField`.
- `data-browser` stores this browser tab's data tab, selection, and collapsed-pane state.
- In notebook Files, `import-project-csv` stages owner-scoped rows; for a CSV attached to a conversation or project, pass its `fileId` instead of bytes. Find them with `list-staged-datasets` and filter, project, sort, or aggregate complete rows with `query-staged-dataset`. Verify the import succeeded with complete source data.
- Writes never move the user's view. Pass `intent: "open"` to `navigate` or to a create, duplicate, import or update-project call only when the user asked to open the result; otherwise the call returns a kept-view result and the user stays put.
- To open a project the user names, call `open-project` with its title (or `navigate` with `projectTitle`); it resolves the id on the server and lands on that project. Never guess an id, never create a project to open one, and never open the search view or type a query to find it: go straight to the project dashboard. This includes questions that name a dashboard ("How's my Agent-Native metrics doing in my V3 dashboard?"): open that dashboard first with no search typing, then answer from it.
- Home lands on a project named in "open project <title>" (also "go to dashboard <title>") before any thread starts: the Ask box calls `resolve-open-project-intent` (read-only) and navigates straight to the one match. A question that names a dashboard ("How's my metrics doing in my V3 dashboard?") does the same and carries the question in the navigation state: the project page sends it to that project's own conversation, so the summary appears beside the dashboard (the title is narrowed by the whole question when its short name matches several projects). No match or several matches fall through to the normal Ask flow. `run-project-cell` from a conversation bound to another project returns `thread_project_mismatch` (open the project first), not `thread_not_found`. Titles match by words, so "-" and "—", case and a shortened title all find the same project.
- `navigate` opens a local path or resource by `kind` and `id`. `view-screen` reports this tab's route, cell selection, and bounded, access-checked editing context. Truncation means incomplete content.

- `navigation.view` is the active view; `navigation.path` is the route. `navigation.resourceKind` and `navigation.resourceId` identify an open project, thread, collection, or data connection.
- `ask-app-state:<appId>` stores Ask inputs, source rows, and table sorts.
- `home-composer:<tabId>` stores the selected Home intent (`app`, `notebook`, or null) and a mount ID; the chat submission carries that intent as composer context.
- App builder layouts store each cell's grid placement; preserve the other cell fields when saving. Sankey charts use `xField` for source, `seriesField` for target, and `yField` for numeric flow value.
- `data-browser` stores the active tab, selected resource, and list-pane collapse state for this browser tab.
- In a notebook's Files panel, `import-project-csv` stages a CSV as owner-scoped rows; for an attached CSV pass its `fileId`, never claim you cannot read it. Find it with `list-staged-datasets`; use `query-staged-dataset` to filter, project, sort, or aggregate complete rows. Do not claim the CSV is imported when the action fails or reports incomplete source data.
- `navigate` opens an app-local path or a project, thread, collection, or data connection by `kind` and `id`. `view-screen` reports the route, selected cell, and bounded, access-checked current-tab editing context when available; truncation means content is incomplete.

## Actions

| Action                                                                               | Purpose                                                                                                          |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `get-workspace-shell`                                                                | Read workspace identity and permissions.                                                                         |
| `get-analytics-capabilities`                                                         | Read controls. Only allowed decisions have targets.                                                              |
| `list-projects`                                                                      | Find accessible projects, newest edit first. Agents get a bounded page; check `truncated`.                       |
| `resolve-project`                                                                    | Turn "this one", "the last one" or a title fragment into one project id, or a typed question when several match. |
| `get-project`                                                                        | Read a project and its accepted cells.                                                                           |
| `get-project-summary` | Bounded read of a project's saved results (a few rows per cell, never runs a query). |
| `get-notebook-result-page`                                                           | Read an immutable result by ID and its thread, preview, or session ID, when applicable.                          |
| `set-notebook-result-view`                                                           | Save the selected result page.                                                                                   |
| `add-project-cell`                                                                   | Add a cell in the editor or stage one from its bound agent thread.                                               |
| `save-project-cell`                                                                  | Save cell contents in the editor or stage an edit from its bound agent thread.                                   |
| `get-notebook-pending-changes`                                                       | Read the bound thread’s proposals and candidate run IDs.                                                         |
| `decide-notebook-pending-changes`                                                    | Confirm or undo a reviewed set of proposals.                                                                     |
| `set-app`                                                                            | Atomically edit layouts, duplicate tabs, or place new cells.                                                     |
| `format-notebook-sql`                                                                | Format a SQL draft without saving or running it.                                                                 |
| `get-notebook-execution`                                                             | Read the accepted snapshot, active runs, and run settings.                                                       |
| `start-notebook-run`                                                                 | Admit a server-planned run from the accepted snapshot.                                                           |
| `get-notebook-run`                                                                   | Read run progress and per-cell receipts after a cursor.                                                          |
| `cancel-notebook-run`                                                                | Stop a run or a cell and check its terminal outcome.                                                             |
| `set-notebook-run-settings`                                                          | Save the default run mode or Auto-rerun cells setting.                                                           |
| `get-notebook-input-choices`                                                         | Read verified choices for a dynamic draft input.                                                                 |
| `create-project-publish-preview` / `get-project-publish-preview` / `publish-project` | Run, inspect, and publish a preview of the accepted draft.                                                       |
| `open-published-app-session` / `get-published-app-session`                           | Open or resume a private session pinned to a release.                                                            |

| `get-project` | Read a project and its cells. |
| `add-project-cell` | Add a notebook cell. |
| `save-project-cell` | Save cell contents or grid placement while preserving other fields. |
| `save-project-cells` | Atomically save 1–200 observed cell IDs and revisions, preserving agent changes pending review. |
| `replace-project-sql-connection` | Atomically switch every matching working SQL cell using the cell ids and revisions from `get-project`; clear their old outputs. |
| `import-project-connection` | Link a granted workspace connection to a project without adding a cell; `get-project` returns `importedConnectionIds`. Query by adding a SQL cell on it. |
| `run-project-cell` | Run a SQL cell on its selected connection. |
| `cancel-project-cell` | Stop a SQL cell run using the current `get-project` query state's `requestId`; use `operation: status` to check a pending cancellation. `cancelled` requires provider confirmation; `running` means the job completed first and still needs polling. `cancel_unknown` means its outcome cannot be confirmed; do not claim it stopped. |
| `list-data-connections` | Read available connection status. |
| `list-connection-datasets` | Discover reachable datasets. |
| `get-data-table-preview` | Read up to 50 rows from a permitted table using its opaque table ID. |
| `get-notebook-table-reference` | Resolve a catalog table and its current access and catalog revisions. |
| `list-library-apps` | List accessible published Library apps. |
| `list-data-recents` | List your recently opened workspace tables. |
| `touch-data-recent` | Record a table open using its connection and opaque table IDs. |
| `list-data-favorites` | List your favorite workspace tables. |
| `set-data-favorite` | Add or remove a permitted table using its connection and opaque table IDs. |
| `view-screen` | Read the current route and selection. |
| `navigate` | Open a view or resource. |
| `create-project` | Create with a request ID. Recover via `get-project-creation`. |

| `create-project` | Create a project; optionally choose a bundled sample dataset. |
| `export-project-yaml` | Export a supported Python project as YAML for create-project. |
| `update-project` | Update project metadata. Returns `previous` values so the same call can undo it. |
| `bulk-update-projects` | Trash, restore, archive or star up to 100 projects, with a typed result per project. |
| `delete-project` | Permanently delete a trashed project and its uploaded files. |
| `purge-deleted-project-files` | Clean up orphaned uploads after a project deletion. |
| `rename-thread` | Rename a thread you own in the active Analytics workspace. |
| `delete-thread` | Delete a thread you own in the active Analytics workspace. |

Discover other actions with `tool-search` and follow the matching skill.

For other capabilities, use `tool-search` and follow the matching skill.
