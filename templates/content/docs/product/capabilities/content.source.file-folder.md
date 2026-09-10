---
record_type: "capability"
spec_version: 2
id: "content.source.file-folder"
name: "Files and folders as Sources"
user_promise: "Open a selected file tree as a Source without forcing heterogeneous files into one Database schema."
primary_user_job: "Browse and work with a local folder through Content while retaining file identity, hierarchy, device limits, and source ownership."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "configured"
dependencies:
  ["content.source.adapters", "content.portability.source-representation"]
related_features: ["content.feature.bring-your-local-work"]
roadmap_boundary: "feature"
acceptance_summary: "A folder Source models a selected root and heterogeneous file representations with stable source identity and hierarchy, materializes only supported authorized content, and delegates physical authority, sync, and write-back to the Source adapter and local bridge."
proof_requirements:
  [
    "Folder identity, hierarchy, heterogeneous representation, and source-metadata tests",
    "Access, local-path redaction, add/change/delete/rename/conflict/degraded-client tests",
    "Selected-folder workflow covering browse, open, external change, unavailable device, and disconnect",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-08-17"
---

# Files and folders as Sources

## Why this exists

A folder is a living landscape of unlike things; it should not have to masquerade as one spreadsheet.

## Example workflow

A developer selects a documentation folder. Content shows a source-root hierarchy, opens supported files as Pages, keeps unknown files identifiable, and shows last synchronized material when a browser lacks the local bridge.

## Product contract

- A folder Source retains selected-root, relative hierarchy, file identity, representation kind, baseline, and provenance without exporting raw paths or handles to shared clients.
- Files may map to different Content representations or remain opaque/unavailable; no common Database schema is assumed.
- Physical reads, watches, writes, rename/delete behavior, conflict, and bridge availability follow adapter and local-bridge policy.
- Removing a connection stops future source access without silently deleting external originals.

## Boundaries and non-goals

Local bridge owns device authority; portable representation owns materialization; Files UI is a projection. This is not a universal filesystem browser or arbitrary directory access grant.

## Acceptance stories

### Browse heterogeneous material

Given a selected folder with Markdown, PDF, and unsupported binary files, when it materializes, then Content preserves hierarchy and source identity while exposing only the representations each file supports.

### Degrade without exposing paths

Given a browser without bridge authority, when it opens a materialized folder item, then it can read the last authorized representation but cannot reveal the local path or invoke physical file operations.

## Current evidence

Current implementation adds opaque Desktop grants, recursive Markdown materialization, watched reconciliation with a bounded fallback, atomic revision-guarded writes, and local working-copy identity. Focused tests cover the substrate, but packaged real-interface authority, recovery, redaction, and cleanup proof is still pending, and heterogeneous file families remain exploratory. This Capability therefore remains `exploring`.

## Proof plan

1. Define folder/file representation and hierarchy contract independent of one Database schema.
2. Test file lifecycle, path redaction, bridge absence, conflicts, and disconnect.
3. Verify selection, browse, sync, external change, and repair through the interface.

## Open questions

- Supported file-family order and directory-scale behavior remain open.
