---
record_type: "capability"
spec_version: 2
id: "content.object.database"
name: "Databases"
user_promise: "Database as a Page-backed typed collection"
primary_user_job: "Keep a durable set of Pages together with shared structure, rules, permissions, and one dependable place for new records to belong."
kind: "primitive"
state: "verified"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "A Database owns canonical membership, membership-specific values, structure, validation, permissions, Rules, source bindings, and creation while every View evaluates its access-scoped base collection."
proof_requirements:
  [
    "Stable Page-backed Database identity, membership, schema, and membership-specific values",
    "Access-scoped implicit base Query shared by full-page and inline Views",
    "Canonical creation and write Actions with validation, Rules, and source ownership",
    "Reload, recovery, permissions, accessibility, and agent/UI parity",
  ]
evidence: ["../../../server/db/schema.ts"]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Databases

## Why this exists

A collection is more than a table-shaped result. People need one governed place that owns which Pages belong, what shared structure applies, where a new item is created, and which rules or sources control its values.

## Example workflow

A marketing team creates a Content Calendar Database, adds Page records, defines Status and Publish date Properties, and builds Table and Calendar Views. Both Views show the same authorized members. Creating through either View creates one Page in the Database and applies its defaults and validation; changing presentation never manufactures a second collection.

## Product contract

- A Database is a Page-backed, stable Content object with its own identity, access, description, and Views.
- It owns durable Page membership, membership-specific Property values, Property definitions, defaults, validation, Rules, source bindings, canonical creation, and canonical write routing.
- A Page may belong to several Databases. Each Database owns only its membership and membership-local values; no Database becomes the Page's identity, primary parent, or universal read context.
- Opening a Database evaluates an implicit base Query: every member the current viewer may access. This base relation is execution machinery, not a hidden named Query object.
- Every Table, List, Board, Gallery, Calendar, Timeline, Form, Chart, or other Database View consumes that same base relation and adds downstream presentation and View filters.
- Schema and values bind through stable Property IDs, never display names alone. Renaming preserves dependencies.
- Creating through a Database or an unambiguous Database View creates the Page in this Database and applies safe defaults, View-derived seeds, validation, and Rules atomically.
- UI, agents, automations, and APIs use the same typed Actions and authorization. A screen does not own a second mutation path.

## Permissions and source behavior

- The fixed roles are **Can view**, **Can comment**, **Can edit entries**, **Can edit database**, and **Full access**.
- Personal filters and presentation do not require schema authority. Editing shared Views and structure follows Database-edit authority.
- Source truth policy, provider grants, Property locks, and operation-specific guards may narrow an actor's role but never widen it.
- A Database View or shared link reveals only rows and fields already authorized for that viewer.
- Removing a Page from a Database removes that membership and its membership-local values; it does not delete the Page or its other memberships.

## Boundaries and non-goals

- A Database owns records and structure; a Query derives a collection without taking ownership; a View presents and refines one Database or Query.
- The common query engine does not make every Database a named Query.
- Database membership is not Page hierarchy, sidebar placement, or an access grant to other memberships.
- A multi-source Query may compose several Databases, but it does not become a new Database unless someone explicitly creates a governed writable collection.

## Acceptance stories

### Render one collection several ways

Given one Database with authorized and private members, when a viewer opens its Table and Calendar Views, then both evaluate the same access-scoped membership, preserve stable record identity, and reveal no private rows through counts or groups.

### Create through the owning collection

Given a Database View with unambiguous positive creation seeds, when an editor creates a row, then one Page gains this Database membership, valid seeds/defaults apply atomically, and the shared Action returns the same result as the UI.

### Remove membership without deleting the Page

Given a Page in two Databases, when an authorized editor removes it from one, then that membership and its local values disappear while the Page, its other membership, and Page-owned content remain intact and recoverable.

## Current evidence

The linked schema and existing Content actions implement Page-backed Databases, access-scoped rows, schema/value operations, and full-page and inline surfaces. This record remains `verified` for that atomic foundation. Derived Query composition, advanced View families, complete renderer conformance, and multi-source workflows retain their own proof gates.

## Proof plan

1. Exercise Database creation, membership, schema, values, defaults, validation, Rules, permissions, and deletion through UI and Actions.
2. Verify the implicit base Query across full-page and embedded Views under row and field access changes.
3. Create and edit through several View renderers; confirm one canonical Page and write path.
4. Add and remove multi-membership while preserving Page identity and unrelated memberships.
5. Test reload, concurrent edits, rollback, Undo, accessibility, agent context, and source-policy intersections.

## Open questions

No open product question changes this atomic foundation. Advanced query composition, custom reusable Properties, heterogeneous source collections, and renderer-specific behavior are documented separately.
