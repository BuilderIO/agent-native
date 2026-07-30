---
record_type: "feature"
id: "content.feature.work-on-content-inside-another-application"
number: 31
name: "Work on Content inside another application"
chapter: "content.chapter.publishing-portability"
order: 31
roadmap_status: "planned"
summary: "Mount and edit the same canonical Content object inside an authorized host without forking identity or permissions."
example_workflow: "A planner mounts the canonical project brief inside another Agent Native app, edits it through the same Actions, and sees the change, history, and permissions remain identical when opening it later in Content."
works_today: "Agent Native toolkits already share Content components across sibling apps, and Content exposes reusable Actions and object identities that hosts can call without duplicating business logic."
remains: "A canonical embeddable surface needs host grants, viewer-scoped authorization, shared editing and history, stable mounting contracts, responsive presentation, and later MCP App compatibility."
required_capabilities:
  [
    "content.embed.surface",
    "content.embed.host-grant",
    "content.agent.action-parity",
  ]
enhancing_capabilities: ["content.embed.mcp-app", "content.layout.responsive"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 31: Work on Content inside another application

Mount and edit the same canonical Content object inside an authorized host without forking identity or permissions.

## Product contract

- **Canonical mount:** Renders the actual Page, View, or focused Content surface rather than a copied snapshot.
- **Host grant:** Gives one named application only the mount and Action capabilities it needs.
- **Viewer authority:** Never lets the host widen what the signed-in person could see or edit in Content itself.
- **Shared Actions:** Routes edits through the same validation, permissions, Events, history, and agent surface.
- **Agent Native toolkits:** Reuse common components and behavior across sibling applications without coupling them to the Content app shell.
- **MCP App widening:** Later exposes the same governed surface to compatible external agent hosts once identity and presentation contracts are proven.
