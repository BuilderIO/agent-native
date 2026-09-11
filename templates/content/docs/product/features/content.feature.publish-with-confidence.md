---
record_type: "feature"
id: "content.feature.publish-with-confidence"
number: 28
name: "Publish with confidence"
chapter: "content.chapter.publishing-portability"
order: 28
roadmap_status: "partially_implemented"
summary: "Publish one chosen revision faithfully while private collaborative work continues behind it."
example_workflow: "An editor publishes the current approved article revision, continues working privately on a new Version, previews exactly what public readers can see, and updates the stable URL only when the replacement is ready."
works_today: "Content already supports sharing, public Pages, stable links, several exports, access checks, and server-rendered public surfaces."
remains: "Publication must bind to an exact revision or named Version, preview the real audience closure, render every Block faithfully, isolate private collaboration, preserve lifecycle history, and become polished enough for dependable CMS use."
required_capabilities:
  [
    "content.publish.public",
    "content.publish.reading",
    "content.access.visibility-closure",
  ]
enhancing_capabilities:
  [
    "content.version.branching",
    "content.portability.pdf-export",
    "content.property.guarded-change",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 28: Publish with confidence

Publish one chosen revision faithfully while private collaborative work continues behind it.

## Product contract

- **Publication object:** Binds one public destination to a Page, selected Version, and exact revision.
- **Page-first publishing:** Keeps Publish, Update publication, and Unpublish inside the familiar Page sharing surface.
- **Stable public URL:** Serves the last explicitly published truth rather than following every private edit automatically.
- **Rich Block fidelity:** Renders every accepted Block family or a deliberate safe fallback through the shared semantic renderer.
- **Audience preview:** Shows what the public reader can actually access before publication.
- **Private-work separation:** Prevents Comments, Discussion, unpublished Versions, inaccessible assets, and internal Properties from leaking.
- **Lifecycle history:** Records who published, updated, or withdrew which revision and preserves the public artifact's provenance.
