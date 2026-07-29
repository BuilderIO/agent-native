---
record_type: "feature"
id: "content.feature.connect-your-sources"
number: 9
name: "Connect your sources"
chapter: "content.chapter.connected-sources"
order: 9
roadmap_status: "partially_implemented"
summary: "Choose governed native and provider Sources, preserve their identity, and compose them through Queries and Views."
example_workflow: "A content lead connects Builder blog articles and resources, aligns their compatible fields in one Query, and works from a shared editorial View without losing which provider owns each record."
works_today: "Content already models source-backed Databases, source fields and rows, provenance, multi-source composition, and adapters for Builder, Notion, and local material."
remains: "Sources need one governed catalog, Queries need to replace the confusing multi-source configuration surface, and field alignment, write routing, and access behavior need end-to-end proof."
required_capabilities:
  [
    "content.source.catalog",
    "content.source.adapters",
    "content.view.source-query",
    "content.query.object",
  ]
enhancing_capabilities: ["content.source.page-link", "content.property.catalog"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 9: Connect your sources

Choose governed native and provider Sources, preserve their identity, and compose them through Queries and Views.

## Product contract

- **Sources catalog:** Lists approved personal, workspace, and organization connections with their capabilities and policy.
- **Provider adapters:** Give Builder, Notion, Drive, Agent Native apps, and later providers one shared contract with independent certification.
- **Item binding:** Maps each provider item to one stable Content identity without turning the provider into the Page's owner.
- **Typed Queries:** Combine Databases, Sources, and other Queries through one visual selection and alignment model.
- **Provenance:** Shows where each value or representation came from and which system owns changes to it.
- **Access-safe results:** Evaluate every result and aggregate with the current viewer's authority rather than the Query owner's.
