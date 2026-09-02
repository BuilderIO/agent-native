---
record_type: "capability"
spec_version: 2
id: "content.portability.collection-export"
name: "Bounded collection export"
user_promise: "Export the authorized records in one Database or View to a readable file without changing what the View means or implying a whole-vault backup."
primary_user_job: "Take the records I can see in one collection into CSV, Markdown, HTML, or a print-ready PDF representation with clear scope and field choices."
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.object.database",
    "content.view.query",
    "content.property.typed",
    "content.access.visibility-closure",
  ]
related_features: ["content.feature.take-the-whole-vault-with-you"]
roadmap_boundary: "feature"
acceptance_summary: "One responsive export flow resolves an access-first, server-owned Database or View projection and encodes the same selected records, scalar values, and rich bodies as CSV, a Markdown package, standalone HTML, or print-ready HTML."
proof_requirements:
  [
    "Access-first membership, public/shared/private visibility, saved-View narrowing, canonical ordering, and explicit 5,000-candidate boundary tests",
    "Selected-field dependency, typed computed-value, body hydration, narrow projection, and cross-format renderer tests",
    "Real Content toolbar and dialog workflow through downloaded CSV, Markdown package, HTML, and browser print preview",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-09-02"
---

# Bounded collection export

## Why this exists

A useful collection export is smaller and more immediate than a vault backup,
but it still needs one dependable answer to which records, fields, and bodies
belong in the artifact. People should be able to inspect that answer before
generation begins, and every format should inherit the same access and View
semantics.

## Example workflow

An editor opens a saved List View over a Database, chooses Export, keeps the
current View and visible fields, includes the primary body, and downloads a
Markdown package. Content includes only records the editor may access, keeps
the effective View order, and produces the same selected identities and values
that CSV, HTML, and PDF-print export would use.

## Product contract

- One collection Export dialog owns temporary format, scope, scalar-property,
  primary-body, and additional Blocks-field choices. A fresh dialog starts
  with the documented defaults before generation begins.
- Current View scope is the authorized intersection of Database membership,
  server-owned saved predicates, the acting person's effective View state, and
  bounded transient narrowing. Caller input may narrow or order the result but
  cannot replace a saved predicate or widen access.
- All-members scope uses authorized immediate Database membership in canonical
  order. It is non-recursive and independent of View filtering, grouping,
  search, and layout.
- One typed projection resolves access, identities, order, selected scalar
  values, and selected named bodies before a format renderer runs. Renderers do
  not decide membership, access, or View meaning.
- Scalar-only exports do not load unselected Page or Blocks bodies and do not
  evaluate unrelated computed fields. Required dependencies are loaded and
  evaluated in bounded batches.
- CSV is one RFC 4180 file, Markdown is one linked package, HTML is one readable
  standalone document, and PDF uses the existing print-ready HTML and browser
  print flow. Failures and the synchronous 5,000-authorized-candidate ceiling
  remain explicit.

## Boundaries and non-goals

This Capability owns one immediate Database or View export. It does not own
recursive Page hierarchy, relation traversal, attachments, comments, history,
lossless archives, import round trips, whole-vault closure, resumable jobs, or
a server-generated binary PDF. View layouts select and order records; exported
files do not reproduce interactive Table, Board, List, Calendar, Gallery, Form,
or Timeline interfaces.

## Acceptance stories

### Preserve a saved View without widening it

Given a saved View that excludes drafts and a caller that supplies a narrower
search or omits the saved filter, when the collection exports, then every
record remains inside the saved View and the caller cannot reveal excluded
members.

### Encode one authorized projection four ways

Given public, organization-shared, privately shared, and inaccessible members
with scalar and Blocks fields, when the same selection exports to each format,
then the authorized record identities, order, typed scalar values, and selected
bodies agree while inaccessible data is absent.

### Keep scalar export bounded

Given a large Database with additional bodies and computed properties, when a
person exports only ordinary scalar fields, then Content does not load
unselected bodies or evaluate unrelated rollups and fails explicitly rather
than truncating after 5,000 authorized candidates.

## Current evidence

Content has an existing `export-document` Action, configurable CSV dialog,
document renderers, and Database/View query primitives. These are useful donor
machinery, but the unified projection, four-format interface, Markdown package,
and complete proof remain in progress.

## Proof plan

1. Test access modes, saved/effective/transient View composition, both scopes,
   stable ordering, typed failures, and the 5,000-candidate boundary at the
   Action projection.
2. Verify selected-field dependency closure, narrow document/body reads,
   bounded computed values, CSV safety, Markdown package integrity, standalone
   HTML, and print-ready HTML.
3. Drive the real toolbar and responsive dialog through all four artifacts,
   including pending, retryable error, fresh-open defaults, and narrow width.

## Open questions

No open product question changes this bounded contract. Whole-vault packaging,
durable jobs, assets, lossless recovery, and binary PDF generation remain with
their separate Capabilities.
