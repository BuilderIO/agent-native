---
record_type: "feature"
id: "content.feature.read-and-annotate-anything"
number: 25
name: "Read and annotate anything"
chapter: "content.chapter.capture-research"
order: 25
roadmap_status: "planned"
summary: "Read comfortably, mark exact material, preserve revision context, and find those Annotations again."
example_workflow: "A researcher opens a PDF, adjusts the reading layout, highlights an exact passage, adds a durable Annotation, and later finds it from the Annotations rail even after the source receives a new revision."
works_today: "Content already renders rich documents and media Blocks, supports anchored Comments, stores source representations, and has ordinary reading and export foundations."
remains: "The dedicated Reader experience, durable Annotation object and rail, precise selectors across media, revision-aware anchoring, carry-forward, reading preferences, progress, dictation, and read-aloud are still planned."
required_capabilities:
  [
    "content.reader.surface",
    "content.research.annotation",
    "content.author.media",
  ]
enhancing_capabilities: ["content.version.branching", "content.source.adapters"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 25: Read and annotate anything

Read comfortably, mark exact material, preserve revision context, and find those Annotations again.

## Product contract

- **Reader surface:** Provides personal typography, width, pagination, theme, progress, and distraction-free modes.
- **Document and media representations:** Supports text, transcripts, PDFs, EPUBs, audio, video, and source-aware fallbacks over stable asset handles.
- **Annotations:** Store durable highlights, notes, tags, reactions, or structured extractions independently from resolvable Comments.
- **Precise selectors:** Anchor to text ranges, pages, regions, timestamps, transcript ranges, and the source revision being viewed.
- **Annotations rail:** Reveals highlights only when opened and supports search, filtering, grouping, re-anchoring, and orphan repair.
- **Carry-forward:** Moves a filtered set of relevant Annotations to another named Version without pretending every old anchor still exists.
- **Speech:** Adds dictation and read-aloud through shared Agent Native capabilities rather than a Reader-only AI system.
