---
record_type: "capability"
spec_version: 2
id: "content.author.media"
name: "Media Blocks"
user_promise: "Put images, audio, video, files, embeds, captions, and source-aware assets in a document without losing access or provenance."
primary_user_job: "Attach authorized media with provenance and honest fallbacks."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block"]
related_features: ["content.feature.read-and-annotate-anything"]
roadmap_boundary: "feature"
acceptance_summary: "Media Blocks use stable asset handles, access-aware rendering, upload/paste/drop intake, captions and provenance, and honest export degradation."
proof_requirements:
  [
    "Large media lives in configured blob storage; records retain handles and metadata, never embedded payload bodies.",
    "Every view checks access before loading or previewing an asset and carries captions and known source provenance.",
    "Unsupported destinations expose a declared fallback rather than silently dropping the media.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Media Blocks

## Why this exists

An asset is not just a preview: it has storage, access, caption, provenance, and export consequences. Authors need to place media naturally without leaking a private asset or losing the context that makes it useful.

## Example workflow

Leah drops an interview recording on a research Page, captions it, shares it with an editor, and exports a linked fallback.

## Product contract

- Large media lives in configured blob storage; records retain handles and metadata, never embedded payload bodies.
- Every view checks access before loading or previewing an asset and carries captions and known source provenance.
- Unsupported destinations expose a declared fallback rather than silently dropping the media.

## Boundaries and non-goals

- Storage owns bytes and Content stores only handles/metadata; source adapters own source truth and write-back policy.
- Media Blocks do not grant access through Page embedding or promise identical playback on every export destination.

## Acceptance stories

### Enforce asset access

Given a private asset appears on a shared Page, when an unauthorized viewer opens it, then no bytes or hidden metadata leak.

### Keep bytes in storage

Given a large pasted video, when saved, then Content stores only a stable handle and metadata.

## Current evidence

`app/components/editor/extensions/AudioBlock.tsx`, `VideoBlock.tsx`, and `ImageBlock.tsx` are donors; unified handle/access/provenance/export behavior is absent.

## Proof plan

1. Upload, paste, and drop supported media and verify handles/captions/provenance.
2. Test owner, shared, and denied reader behavior.
3. Export every class with its declared fallback.
4. Exercise replacement, deletion, retry, and unavailable storage.

## Open questions

Initial embed providers remain open.
