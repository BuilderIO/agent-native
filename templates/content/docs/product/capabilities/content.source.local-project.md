---
record_type: "capability"
spec_version: 2
id: "content.source.local-project"
name: "Local project mode"
user_promise: "The former local-project proposal remains lineage for file-truth work, not an active dual-truth product contract."
primary_user_job: "Understand that selected local Sources use the common Source model and portable representation rather than a separate local-project system."
kind: "primitive"
state: "superseded"
publicness: "public"
availability: "configured"
dependencies:
  ["content.source.adapters", "content.portability.source-representation"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "This lineage record directs new local-file work to Source adapters, portable representations, folder Sources, and the local bridge; it preserves the no-default-SQL/git-dual-truth constraint and does not define a separate active mode."
proof_requirements:
  [
    "Catalog validation of the supersession target",
    "Review of new local-source work for one Source contract and explicit truth/write policy",
    "Regression review that rejects default SQL and filesystem or git dual truth",
  ]
evidence: []
superseded_by: "content.source.adapters"
last_reviewed: "2026-07-29"
---

# Local project mode

## Why this exists

The early local-project label is useful history, but a separate mode would make files and hosted Content argue over who is real.

## Example workflow

A contributor planning local repository support follows the active Source adapter, file/folder, representation, and bridge records rather than adding a special project datastore.

## Product contract

- This is lineage only; active local work uses the common Source model.
- A selected source declares its truth, representation, and write policy. SQL materialization and filesystem or git originals are not default competing truths.
- Migration between local and hosted forms must be explicit and preserve provenance, conflict, and recovery semantics.

## Boundaries and non-goals

This does not specify a new local mode, branch workflow, repository UI, or source synchronization engine.

## Acceptance stories

### Route new local work to active contracts

Given a request to add a local file workflow, when it is planned, then it names Source adapter and representation boundaries rather than creating a `local-project` mutation path.

### Refuse accidental dual truth

Given a proposed feature stores editable copies in SQL and a repository by default, when reviewed, then it is rejected until one authoritative write and recovery policy is explicit.

## Current evidence

Repository product records identify `content.source.adapters` as the active target. This superseded record makes no implementation or verification claim.

## Proof plan

1. Keep the supersession edge valid.
2. Review local-source changes for explicit source truth and migration policy.
3. Require adapter/representation proof for any future local workflow.

## Open questions

- None; active design questions belong to the successor records.
