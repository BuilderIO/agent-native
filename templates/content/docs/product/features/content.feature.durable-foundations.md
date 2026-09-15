---
record_type: "feature"
id: "content.feature.durable-foundations"
number: 1
name: "Durable foundations"
chapter: "content.chapter.durable-home"
order: 1
roadmap_status: "in_validation"
summary: "Pages, Blocks, Databases, Search, history, and recovery form one trustworthy material loop."
example_workflow: "A teammate creates a project brief, turns its action items into Database records with owners and due dates, closes the app, finds the work again through Search, restores an accidentally deleted Block, and asks an agent to continue from the same durable context."
works_today: "Content already has SQL-backed Pages, rich Blocks, Databases, Search, document snapshots, and a broad agent Action surface. People and agents can perform much of the ordinary creation and editing loop on the same durable objects."
remains: "Stable Block identity, actor-aware history, dependable recovery across every object type, and complete end-to-end action parity still need to become one polished foundation."
required_capabilities:
  [
    "content.object.page",
    "content.object.block",
    "content.object.blocks-field",
    "content.object.database",
    "content.knowledge.search",
    "content.event.committed",
    "content.history.queryable",
    "content.agent.action-parity",
  ]
enhancing_capabilities:
  [
    "content.version.field-history",
    "content.property.actor",
    "content.author.document-editor",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 1: Durable foundations

Pages, Blocks, Databases, Search, history, and recovery form one trustworthy material loop.

## Product contract

- **Pages:** Hold durable identity, access, properties, rich content, and the context required to resume work.
- **Blocks:** Give every editable rich-content body the same composable grammar, whether it belongs to a Page, Property, Comment, or message.
- **Databases:** Govern writable collections, membership, typed Properties, validation, defaults, Rules, and the canonical path for creating records.
- **Search:** Finds only what the current person can access and opens the exact object or context they were looking for.
- **History:** Records attributable committed Events and logical Revisions without turning every keystroke into a fake milestone.
- **Recovery:** Restores deleted or changed work without discarding the history that explains what happened.
- **Agent parity:** Lets agents perform the same authorized operations through the same Action surface rather than a second, weaker API.
