---
record_type: "capability"
spec_version: 2
id: "content.object.transclusion"
name: "Synced Blocks and live embeds"
user_promise: "A Page or Block can appear by reference in several places and authorized edits change the one canonical object."
primary_user_job: "Reuse maintained material without copy-and-paste drift."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference"]
related_features: ["content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "Live inclusion preserves canonical Page or Block identity, access intersection, provenance, history, and editing behavior while making fork and static snapshot modes explicit."
proof_requirements:
  [
    "Canonical target identity and occurrence rendering",
    "Explicit live, snapshot, and fork semantics",
    "Access intersection and source/provenance affordances",
    "Comment, Version, deletion, and portable-degradation behavior",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Synced Blocks and live embeds

## Why this exists

Repeated canonical language should update once. A copied paragraph grows quiet forks; a live inclusion keeps the work one living thing.

## Example workflow

A team includes its approved product-description Block in three guides. An authorized editor changes it from any occurrence, all authorized renderings update, and each occurrence offers the source/provenance context.

## Product contract

- A live transclusion renders one canonical Page or Block identity in another authorized host.
- Editing a live occurrence invokes the target's shared Action and authority, never a synchronized copy.
- Live inclusion, static snapshot, and editable fork are explicit modes with different update and provenance behavior.
- The viewer must satisfy both host and target access; the render cannot widen either object's audience.
- Comments, Discussion context, history, and Versions identify the canonical target and the viewing occurrence where useful.

## Boundaries and non-goals

- A compact Reference may preview a target but is not necessarily an editable live transclusion.
- A transclusion does not merge Page identity, membership, access, or history with its host.
- This record does not define source synchronization or arbitrary remote embeds.

## Acceptance stories

### Edit one canonical Block

Given a live Block included in three Pages, when an authorized editor changes it from one occurrence, then every authorized occurrence shows the canonical update and one attributable history records the target change.

### Preserve an intentional fork

Given an editor chooses fork instead of live inclusion, when the source later changes, then the fork remains independent, retains provenance, and is not silently overwritten.

## Current evidence

Existing Page references and ordinary embedded Database surfaces are useful substrate. The repository does not yet prove stable editable Block transclusion, explicit mode selection, access intersection, or complete history behavior; this remains `approved_shape`.

## Proof plan

1. Render and edit live Page and Block inclusions from multiple hosts.
2. Test live, snapshot, and fork conversion, source deletion, and portable export.
3. Verify access changes, private hosts/targets, comments, Versions, and agent actions.
4. Exercise concurrent target edits, undo, reload, keyboard, and assistive technology.

## Open questions

The exact occurrence controls and portable encoding can vary; the target identity and explicit mode distinctions cannot.
