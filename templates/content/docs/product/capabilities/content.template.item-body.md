---
record_type: "capability"
spec_version: 2
id: "content.template.item-body"
name: "Database item Templates"
user_promise: "Offer more than one useful starting body for a database record, including a clear default and context-aware embedded views."
primary_user_job: "Start a database item with a governed body and context."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph", "content.object.blocks-field"]
related_features: ["content.feature.share-how-your-organization-works"]
roadmap_boundary: "feature"
acceptance_summary: "Database item Templates are Template graph variants for a Database with one selected default, typed creation context, dynamic embedded views, and view-derived creation defaults."
proof_requirements:
  [
    "Each body template is an ordinary graph-backed snapshot associated with the Database, not a parallel content type.",
    "Creation applies the chosen template and defaults once within a successful transaction; dynamic views bind the newly created record context.",
    "Changing the database default affects future creation only and never overwrites existing item bodies.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Database item Templates

## Why this exists

One database can hold several kinds of work, and a blank page makes each new record start from nothing. Authors need a chosen starting body that carries the new item's actual context without rewriting existing records.

## Example workflow

Kai creates a request from a Bug report body Template; its embedded view binds the new record and later default changes affect only future rows.

## Product contract

- Each body template is an ordinary graph-backed snapshot associated with the Database, not a parallel content type.
- Creation applies the chosen template and defaults once within a successful transaction; dynamic views bind the newly created record context.
- Changing the database default affects future creation only and never overwrites existing item bodies.

## Boundaries and non-goals

- `content.template.graph` owns template snapshot identity and `content.object.blocks-field` owns the item body; this record owns Database-specific choice and creation context.
- Item Templates do not rewrite existing bodies when a default changes or create a hidden global-current-page binding.

## Acceptance stories

### Keep existing bodies

Given default body changes, when an existing item opens, then existing item bodies remain unchanged.

### Bind current item explicitly

Given an embedded view, when the item Template creates a record, then it uses declared new-item context, not hidden global page state.

## Current evidence

`actions/create-document.ts` and `app/components/editor/DocumentBlockFields.tsx` are donors; per-database variants are absent.

## Proof plan

1. Create variants, choose default, test every creation route.
2. Apply defaults/current-record binding in one transaction.
3. Change defaults and verify future-only behavior.
4. Test missing context/incompatible view/failed creation.

## Open questions

Context-sensitive default selection beyond one explicit default remains open.
