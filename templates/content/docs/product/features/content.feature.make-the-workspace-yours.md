---
record_type: "feature"
id: "content.feature.make-the-workspace-yours"
number: 4
name: "Make the workspace yours"
chapter: "content.chapter.durable-home"
order: 4
roadmap_status: "partially_implemented"
summary: "Personal arrangements and private Views reshape shared work without changing it for everyone else."
example_workflow: "A sales leader privately filters and groups the shared customer Database around this quarter's accounts, saves that arrangement as an Only-me View, and never changes what the rest of the company sees."
works_today: "Saved Database Views already support filtering, sorting, grouping, density, and several renderers, while the data model supports Pages belonging to multiple Databases."
remains: "Automatic personal overrides, named Only-me Views, reusable typed Queries, and predictable pinning and sharing behavior need complete product surfaces."
required_capabilities:
  [
    "content.view.query",
    "content.query.object",
    "content.view.personal-state",
    "content.share.views",
    "content.object.multi-membership",
  ]
enhancing_capabilities:
  ["content.navigation.sidebar", "content.expression.language"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 4: Make the workspace yours

Personal arrangements and private Views reshape shared work without changing it for everyone else.

## Product contract

- **Personal View changes:** Remember one person's filters, sorting, grouping, density, and presentation over a shared View.
- **Only-me Views:** Save named private Views over shared records without forking their data.
- **Shared Views:** Give collaborators a dependable starting presentation while preserving personal exploration.
- **Saved Queries:** Turn reusable selection and output logic into durable Content objects that can be linked and embedded.
- **Multiple Database memberships:** Let one Page participate in several collections without gaining a primary Database identity.
- **Pinned navigation:** Let each person choose the working set that deserves persistent space in the sidebar.
