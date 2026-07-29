---
record_type: "feature"
id: "content.feature.take-the-whole-vault-with-you"
number: 29
name: "Take the whole vault with you"
chapter: "content.chapter.publishing-portability"
order: 29
roadmap_status: "partially_implemented"
summary: "Export the complete authorized vault into open, understandable formats and a lossless Content archive."
example_workflow: "An organization exports every object the acting administrator can access into an open Markdown, CSV, assets, and manifest vault plus a lossless Content archive, then verifies the package without Content."
works_today: "Content exports Page bodies as Markdown, HTML, and PDF-shaped output and can export editable Markdown or MDX source, with local-file workflows already proving part of the portability model."
remains: "Whole-vault export needs CSV, assets, an open manifest, a lossless Content archive, Notion-compatible packaging, authorized dependency closure, resumable jobs, verification, and Desktop backup."
required_capabilities:
  [
    "content.portability.vault-export",
    "content.portability.roundtrip",
    "content.job.durable",
  ]
enhancing_capabilities:
  ["content.portability.pdf-export", "content.source.local-bridge"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 29: Take the whole vault with you

Export the complete authorized vault into open, understandable formats and a lossless Content archive.

## Product contract

- **Open vault:** Uses Markdown or MDX, CSV, ordinary asset folders, and a small manifest for stable IDs and richer semantics.
- **Lossless Content archive:** Preserves Versions, Discussion, Comments, Annotations, Rules, provenance, and other Content-specific meaning.
- **Target packages:** Produces destination-aware exports, beginning with a Notion-compatible package and conversion report.
- **Authorized closure:** Materializes exactly what the exporter can currently see without leaking inaccessible dependencies.
- **Assets and Sources:** Includes authorized files or stable handles and reports anything that could not be resolved.
- **Durable transfer job:** Supports progress, interruption, retry, and resume without duplicating work.
- **Local backup:** Lets Desktop maintain a user-chosen portable vault separately from its fast disposable cache.
