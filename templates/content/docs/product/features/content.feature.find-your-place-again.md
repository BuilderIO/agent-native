---
record_type: "feature"
id: "content.feature.find-your-place-again"
number: 2
name: "Find your place again"
chapter: "content.chapter.durable-home"
order: 2
roadmap_status: "partially_implemented"
summary: "Content makes arrival, navigation, and resumption feel dependable instead of asking people to remember where they left everything."
example_workflow: "A new teammate follows an invitation, lands in the correct organization and Workspace, pins the project they care about, and later returns directly to the exact Database View they were using."
works_today: "Content has Personal and organization-backed spaces, Workspace navigation, invitations, sidebar structure, and saved location state in varying degrees of maturity."
remains: "Global Home, clearer context switching, intentional pinning and dynamic sidebar sections, and reliable resumption into the exact focused View need to work as one arrival experience."
required_capabilities:
  [
    "content.source.spaces-files",
    "content.workspace.multi-scope",
    "content.home.global",
    "content.navigation.sidebar",
    "content.workspace.session-restore",
  ]
enhancing_capabilities:
  ["content.workspace.working-set", "content.workspace.view-instance"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 2: Find your place again

Content makes arrival, navigation, and resumption feel dependable instead of asking people to remember where they left everything.

## Product contract

- **Home:** Gives each person a top-level view across the Personal and organization contexts they can access.
- **Workspaces:** Organize Pages and Databases beneath Personal or an Organization without becoming the permission model themselves.
- **Sidebar:** Pins important Pages, Databases, and Queries while allowing dynamic sections such as Recent and Shared with me.
- **Recent work:** Restores the objects and views a person was actually using, scoped by current access.
- **Known links and invitations:** Land on the intended object with an honest access-denied state when permission is missing.
- **Session resumption:** Reopens enough navigation and View state to pick up the work without reconstructing the route manually.
