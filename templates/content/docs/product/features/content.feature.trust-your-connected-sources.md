---
record_type: "feature"
id: "content.feature.trust-your-connected-sources"
number: 10
name: "Trust your connected Sources"
chapter: "content.chapter.connected-sources"
order: 10
roadmap_status: "partially_implemented"
summary: "Keep supported edits synchronized according to one plain-language policy without silently losing provider-specific content."
example_workflow: "An editor updates a Builder article from Content; the supported changes synchronize, an unknown Builder component survives untouched, and changing Draft to Published remains a separate guarded action."
works_today: "Builder change sets, guarded writes, raw sidecars, local-folder synchronization, and source metadata already preserve several difficult round-trip and conflict boundaries."
remains: "Every adapter needs certification against one plain-language sync policy, seamless automatic synchronization where safe, faithful unknown-content preservation, explicit lifecycle changes, and dependable receipts."
required_capabilities:
  [
    "content.source.sync-policy",
    "content.portability.roundtrip",
    "content.source.adapters",
    "content.source.builder-codec",
  ]
enhancing_capabilities:
  ["content.property.guarded-change", "content.event.committed"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 10: Trust your connected Sources

Keep supported edits synchronized according to one plain-language policy without silently losing provider-specific content.

## Product contract

- **View only:** Pulls authorized changes into Content and never writes back.
- **Keep in sync:** Moves compatible changes in both directions automatically and interrupts only for a genuine conflict.
- **Review before write-back:** Bundles Content-originated changes into one reviewable set when the workflow requires care.
- **Faithful round-tripping:** Preserves unknown provider-owned structures even when Content cannot render or edit them.
- **Conflict handling:** Uses stable identity and base revisions to prevent silent last-writer-wins data loss.
- **Provider lifecycle:** Treats states such as Draft and Published as explicit guarded changes rather than side effects of ordinary editing.
- **Receipts and retries:** Confirms what the provider actually accepted and retries without duplicating effects.
