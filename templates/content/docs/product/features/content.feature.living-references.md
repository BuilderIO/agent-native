---
record_type: "feature"
id: "content.feature.living-references"
number: 3
name: "Living references"
chapter: "content.chapter.durable-home"
order: 3
roadmap_status: "partially_implemented"
summary: "Reuse canonical Pages and Blocks without producing copies that quietly drift apart."
example_workflow: "The Docs team maintains one canonical product-description Block that appears across several guides and blog posts, edits it from any occurrence, and sees every authorized location update without copy and paste."
works_today: "Content can reference Pages, embed ordinary Database Views, and preserve multi-membership without copying canonical records. Existing reference Blocks and source-aware identities provide useful substrate."
remains: "Stable Block references, editable Synced Blocks, canonical Page embeds, a complete Connections surface, and typed relationship behavior still need to converge."
required_capabilities:
  [
    "content.object.reference",
    "content.object.transclusion",
    "content.knowledge.links",
    "content.relationship.edge",
  ]
enhancing_capabilities: ["content.object.block", "content.version.branching"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 3: Living references

Reuse canonical Pages and Blocks without producing copies that quietly drift apart.

## Product contract

- **References:** Link to a Page or Block as a compact mention, card, or embedded preview.
- **Synced Blocks:** Render one canonical Block in several places and allow authorized edits from any occurrence.
- **Embedded Pages:** Place a canonical Page inside another surface while preserving its identity and access.
- **Backlinks and forward links:** Show where an object is mentioned and what it intentionally references through Info → Connections.
- **Typed Relationships:** Give important connections explicit meaning that Databases, Queries, Graphs, and agents can use.
- **Graceful degradation:** Omit inaccessible references and preserve understandable broken or deleted-reference states.
