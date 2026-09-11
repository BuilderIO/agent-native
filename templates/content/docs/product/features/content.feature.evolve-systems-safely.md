---
record_type: "feature"
id: "content.feature.evolve-systems-safely"
number: 16
name: "Evolve systems safely"
chapter: "content.chapter.working-systems"
order: 16
roadmap_status: "planned"
summary: "Review upstream changes to adopted systems, keep local work intact, and choose what to accept or detach."
example_workflow: "A new version of the editorial Template adds one Property and changes a Rule; each Database owner sees the impact, accepts the Property, declines the Rule, preserves local changes, and stops seeing the same declined update."
works_today: "Version history, diff donors, stable identifiers, Templates, and source change-review machinery provide the pieces needed to compare evolving systems."
remains: "Governed building blocks need version pinning, affected-object previews, owner-scoped adoption, selective apply and reset, remembered declines, deprecation, and safe permanent divergence."
required_capabilities:
  [
    "content.template.update",
    "content.property.catalog",
    "content.diff.in-place",
  ]
enhancing_capabilities:
  ["content.template.governance", "content.event.committed"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 16: Evolve systems safely

Review upstream changes to adopted systems, keep local work intact, and choose what to accept or detach.

## Product contract

- **Version pinning:** Keeps each adopted Template or Custom Property on the version its owner trusts.
- **Impact preview:** Shows affected Databases, Views, Queries, formulas, Rules, Templates, and agent workflows before publication.
- **Three-way comparison:** Distinguishes the old shared definition, the proposed update, and local changes.
- **Selective adoption:** Lets each owner accept compatible changes, decline others, or apply a safe batch.
- **Quiet decline memory:** Avoids repeatedly demanding review until the upstream change materially differs.
- **Detach to local:** Ends the shared lineage without breaking the current system or losing provenance.
