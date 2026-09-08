---
record_type: "capability"
spec_version: 2
id: "content.portability.vault-export"
name: "Portable vault export"
user_promise: "Take the authorized Content vault away in open files plus a lossless archive instead of remaining dependent on one service."
primary_user_job: "Export my authorized work with enough meaning, assets, provenance, and verification to use or recover it elsewhere."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies:
  [
    "content.portability.roundtrip",
    "content.job.durable",
    "content.access.visibility-closure",
  ]
related_features:
  [
    "content.feature.take-the-whole-vault-with-you",
    "content.feature.bring-your-local-work",
    "content.feature.keep-your-private-vault-private",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A resumable export materializes only the acting user's authorized closure into readable open files and a lossless Content archive, includes or reports assets and source handles, and supplies a verifiable conversion report."
proof_requirements:
  [
    "Authorized-closure, dependency, asset, and inaccessible-reference tests",
    "Open-package, lossless-archive, manifest, integrity, and conversion-report verification",
    "Interrupted whole-vault export and resume workflow on a realistic corpus",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Portable vault export

## Why this exists

Portable work should leave with its meaning, not merely a pile of filenames.

## Example workflow

An administrator exports their authorized workspace. The package includes readable Markdown or MDX, tabular files, assets or stable handles, a manifest, and a Content archive; the report names inaccessible or unresolved dependencies.

## Product contract

- Export resolves the acting user's authorized closure at run time. It neither leaks inaccessible relations nor silently treats them as successfully included.
- The open package uses readable files and a small manifest for stable identity and richer semantics; the lossless archive retains Content-specific history, annotations, discussion, rules, and provenance where authorized.
- Assets are included when authorized and resolvable, otherwise represented by an honest report entry. Connected originals remain governed by Source policy.
- Work is durable, resumable, verifiable, and separated from a disposable local cache.

## Boundaries and non-goals

PDF export is a reading artifact; round-trip owns format conversion; private vault owns encryption and keys. This does not promise every destination understands every Content feature.

## Acceptance stories

### Export only an authorized graph

Given a Page references a record the exporter cannot access, when the vault exports, then the package does not include that record and the manifest reports the unresolved relationship without revealing hidden content.

### Resume a large package

Given export stops after writing a subset of assets, when the job resumes, then it verifies prior outputs and continues without duplicate objects or a false complete receipt.

## Current evidence

Donor evidence: `actions/export-document.ts`, `actions/export-content-source.ts`, and `shared/document-export.ts` cover bounded exports. No whole-vault authorized closure, lossless archive, or resume proof exists; this record remains `approved_shape`.

## Proof plan

1. Define package layout, manifest, archive semantics, and verification tool.
2. Test closure, inaccessible dependencies, assets, source handles, and integrity.
3. Run interrupted export/resume and validate the package outside Content.

## Open questions

- The first destination-compatible package and archive encryption handling remain open.
