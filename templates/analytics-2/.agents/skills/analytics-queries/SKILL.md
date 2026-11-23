---
name: analytics-queries
description: >-
  Query connected data and work with notebook inputs and results. Use when
  answering a data question, running SQL or Python, or configuring a notebook parameter.
scope: runtime
---

# Analytics queries

Use `view-screen` and `get-project` to establish the current notebook and its
cells when the request refers to what is open. Discover connections and tables
with the data connection actions. `db-query` reads the app database, not the
customer's warehouse.

To propose a query from a catalog table in a notebook thread, call
`add-project-cell` with `kind: "sql"` and the table's connection and opaque table
IDs. Follow its candidate run through completion and read the result page
separately. In the notebook Data Browser, **Query** inserts the cell and starts
its run in one operation using the current table reference and notebook order.

For a new notebook, call `create-project` with a unique request ID and the
intended starter. If the response is lost, read `get-project-creation` and
reuse that request ID for the same intent. Open the receipt's href.

Read committed edits and named versions with `list-notebook-history`.
Before saving a version, finish intended edits and read the accepted draft
head. Pass that head to `save-project-version` along with the version name
and an operation ID. To restore, pass the head observed at preview time to
`restore-project-version`. Check the new draft lineage and the published
version independently. If the head changes, read the latest draft before
confirming a new restore intent.

For an ad hoc read on the configured virtual organization BigQuery source,
discover `run-organization-warehouse-query` with `tool-search` and follow its
continuation for status and paging. A request for a read-only data answer
authorizes the SELECTs needed to answer it.

For Ask, use its private backing notebook from `get-thread-summary`. When the
person names a warehouse, resolve it with `list-data-connections` and
`list-connection-datasets`, then add a SQL cell with that warehouse's
`dataConnectionId` and run it with `start-notebook-run`. Pass the thread ID to
`get-notebook-execution`, `get-notebook-run` and `get-notebook-result-page`.
Build inline charts from returned rows and pass the checked result ID as
`widgetId` to `render-data-widget`.

Cell changes from the notebook agent are scoped to its bound thread. Read
`get-notebook-pending-changes` with the thread ID from `view-screen` and
follow its candidate runs before reporting output. The person reviews and
confirms the pending cells. For a run of accepted cells, read
`get-notebook-execution` for the accepted snapshot, active run IDs, and
project default mode. Use `get-notebook-execution-snapshot` to read the
snapshot and identify cells with execution output. Pass the accepted snapshot,
a unique request ID, and the desired mode to `start-notebook-run`. Cell only
uses compatible saved prerequisites. Upstream includes ancestors. Downstream
includes consumers. Auto adds missing or stale prerequisites for that branch.
Run all admits each runnable cell. Use the same request and ID to recover
an uncertain admission. Attach with `get-notebook-run` and follow its cursor
and per-cell receipts. Use `cancel-notebook-run` with the run ID, optionally
with a cell ID, then confirm the terminal outcome. Change the project default
mode or Auto-rerun cells with `set-notebook-run-settings` and the current
settings revision.

For a legacy SQL cell job from `run-project-cell`, read and page it with
`get-project-cell-results`. Use the query state's `requestId` from
`get-project` with `cancel-project-cell` and use `operation: status` for
pending cancellation. Treat `cancelled` as provider-confirmed, `running`
as needing further polling, and `cancel_unknown` as an unconfirmed outcome.

Read an immutable result with `get-notebook-result-page`, which returns up
to 50 rows from the supplied result ID. Omit the page to reopen the saved
view. Store a page using `set-notebook-result-view` with the view revision
and a request ID. Read `get-notebook-run-diagnostics` for the typed provider
reason and redacted dispatch under the current source grant.
For BigQuery Storage fallback, read `fallbackCode` and `fallbackProvider`
separately from the final query error. A Postgres attempt with
`postgres_cursor_lost` needs an explicit new run.

Use the Dataframes SQL connection mode to query authorized, complete prior
exports by name. A preview, sampled result, or incomplete result needs a rerun
before it can be bound. Add Python with `add-project-cell`. A referenced SQL
export becomes a pandas DataFrame. Declare dynamic global lookups in a leading
`# inputs: name1, name2` comment. Read Python output and its typed table IDs
in `get-notebook-cell-execution`, then page tables by result ID. Read live
variables and the current generation in `get-notebook-kernel-session`. Use
`control-notebook-kernel` to interrupt an attempt or restart the generation.
Clear output keeps live variables. After a restart, rerun upstream Python to
rebuild live names. The offline kernel uses only locally available artifacts
and cannot promote its output into a hosted run.

Use the reported row count, completion, truncation, and paging fields to
describe coverage. A first page or table preview is not evidence about rows it
does not contain. Page the results or run an aggregate when the question needs
the whole population; report incomplete or failed reads as such.

Notebook input cells store a name and a serialized draft default. Bind a
value with `{{ region }}` or a list with `IN ({{ regions | array }})`.
Multiselect defaults are JSON arrays of strings. The legacy
`{{ regions:list }}` form is also supported.

Read each input from `get-project`. Configure its label, SQL name, and
options using `save-project-cell` with the cell's current `updatedAt`.
Static choices are stored in `options` as strings. Set
`optionValueType: "number"` for numeric choices to bind as numbers in SQL.
Dynamic choices use `dynamicOptions` with `producerCellId`, `valueFieldId`
and optional `displayFieldId` from an earlier result cell.
Read the producer's current result ID with `get-notebook-execution`, then read
its field IDs with `get-notebook-result-page`. Use those returned IDs, not
dataframe or column names. Run the producer with the notebook execution
actions and verify its complete result before choosing values.
For dynamic choices read
`get-notebook-input-choices` and use a value and result ID from its ready
response. A missing producer and a verified empty set require different
readbacks. Save the changed default with `save-project-cell`, preserving
other contents, the expected cell revision and `inputOptionsResultId` for
dynamic choices. With Auto-rerun cells enabled, follow the linked work
through `get-notebook-execution`. With Auto-rerun cells disabled, read the
saved default and use an explicit run when the user asks to update results.
Published session values are separate from draft defaults.

For example, if the earlier producer cell ID is `choices`, its region field ID
is `0`, and its ready choices include `North`, merge this patch into the input's
observed contents. Pass the choices response's result ID separately as
`inputOptionsResultId`, along with the current cell revision. These example IDs
are illustrative; substitute the IDs returned for the actual notebook.

```json
{
  "dynamicOptions": { "producerCellId": "choices", "valueFieldId": "0" },
  "defaultValueString": "[\"North\"]"
}
```

The dependent SQL can use `WHERE region IN ({{ regions | array }})` when the
input's name is `regions`. Values bind as parameters. After confirmation, read
the accepted binding, run the dependent SQL, and verify its result after reload.
Distinguish missing, pending, empty, denied and unreadable choices; an
unavailable producer is not an empty list. Do not invent a selection when the
choices read is unavailable.

To publish, read the accepted head and current release pointer, then create a
preview with `create-project-publish-preview`. Inspect it with
`get-project-publish-preview`. Publish that exact head, comparison target and
manifest revision with `publish-project`. Retain the request ID on retries.
Cancel a pending preview with `cancel-project-publish-preview` and its create
request ID. Use the published app link returned by the commit.

Read a published app with `open-published-app-session`, retaining the release
and session IDs for reconnect and `get-published-app-session`. Pass the session
ID to result paging and drill. Set or reset private inputs with
`set-published-app-inputs` or `reset-published-app-session`, using the current
input revision and a stable request ID. A removed override restores the
release's default. An explicit null is a private value.

Find active colleagues with `find-published-app-colleagues`. Read the sharing
revision and supported roles with `list-published-app-access`. Use
`set-published-app-access` with that revision and an operation ID to add Can
view app or revoke its grant on request. Use the receipt's mounted app link.

Use `list-published-app-schedules` to read schedules and revisions. Resolve
requested recipients with `list-published-app-schedule-recipients` before
calling `set-published-app-schedule`. Keep the operation ID and payload for an
exact retry. Report the configured time zone and confirmed next run. Read
`list-published-app-schedule-runs` for the pinned release, result update and
delivery outcomes. Use `stop-published-app-schedule-run` for a requested stop
and verify the terminal state in the run log.

A SQL cell in Dataframes mode can query earlier named SQL results when a
complete, current result is available. Named warehouse results are captured eagerly when eligible, even before a Dataframes cell is added. Materializations use private storage
and are bounded to 10,000 rows and 8 MiB; the combined dataframe inputs have
the same limits. Saved connection provider columns currently support safe integers, exact decimal strings with
precision preserved, finite FLOAT/FLOAT64/DOUBLE/REAL values, strings, booleans, dates, and datetimes. The organization warehouse currently collapses raw types before capture, so FLOAT materialization there remains unsupported. Fractional JavaScript
inputs for exact decimal columns remain unsupported. Unsupported types, incomplete results, stale
sources, revoked access, and missing storage produce errors. Rerun an upstream
cell when its SQL, connection, relevant inputs, or dependencies change.

Read back project cells and their output or query state before reporting a
creation, edit, or run as complete. Use the pending view for agent proposals
and the accepted read after confirmation. Use `tool-search` for current semantic model, saved-query, and
chat-sharing actions and their access requirements.


## Visualize notebook results

Run the source through the notebook execution actions and check its result receipt. Add a Chart, Pivot, or Table below the source. Read `get-notebook-transform` for Chart and Pivot or `get-notebook-visualization-page` for Table to find the producer slot and typed field IDs. Save those IDs in the visualization config. Reopen the transform after saving and check the source result ID and state. An empty result has complete coverage and zero rows. A blocked or denied result needs repair or authorization.

Use `open-notebook-visualization-drill` with the visualization and selection IDs returned by the transform. View data pages original matching rows. Drill down groups those rows by the requested field. Pivot totals aggregate underlying rows, including for averages, medians, and distinct counts. Keep and Remove return a typed selection predicate for the draft Chart config. Keep the result ID and cell update timestamp fixed when paging a Table export.
