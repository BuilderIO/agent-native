# Content Databases — Behavioral Reference

Notion-style databases layered on top of the normal document model. The SQL
column shapes are injected separately by the framework schema block — this
file covers behavior the schema can't convey: what each property type means,
how views work, and which actions own which mutation.

## Databases are document-backed page-level objects

A normal document has no properties by default. A row in a database is also a
document, linked through `content_database_items`; when that row document
opens, it shows the database's properties. The database page itself renders as
a table and owns the schema in `document_property_definitions.database_id`.
Database row documents and their descendants stay contained by the database
and are omitted from the ordinary sidebar page tree; users open them from the
database view or an explicit link. When a row document is open, the editor
shows a small parent-database breadcrumb above the title so the user can
return to the containing database without relying on the sidebar. The
`view-screen` document tree follows the same rule: database row pages are
omitted from the ordinary tree and counted separately as contained database
items.

When a database row is open in the side preview, navigation state includes
`databasePreviewDocumentId`, and `view-screen` returns that row as
`databasePreview` with its content and properties. Database navigation state
also includes the active view type, search query, sort count, the saved
database view list, active sort/filter definitions, filter match mode, saved
column calculations, table cell wrapping state, table row density, collapsed
group IDs, calendar or timeline date property IDs/names, the visible date
range for calendar/timeline views, empty-group visibility state, visible
source summary when attached, and database row preview state. Source-aware
metadata lives alongside the database model in `content_database_sources`,
`content_database_source_fields`, `content_database_source_rows`, and
`content_database_source_change_sets`; those tables store binding status,
field mappings, source-qualified row identity/provenance, freshness
timestamps, and proposed local-only diff records without changing the normal
table view.

Navigation state includes a capped `databaseVisibleItems` summary with row
item IDs, document IDs, titles, positions, and visible property value
summaries for the visible rows, plus row count and total row count, so agents
can tell whether the user is looking at the full database or a constrained
slice and can refer to the same rows and cells the user can currently scan;
for calendar and timeline views this summary is limited to rows in the
current visible date window plus rows shown in the "No date" section. When
footer calculations are active, navigation state also includes
`databaseCalculationResults` with the visible result text for each calculated
column. When table rows are selected, navigation state also includes
`databaseSelectedItemCount` and `databaseSelectedItems`, and
`view-screen.databaseCurrentView` mirrors that selected row summary.
`view-screen` exposes the same slice as `databaseCurrentView` alongside the
full database payload. Its row property summaries should mirror the active
database view's property order, hidden-property list, and empty-property
visibility rules. It also marks database page entries in
`documentTree.items[].database`, matching the sidebar's database icon
fallback so agents can distinguish database pages from ordinary pages.

Database views render the row page's custom icon anywhere a row title
appears, falling back to the default page icon when the row has no icon. The
database side preview exposes the same icon picker affordance as a normal
page, so users can set or remove a row page icon without leaving the
database. The preview is an overlay-free, non-modal side peek so the database
context stays visible while the row page is open. Background database
interactions should not dismiss it; use the explicit close control to close
the preview. Keep it narrow enough on desktop that the underlying database
still reads as the active context. In table views, clicking a row title opens
that side preview; inline title editing lives behind the hover pencil
affordance.

## Property types

Document properties are SQL-backed, Notion-style structured metadata rather
than YAML embedded in the markdown body. Database property definitions
support `text`, `number`, `select`, `multi_select`, `status`, `date`,
`person`, `place`, `files_media` (`Files & media`), `checkbox`, `url`,
`email`, `phone`, `blocks` (Capacities-style rich-text body field), plus
computed `formula`, `id`, `created_time`, `created_by`, and
`last_edited_time`, `last_edited_by`, plus property visibility
(`always_show`, `hide_when_empty`, `always_hide`). The value table stores
per-row-document JSON values.

### Blocks fields

A `blocks` field is independent rich-text content per row — NOT YAML and NOT
a pointer to the body. Every database is seeded with one primary "Content"
Blocks field whose content is backed by `documents.content` (so it reuses the
collaborative TipTap/Yjs body editor and existing data migrates for free).
Each additional Blocks field stores its own content in
`document_block_field_contents`, keyed by `(document_id, property_id)`, so no
two Blocks fields ever share content — adding a second Blocks field creates a
new, empty, independent field. On the page: one Blocks field renders
chromeless (no header, just the body); two or more each show their name as a
header and are collapsible and reorderable (the surviving lone field keeps
its stored name). In table views a Blocks column shows a word count (e.g.
"412 words"), not the body. A Blocks field can only be deleted from the
database view's column menu (not from the page body); deleting the last
Blocks field warns that it removes the body for every object of the type.

Formula properties store their expression in property options and support
`{Property name}` substitution plus simple numeric math such as `{MSV} * 2`.

## Views

Database views support multiple named table, list, gallery, board, calendar,
timeline, and form views saved in `content_databases.view_config_json`. Each
view has its own stacked sorts, type-aware filters with an all/any match
mode, per-view hidden property IDs, column widths, and (for table, list,
gallery, and board views) grouping property or (for calendar/timeline views)
date property: text-like fields can use contains/exact/empty filters, numbers
support comparisons, dates support before/after, and checkboxes support
checked/unchecked. Users can reorder stacked sort and filter conditions from
the database toolbar menus, and sort priority follows the same top-to-bottom
order shown in the menu.

New rows created from a filtered UI view inherit simple editable equality and
checkbox filters as initial property values, resolving option labels back to
stable option IDs for select, status, and multi-select filters, so a row
created under "Status is Published" remains visible instead of immediately
disappearing. Agents can mirror that behavior by passing
`--propertyValues '{"propertyId":"value"}'` to `add-database-item`. Filter
controls are type-aware: option properties choose from their configured
options, option value editors can search existing options or create a new
option from the typed query, and property settings can rename option labels
or change option colors while preserving stable option IDs. Option-backed
filter value pickers are searchable, can create a new option from the typed
query, and can be cleared without removing the whole filter row. Date
properties use date inputs, and number properties use numeric inputs.

Column header menus can add or clear column sorts, add or replace type-aware
quick filters (including checked/unchecked for checkbox fields), clear
filters for that column, hide property columns in the current view without
changing other views, and resize column widths. Column headers show compact
sort/filter indicators when that column has active view constraints. Table
rows can be selected with row checkboxes, and the table shows a compact
selected-row bar with clear, duplicate, confirmed delete, and bulk property
set actions for editable non-computed fields. Empty table cells stay
visually blank while remaining clickable for editing, and checkbox table
cells render as compact checkbox glyphs instead of "Checked"/"Unchecked"
text; clicking a checkbox cell toggles it directly via
`set-document-property`, matching Notion's quieter table surface. Table
views can toggle wrapped cells and row density per view for longer
text-heavy tables or more compact scanning.

Table, list, and gallery views can group rows by status, select,
multi-select, or checkbox properties; creating a page inside a group seeds
the grouped property so the new page stays in that group. Grouped table,
list, and gallery sections can be collapsed individually or all at once per
view, and views can hide empty groups to reduce option-backed clutter. Active
search, sort, and filter constraints show as removable chips below the
toolbar with a clear-all control, and every database view shows a
Notion-style page count footer that switches to "count of total" when search
or filters reduce the result set. Table views can also save per-column
footer calculations such as count values, count empty, percent empty, sum,
average, count all rows, count unique values, percent filled, checkbox
checked/unchecked summaries, percent checked/unchecked, min/max/median/range
numbers, and earliest/latest/date-range dates in the active view config.
Empty constrained views show a clear search/filter recovery action in the
view body. The database Properties menu can search fields and show or hide
all fields for the current view, and it includes a New property control for
adding fields without returning to the table header. The New property picker
supports searching property types by label or machine name.

In unconstrained table views, row drag handles can reorder database item
pages through `move-database-item`; clear search, sort, and filters before
manual reordering. Creating a database row returns the created item IDs and
opens the new row page in the side preview. Duplicating a database row
returns the duplicate item IDs and opens the copied row in the side preview
so users can continue editing the new page immediately, including from
table, list, and gallery row action menus. Board, calendar, and timeline
cards expose the same row action menu without showing table-only manual
reorder actions. Deleting the currently previewed row from any row action
menu or from the side preview header advances to the next row, falls back to
the previous row, or closes the preview when no rows remain.

List views render the same row pages as a compact page list with visible
property metadata. Gallery views render row pages as cards with a preview
area and visible property metadata.

Calendar views render row pages on a month grid using a `date`,
`created_time`, or `last_edited_time` property; when the selected date
property is editable, creating a page from a day sets that page's date
property to the day. Calendar and timeline views keep rows without the
selected date value reachable in a compact "No date" section instead of
treating them as missing search results. If a calendar or timeline view has
not saved a date property yet, the UI and `view-screen` both use the same
first available date-like property fallback. Timeline views render the same
date-backed row pages in a horizontally scrollable six-week range, using a
per-view start date property and optional end date property so cards can
span multiple days.

Form views render database properties as ordered questions. Each form view
owns its enabled-question order and required flags, so two forms on the same
database can collect different information. Use `submit-content-database-form`
for agent, Slack, MCP, and UI submissions instead of composing
`add-database-item` plus several property writes. The action accepts
property definition IDs or exact property names, accepts select/status
option IDs or labels, rejects unknown options, writes primary and additional
Blocks fields to their correct stores in one transaction, verifies the saved
row, and returns `createdItemId`, `createdDocumentId`, `urlPath`, and
`deepLink`.

The active view menu can rename, duplicate, delete, or switch an existing
view's layout between table, list, gallery, calendar, timeline, board, and
form while preserving its sorts, filters, hidden properties, and
layout-specific settings.

Board views group pages by status, select, multi-select, or checkbox
properties, and board columns can be collapsed per view using the same
`collapsedGroupIds` state as grouped table/list/gallery sections, including
collapse-all and expand-all group commands. Board views also honor the
per-view empty-group visibility setting. Changing the group-by property
clears stale collapsed group IDs for that view. Board card metadata follows
the same active-view hidden-property and empty-property visibility rules as
table/list/gallery metadata. Dragging a board card between columns updates
that row page's grouping property through `set-document-property`. When a
board is grouped by status, select, or multi-select, users can add a new
board group from the board itself; this appends a new option to the grouped
property definition.

## Actions

Use `create-content-database`, `create-inline-content-database`,
`get-content-database`, `list-trashed-content-databases`,
`restore-content-database`, `add-database-item`, `duplicate-database-item`,
`duplicate-database-items`, `delete-database-items`, `move-database-item`,
`update-content-database-view`, `list-document-properties`,
`configure-document-property`, `set-document-property`,
`duplicate-document-property`, and `delete-document-property`; do not edit
property rows or view config via raw SQL when an action can do it.

When targeting more than one database row, call `duplicate-database-items` or
`delete-database-items` once with a native JSON array of `itemIds` or
`documentIds`. Do not loop `duplicate-database-item` or `delete-document` for
multi-row duplicate/delete requests.

Database views follow Notion-style tab labels. When creating or duplicating
views in `viewConfig`, use unique default names (`Table 2`, `SEO copy 2`,
etc.) instead of appending several tabs with the same label.
