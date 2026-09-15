---
record_type: "feature"
id: "content.feature.run-projects-your-way"
number: 18
name: "Run projects your way"
chapter: "content.chapter.working-systems"
order: 18
roadmap_status: "partially_implemented"
summary: "Use an editable Task and Project system built from ordinary Content rather than a second hidden engine."
example_workflow: "A product team installs the blessed project Template, captures tasks from the keyboard, assigns owners, links subtasks and dependencies, and uses My Tasks while every task remains an ordinary editable Page."
works_today: "Pages, Databases, status and person Properties, relations, Board and Calendar Views, Templates, Comments, and agent Actions already let teams assemble useful project systems."
remains: "The blessed Template needs fast capture, polished defaults, task and subtask Views, My Tasks, activity, dependencies, permissions, and end-to-end Builder dogfooding without introducing a separate task engine."
required_capabilities:
  [
    "content.system.task-project",
    "content.system.my-tasks",
    "content.system.dependencies",
    "content.system.project-status",
  ]
enhancing_capabilities:
  [
    "content.view.fast-capture",
    "content.relationship.edge",
    "content.notification.source",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 18: Run projects your way

Use an editable Task and Project system built from ordinary Content rather than a second hidden engine.

## Product contract

- **Blessed Template:** Provides a strong starting system that remains inspectable and editable like any other Content setup.
- **Fast capture:** Creates work quickly with unambiguous View-derived defaults and useful keyboard navigation.
- **Assignments:** Use ordinary typed Person and Team Properties with access-safe attention and notifications.
- **Subtasks and dependencies:** Store hierarchy and blocking relationships through typed Relations with cycle protection.
- **My Tasks:** Queries assigned work across authorized memberships without inventing a private task datastore.
- **Project status:** Combines explicit owner judgment with useful rollups rather than pretending a formula can manage the project.
- **Ordinary Pages:** Lets every Task retain rich content, Properties, Discussion, Versions, and the ability to join other Databases.
