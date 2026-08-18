---
record_type: "capability"
spec_version: 2
id: "content.template.graph"
name: "Multi-object Templates"
user_promise: "Start from a reusable system of Pages, Databases, Views, Properties, Rules, expressions, and bodies, then own the result."
primary_user_job: "Create an owned system from a reusable object graph."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  ["content.object.page", "content.object.database", "content.object.reference"]
related_features:
  [
    "content.feature.share-how-your-organization-works",
    "content.feature.capture-into-action",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A Template serializes a portable graph of ordinary Content primitives and creates an owned, editable instance with stable internal references, provenance, and optional version pinning."
proof_requirements:
  [
    "Templates fork; they do not possess the instance or create a live hidden copy.",
    "Instantiation remaps graph-local identities while preserving declared external references and access checks.",
    "The instance remains ordinary editable Content with provenance to the source Template and version used.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Multi-object Templates

## Why this exists

A working system spans more than one page, yet copying a folder of loose objects loses the relationships that make it work. Teams need a reusable starting graph that becomes genuinely theirs after installation.

## Example workflow

Kai installs a research Template graph, edits its new database and view freely, and traces the owned instance to the source version.

## Product contract

- Templates fork; they do not possess the instance or create a live hidden copy.
- Instantiation remaps graph-local identities while preserving declared external references and access checks.
- The instance remains ordinary editable Content with provenance to the source Template and version used.

## Boundaries and non-goals

- Pages, Databases, Views, Properties, Rules, Expressions, and Blocks remain the canonical objects; the Template records their portable graph and provenance.
- Templates fork rather than possess; they do not create a parallel datastore, fixed singleton, or hidden live synchronization channel.

## Acceptance stories

### Fork, do not possess

Given two teams adopt the Template, when one team edits its local database, then one local database edit does not affect the other or source.

### Remap internal identity

Given internal links and an external reference, when the graph instantiates, then new links point locally and external reference remains declared/access-checked.

## Current evidence

`docs/product/architecture.md` defines graph snapshots; Page, Database, and Reference records are donors, not graph serialization/instance recovery.

## Proof plan

1. Serialize ordinary objects, rules, expressions, bodies, and references.
2. Instantiate twice and verify independent IDs/provenance/access.
3. Test unavailable dependencies and recovery without half graphs.
4. Round-trip portable graph export/import.

## Open questions

All-or-nothing versus staged recovery needs root judgment.
