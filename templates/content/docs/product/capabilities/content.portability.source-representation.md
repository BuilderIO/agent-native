---
record_type: "capability"
spec_version: 2
id: "content.portability.source-representation"
name: "Portable Source representation"
user_promise: "Connected and local material has a portable Content representation without pretending Content owns every original."
primary_user_job: "Move between local, hosted, and provider-backed work while retaining identity, provenance, fidelity limits, and a readable recovery path."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters"]
related_features: ["content.feature.bring-your-local-work"]
roadmap_boundary: "feature"
acceptance_summary: "A portable representation separates stable Content identity from source bindings, preserves source-owned unknown data and baselines, records fidelity and access limits, and can be materialized or repaired without default dual truth."
proof_requirements:
  [
    "Representation schema and round-trip fixtures for native, provider, and local sources",
    "Identity, provenance, unknown-data, baseline, conflict, access, and repair tests",
    "Cross-client materialization and recovery workflow without raw local handles in shared state",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Portable Source representation

## Why this exists

Portability needs a map of what Content knows and what remains somewhere else, not an accidental second original.

## Example workflow

A local document is materialized for browser reading. Its Page identity, source binding, baseline, and unavailable local bytes remain distinguishable; an authorized bridge can later refresh or repair it.

## Product contract

- Stable Content identity is distinct from source connection, provider item identity, representation, baseline, and field ownership.
- Source-owned unknown structures survive as faithful opaque data or explicit unsupported state; Content does not flatten them into editable guesses.
- Materializations retain provenance, freshness, fidelity, and access boundaries. Local paths and handles do not enter shared state.
- A source policy declares which direction may write and how conflict/recovery works; default SQL and filesystem dual truth is prohibited.

## Boundaries and non-goals

Adapters own provider behavior; round-trip owns conversion fidelity; local bridge owns device authority. This is not a universal file format or a claim of byte-perfect representation for every provider.

## Acceptance stories

### Preserve an unknown provider structure

Given a source representation contains an unsupported provider component, when a mapped Content field changes, then the unknown component remains tied to its source identity and is not rewritten as ordinary Content data.

### Keep local custody local

Given a local file is materialized for another client, when that client inspects its Source metadata, then it can identify freshness and availability without receiving a raw path or filesystem handle.

## Current evidence

Donor evidence: `shared/content-source.ts`, `actions/_document-source.ts`, and source adapter actions model present source metadata. No complete portable representation, cross-client recovery, and fidelity proof exists; this record remains `approved_shape`.

## Proof plan

1. Specify representation, baseline, opaque payload, fidelity, and access fields.
2. Test source identities, unknown preservation, conflicts, repair, and redaction.
3. Verify local and provider materialization across clients with no dual truth claim.

## Open questions

- The exact portable archive encoding for opaque provider payloads remains open.
