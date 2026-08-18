---
record_type: "capability"
spec_version: 2
id: "content.property.catalog"
name: "Custom Properties"
user_promise: "Reuse an approved field definition deliberately without making same-named local columns secretly equal."
primary_user_job: "Reuse a governed field and safely update or detach it."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed", "content.template.governance"]
related_features:
  [
    "content.feature.connect-your-sources",
    "content.feature.share-how-your-organization-works",
    "content.feature.evolve-systems-safely",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Custom Properties are governed, scoped reusable typed definitions with stable identity, description, provenance, query semantics, versioned updates, impact preview, safe migration, and detachable local copies."
proof_requirements:
  [
    "The add-column picker distinguishes built-in local types, source-backed fields, and personal, workspace, or organization Custom Properties.",
    "A definition's stable identity—not its name—controls query meaning, provenance, and compatible updates.",
    "A consumer may detach to a local field; updates are reviewed and impact-previewed, never silently applied.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Custom Properties

## Why this exists

Same-named columns are not shared meaning. Organizations need a way to reuse a field deliberately, understand where it came from, and evolve it without silently rewriting a local database.

## Example workflow

Marta publishes Customer tier, a database adopts it, previews an enum update, and another database detaches locally while keeping values.

## Product contract

- The add-column picker distinguishes built-in local types, source-backed fields, and personal, workspace, or organization Custom Properties.
- A definition's stable identity—not its name—controls query meaning, provenance, and compatible updates.
- A consumer may detach to a local field; updates are reviewed and impact-previewed, never silently applied.

## Boundaries and non-goals

- `content.property.typed` owns type semantics and Template governance owns catalog policy; Custom Properties own reusable definition/adoption identity.
- The catalog does not equate columns by name, make local columns secretly global, or auto-migrate incompatible values.

## Acceptance stories

### Labels are not identity

Given local and organization Status fields, when an author opens Add column, then Add column distinguishes their IDs and origins.

### Stage risky migration

Given a breaking type/option update, when its owner proposes publication, then Content previews impact and blocks or stages unsafe conversion.

## Current evidence

`server/plugins/db.ts`, `actions/configure-document-property.ts`, `actions/bind-content-database-source-field.ts`, and `DocumentProperties.tsx` are donors; catalog/adoption/detach/migration do not exist.

## Proof plan

1. Build scoped Add column discovery with IDs/provenance.
2. Adopt across databases and test semantics/access.
3. Publish compatible/breaking versions with impact/migration/receipts.
4. Detach without losing values.

## Open questions

Scope names need root judgment.
