---
record_type: "capability"
spec_version: 2
id: "content.publish.public"
name: "Public publication"
user_promise: "Publish one chosen Page revision at a stable public destination while private work continues safely."
primary_user_job: "Make an approved version public without accidentally publishing draft edits, comments, or private dependencies."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies:
  [
    "content.access.visibility-closure",
    "content.version.branching",
    "content.renderer.typed",
  ]
related_features: ["content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A Page-first publication object binds a stable destination to one Page, selected Version, and exact revision, previews the actual audience closure, records lifecycle events, and changes only when an authorized publisher explicitly updates or withdraws it."
proof_requirements:
  [
    "Publication identity, revision binding, lifecycle, URL, and rollback tests",
    "Audience-closure and private-collaboration leakage tests",
    "Publisher preview, publish, private follow-on edit, update, and unpublish interface workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Public publication

## Why this exists

Public truth deserves a deliberate pin, not whatever happened to be in the editor when the wind changed.

## Example workflow

An editor previews the approved article revision, publishes it at a stable URL, continues private revision work, then explicitly replaces the public revision after another preview.

## Product contract

- Publication is Page-first and binds Page identity, selected Version, exact revision, destination, audience closure, and lifecycle history.
- The stable URL serves the last explicitly published revision; private edits, comments, unpublished Versions, and inaccessible assets do not follow it automatically.
- Preview evaluates the real audience closure and renderer fallback before publish. Publish, update, and unpublish are explicit guarded actions with actor/origin receipts.
- Provider publishing remains a separate Source lifecycle action, not a consequence of public Content publication.

## Boundaries and non-goals

Public reading owns rendering; sharing owns access; provider adapters own external publishing. This does not turn every shared Page into a public publication.

## Acceptance stories

### Hold a public revision steady

Given a published Page and a private draft edit, when the draft changes, then the public URL keeps serving the prior bound revision until an authorized publisher updates it.

### Prevent private closure leaks

Given the selected revision references a private comment and inaccessible asset, when preview runs, then it identifies their public treatment and publishing does not expose either.

## Current evidence

Donor evidence: `server/lib/public-documents.ts`, `server/lib/public-documents.spec.ts`, and `app/routes/p.$id.tsx` implement public Page substrate. They do not prove Page/Version/revision publication identity or lifecycle isolation; this record remains `approved_shape`.

## Proof plan

1. Model publication bindings and guarded lifecycle Actions.
2. Test revision stability, closure, rollback, update, withdrawal, and provider separation.
3. Verify preview and full public lifecycle in the browser.

## Open questions

- Publication scheduling and multiple destinations are future decisions.
