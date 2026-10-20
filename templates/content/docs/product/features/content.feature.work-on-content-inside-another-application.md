---
record_type: "feature"
id: "content.feature.work-on-content-inside-another-application"
number: 31
name: "Work on Content inside another application"
chapter: "content.chapter.publishing-portability"
order: 31
roadmap_status: "partially_implemented"
summary: "Mount and edit the same canonical Content object inside an authorized host without forking identity or permissions."
example_workflow: "A planner mounts the canonical project brief inside another Agent-Native app, edits it through the same Actions, and sees the change, history, and permissions remain identical when opening it later in Content."
works_today: "The ChatGPT Content widget opens an editable canonical document with the app's document layout, top bar, formatting toolbar, and Share controls. Artifact-scoped write grants and scoped read tickets support that editor, with load and access fixes across the widget path (#6856, #6909, #6913, #6918, #6923, #6945, #7149, #7257, #7317)."
remains: "The widget still needs real-host and full lifecycle proof. A general Page or View mount contract, host grants across applications, viewer-scoped authorization, shared history and concurrent-update parity, responsive navigation, and broader MCP App compatibility remain unproven."
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
last_reviewed: "2026-10-12"
---

# Feature 31: Work on Content inside another application

Mount and edit the same canonical Content object inside an authorized host without forking identity or permissions.

## Product contract

- **Canonical mount:** Renders the actual Page, View, or focused Content surface rather than a copied snapshot.
- **Host grant:** Gives one named application only the mount and Action capabilities it needs.
- **Viewer authority:** Never lets the host widen what the signed-in person could see or edit in Content itself.
- **Shared Actions:** Routes edits through the same validation, permissions, Events, history, and agent surface.
- **Agent-Native toolkits:** Reuse common components and behavior across sibling applications without coupling them to the Content app shell.
- **MCP App widening:** Later exposes the same governed surface to compatible external agent hosts once identity and presentation contracts are proven.
