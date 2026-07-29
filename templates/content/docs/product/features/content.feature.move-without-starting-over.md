---
record_type: "feature"
id: "content.feature.move-without-starting-over"
number: 30
name: "Move without starting over"
chapter: "content.chapter.publishing-portability"
order: 30
roadmap_status: "partially_implemented"
summary: "Import or migrate a foreign corpus with resumable progress, provenance, repair, and a readable conversion report."
example_workflow: "A team imports a large Notion workspace, closes the browser halfway through, resumes without duplicate Pages, and reviews a conversion report showing transformed Properties and unresolved assets."
works_today: "Markdown and MDX import, Notion workflows, Builder pulls, local-folder synchronization, provenance, and provider identities already support several bounded migration paths."
remains: "Large migrations need durable server-side orchestration, checkpoints, idempotent deduplication, broader schema fidelity, conversion reports, asset repair, resumability, and explicit partial-failure recovery."
required_capabilities:
  [
    "content.job.durable",
    "content.source.adapters",
    "content.portability.roundtrip",
  ]
enhancing_capabilities: ["content.source.catalog", "content.event.committed"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 30: Move without starting over

Import or migrate a foreign corpus with resumable progress, provenance, repair, and a readable conversion report.

## Product contract

- **Canonical import model:** Maps Pages, Databases, Properties, Blocks, relationships, files, and metadata into stable Content objects.
- **Provider-specific adapters:** Interpret Notion, local vaults, Builder, Drive, and later formats without making any provider's dialect the core model.
- **Checkpoint and resume:** Continues large migrations after interruption without duplicating already accepted records.
- **Identity and deduplication:** Preserves stable source IDs and makes repeated imports repair or update the intended objects.
- **Conversion report:** Explains unsupported or transformed semantics instead of quietly dropping them.
- **Repair workflows:** Lets people and agents inspect unresolved mappings, missing assets, conflicts, and partial failures.
- **Provenance:** Keeps enough source context to compare, refresh, or understand the imported material later.
