---
record_type: "feature"
id: "content.feature.put-your-organizations-know-how-to-work"
number: 15
name: "Put your organization's know-how to work"
chapter: "content.chapter.working-systems"
order: 15
roadmap_status: "planned"
summary: "Govern reusable Skills so the agent offers the right instructions for the current person and object."
example_workflow: "A writer selects a paragraph and opens Ask Agent; Content prioritizes the organization's approved voice-and-style Skill, explains that it will propose a replacement, and records the resulting edits when invoked."
works_today: "The Agent Native framework already loads governed developer Skills, and Content provides selection context and the shared Agent chat for carrying out authorized work."
remains: "Content needs a user-manageable Skills catalog, scope and compatibility rules, contextual discovery, specific-over-general ranking, clear mutation previews, and shared invocation for people and agents."
required_capabilities:
  [
    "content.expression.catalog",
    "content.agent.skill-catalog",
    "content.agent.expression-authoring",
  ]
enhancing_capabilities:
  ["content.template.governance", "content.command.fabric"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 15: Put your organization's know-how to work

Govern reusable Skills so the agent offers the right instructions for the current person and object.

## Product contract

- **Skills catalog:** Stores governed instructions with personal, workspace, organization, or public-core scope.
- **Compatibility:** Surfaces only Skills that apply to the current selection, Block, Page, Database, Property, or View.
- **Scope precedence:** Ranks the most relevant allowed instruction without flooding the interface with the entire catalog.
- **Declared effects:** Explains whether invocation proposes edits, replaces content, adds a Comment, or acts elsewhere.
- **Shared invocation:** Lets people and agents use the same Skill through the ordinary Agent chat and Action fabric.
- **Receipts:** Records what instruction ran, against which context, with which resulting actions.
