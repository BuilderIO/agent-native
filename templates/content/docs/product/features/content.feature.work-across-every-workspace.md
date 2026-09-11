---
record_type: "feature"
id: "content.feature.work-across-every-workspace"
number: 11
name: "Work across every workspace"
chapter: "content.chapter.connected-sources"
order: 11
roadmap_status: "partially_implemented"
summary: "Search and save Queries across Personal and organization contexts without widening anyone's access."
example_workflow: "A person searches their current Workspace, deliberately expands to all accessible contexts, saves a Query spanning Personal and two organizations, and shares it with someone who sees only their own authorized intersection."
works_today: "Content has Personal and organization spaces, Workspace membership, scoped access checks, and the beginnings of cross-space navigation and search."
remains: "Active working context must separate cleanly from retrieval scope, while global Home, cross-context Queries, counts, aggregates, and viewer-specific evaluation need complete implementation."
required_capabilities:
  [
    "content.workspace.multi-scope",
    "content.query.object",
    "content.access.visibility-closure",
  ]
enhancing_capabilities: ["content.home.global", "content.organization.teams"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 11: Work across every workspace

Search and save Queries across Personal and organization contexts without widening anyone's access.

## Product contract

- **Active context:** Determines where new work is created and which organization or Personal surface governs it.
- **Retrieval scope:** Can widen deliberately beyond the active context without moving or re-authorizing objects.
- **Cross-workspace Search:** Expands from the current Workspace to every accessible context through an explicit control.
- **Cross-workspace Queries:** Save durable, shareable definitions that retain each source object's location and provenance.
- **Viewer evaluation:** Shows every reader only the intersection they can access, including counts and aggregates.
- **Global Home:** Composes authorized recent work, Queries, and dashboards without pretending everything belongs to one giant Workspace.
