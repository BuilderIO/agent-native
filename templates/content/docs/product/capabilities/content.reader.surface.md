---
record_type: "capability"
spec_version: 2
id: "content.reader.surface"
name: "Reader surface"
user_promise: "Read and annotate text, documents, web material, and media through one specialized Content surface."
primary_user_job: "Read comfortably, find my place, and mark exact material without creating a separate copy of the source."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.author.media",
    "content.research.annotation",
    "content.source.adapters",
  ]
related_features: ["content.feature.read-and-annotate-anything"]
roadmap_boundary: "feature"
acceptance_summary: "A specialized, embeddable Reader renders stable Content and source representations with accessible personal reading preferences, durable progress, multimodal selectors, synchronized media/transcript modes, and Actions for annotation and assistive features."
proof_requirements:
  [
    "Representation, selector, progress, preference, accessibility, and offline/cache policy tests across text and media",
    "Annotation, version-change, source-availability, playback/transcript, and assistive-action tests",
    "End-to-end read, annotate, resume, re-anchor, and embedded-reader workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Reader surface

## Why this exists

Reading has its own rhythm: the work should be quiet, personal, and still connected to the object it interprets.

## Example workflow

A researcher opens a PDF representation, adjusts width and type, highlights a page range, adds an Annotation, resumes later at progress, and can follow a transcript while audio plays.

## Product contract

- Reader is an embeddable Content surface, not necessarily a separate application or dataset.
- It renders text, PDFs, EPUBs, web material, audio, video, and transcripts through stable representation handles and source-aware fallbacks.
- Per-viewer typography, theme, pagination/flow, progress, accessibility, cache/offline policy, text-to-speech, and dictation are personal surface state; they do not change shared source truth.
- Annotations use durable selectors and version/revision context. Media playback and transcript positions remain synchronized where representations support them.

## Boundaries and non-goals

Annotations own contribution identity; adapters own representations and source availability; public reading owns public pages. Reader does not promise every format is editable or locally available.

## Acceptance stories

### Resume without changing the source

Given two readers of the same source, when one changes typography and progress, then their preferences persist for that viewer without mutating the shared Page or other reader's layout.

### Mark exact media material

Given a source video with a transcript, when a researcher annotates a transcript range, then the Annotation retains the source representation and time/range selector and can reopen the corresponding media location.

## Current evidence

Donor evidence: editor media and source representations provide foundations for rendering. No dedicated multimodal Reader, personal progress model, or end-to-end annotation proof exists; this record remains `approved_shape`.

## Proof plan

1. Define reader representation, personal state, selector, accessibility, and cache contracts.
2. Test text, paged, transcript, audio/video, unavailable source, revision, and assistive paths.
3. Verify reading, annotation, resume, and embed workflows in a real interface.

## Open questions

- The first format sequence and offline storage limits remain open.
