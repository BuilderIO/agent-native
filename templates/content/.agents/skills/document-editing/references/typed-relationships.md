# Typed Relationships

Use this workflow when a database row needs to reference another Page, such as
assigning a campaign deliverable to a People Page containing role and capacity.
A People Page is a record, not an authenticated user. An assignment does not
send notifications, grant access, invite a user, or reserve capacity.

## Discover, inspect, change, verify

Discover the exact Database and Page IDs through database Actions. Read the
schema and team context before deciding assignments; do not derive IDs from
names. `list-content-relationship-types` describes available type/projection
identities. `list-content-relation-candidates` narrows eligible Pages for the
selected projection. A Relation Property is one database's projection of a
canonical type; its ID differs from the type and edge IDs.

Use `list-content-relationships` to inspect the current viewer-accessible
connections and server-issued observation tokens. Use
`mutate-content-relationships` for additions, observed removals or explicit
single-value replacement. Use the route returned for the actual editing
context. Incoming visibility alone never permits removing a connection.

A request is bounded and atomic. If a selected row is invalid or unauthorized,
report the failure; do not silently skip it or split one atomic instruction
into partial commits. Retry an uncertain write with the same operation ID and
same arguments. A new intended change needs a new operation ID. Verify through
an authorized relationship read before declaring the assignment complete.

In the UI, Relation fields are clickable Page links. A reverse column appears
only when it is configured; without one, the relationship is not displayed on
that side. There is no separate Connections or Other connections list. If the
last projection is removed, authorized Actions can still read preserved edges
and independently available History can restore the projection.

Bulk editing uses one list with three states: checked means linked from every
selected row, mixed means linked from some, and unchecked means linked from
none. Apply sends only net additions and observed removals through the canonical
mutation Action as one atomic request. Preserve untouched assignments, and do
not treat a read failure or incomplete observation as unchecked.

## Configuration and recovery

`configure-content-relation-property` creates a local directional type or
exposes an existing type through a forward/inverse column. The first slice
supports a Database candidate constraint, forward one/many and inverse many.
Query-based selection, symmetric types, governed catalogs and provider-owned
relationship writes are unsupported; do not approximate them with stored
arrays or another relation column.

Removing a Property normally preserves its relationships.
`prepare-content-relationship-removal` freezes an exact authorized selection;
`remove-content-relation-property` can remove that selection with the projection
as one recoverable change. New concurrent additions are not part of an older
selection. Do not describe the viewer-accessible count as a global count.

`list-content-relationship-history` returns attributable committed changes.
`undo-content-relationship-revision` compensates a change under current
permissions and constraints. A stale recovery failure leaves current work
unchanged; do not replace a whole Page snapshot to undo an assignment.

UI and MCP use these same Actions. Generic property setters and bulk row
setters cannot overwrite canonical relationship values. Never store endpoint
arrays through SQL to bypass this boundary. The exact supported parameters,
capabilities and failure codes live in each Action schema.

## History index upgrades

The Content release command, `pnpm migrate:production` from `templates/content`,
applies schema migrations and indexes existing relationship revisions in batches
of at most 100. Each revision is indexed transactionally; a failed release can
be retried without rewriting its audit records. Server startup does not backfill
history. If History reports that its index is not ready, report the maintenance
prerequisite rather than claiming there are no changes. An operator must complete
the release command against the intended database before retrying History.
