---
record_type: "feature"
id: "content.feature.capture-into-action"
number: 24
name: "Capture into action"
chapter: "content.chapter.capture-research"
order: 24
roadmap_status: "partially_implemented"
summary: "Resolve or create one canonical Page in the chosen Database, preserve provenance, and hand it to that Database's Rules and agents."
example_workflow: "Someone shares a customer interview URL from their phone to the Research Database; Content reuses the canonical Source Page, preserves the transcript and provenance, and lets the Database's Rules extract companies and open questions."
works_today: "Content can already import or create Pages from files, URLs, providers, local Sources, and Agent Actions, with useful provenance and Database destinations in several paths."
remains: "Every entrance needs one Capture contract with remembered destination, canonical deduplication, idempotency, snapshot handling, Template application, receipts, and clean downstream enrichment."
required_capabilities:
  ["content.capture.enrich", "content.source.catalog", "content.job.durable"]
enhancing_capabilities: ["content.rule.deterministic", "content.template.graph"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 24: Capture into action

Resolve or create one canonical Page in the chosen Database, preserve provenance, and hand it to that Database's Rules and agents.

## Product contract

- **Many entrances:** Accepts browser capture, share sheets, Clips, URLs, files, email, identifiers, providers, and Agent Actions through one contract.
- **Remembered destination:** Defaults to the last Database used for that entrance while keeping the destination easy to change.
- **Idempotent resolution:** Finds an existing canonical Page or creates exactly one, with a deliberate-copy escape hatch.
- **Provenance:** Preserves the original URL, identifier, provider identity, capture time, snapshot, and available representations.
- **Database handoff:** Applies the destination's Template, defaults, memberships, validation, and permissions.
- **Downstream enrichment:** Lets target-owned Rules and agents summarize, classify, extract, or route the record without making Capture wait for them.
- **Receipts and repair:** Reports what Capture created or reused and allows failed later enrichment to retry independently.
