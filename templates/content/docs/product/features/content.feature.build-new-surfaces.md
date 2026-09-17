---
record_type: "feature"
id: "content.feature.build-new-surfaces"
number: 20
name: "Build new surfaces"
chapter: "content.chapter.working-systems"
order: 20
roadmap_status: "partially_implemented"
summary: "Create a one-off artifact, then promote it into a governed reusable Custom Block when it earns reuse."
example_workflow: "An agent creates a one-off interactive calculator inside a Page; its owner inspects the source and rendered result, then promotes it to an approved Custom Block that coworkers can insert from the slash menu."
works_today: "Sandboxed Extensions, local MDX components, HTML artifacts, executable-code foundations, and shared component toolkits already demonstrate several rendering and execution modes."
remains: "These pieces need one Custom Block lifecycle with inspectable source, secure sandboxing, optional typed props, one-off artifacts, promotion, governed catalogs, source-backed origins, and slash-command discovery."
required_capabilities:
  ["content.renderer.artifact-block", "content.renderer.custom-block"]
enhancing_capabilities: ["content.author.code", "content.renderer.typed"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 20: Build new surfaces

Create a one-off artifact, then promote it into a governed reusable Custom Block when it earns reuse.

## Product contract

- **Artifact Block:** Stores Page-owned HTML, styles, and behavior without requiring props or a catalog entry.
- **Source and rendered views:** Lets authors inspect the code underneath and the output it produces.
- **Sandbox:** Denies network and application authority by default while enforcing time, memory, output, and asset limits.
- **Save as Custom Block:** Promotes a useful one-off into a governed reusable definition with stable identity.
- **Custom Blocks catalog:** Controls discovery, ownership, versions, permissions, compatibility, and typed props where useful.
- **Source-backed origins:** Lets repository, Builder, or later Source adapters provide the implementation without creating another product identity.
