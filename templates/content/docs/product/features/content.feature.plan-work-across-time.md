---
record_type: "feature"
id: "content.feature.plan-work-across-time"
number: 19
name: "Plan work across time"
chapter: "content.chapter.working-systems"
order: 19
roadmap_status: "planned"
summary: "Edit dates and dependencies through Timeline and Gantt-style planning while preserving the same typed records underneath."
example_workflow: "A project manager opens a Timeline, drags a blocked launch task into the following week, sees the dependency conflict, accepts a proposed schedule repair, and preserves the updated dates and Relationships everywhere else."
works_today: "A Timeline renderer, typed date Properties, drag editing, relations, grouping, and shared View configuration already exist as partially proven pieces."
remains: "Timeline needs full renderer conformance and polish, while dependency metadata, schedule constraints, milestones, repair proposals, critical path, and Gantt-style interaction remain planned layers."
required_capabilities:
  [
    "content.view.timeline",
    "content.time.types",
    "content.relationship.edge",
    "content.schedule.constraints",
  ]
enhancing_capabilities:
  ["content.system.dependencies", "content.view.grouping-aggregation"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 19: Plan work across time

Edit dates and dependencies through Timeline and Gantt-style planning while preserving the same typed records underneath.

## Product contract

- **Timeline:** Places records across typed dates, Instants, ranges, and durations.
- **Direct manipulation:** Moves or resizes permitted work through ordinary typed Actions.
- **Dependency connectors:** Renders the same Relationships used by Queries and project workflows.
- **Schedule constraints:** Detects invalid ordering and either refuses, explains, or proposes a repair according to policy.
- **Gantt mode:** Combines Timeline, dependencies, milestones, grouping, and schedule behavior without becoming another View family.
- **Critical path:** Remains a later planning layer after dependency and constraint semantics are dependable.
