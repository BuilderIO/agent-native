---
record_type: "feature"
id: "content.feature.collect-structured-input"
number: 21
name: "Collect structured input"
chapter: "content.chapter.working-systems"
order: 21
roadmap_status: "in_validation"
summary: "Build Forms over the same schema, validation, and submission Actions as the Database they populate."
example_workflow: "A research team publishes an intake Form that validates required fields, lets an external participant submit without reading the Database, creates exactly one record, and triggers the Database's enrichment Rule."
works_today: "Content already has a Form View, ordered and required questions, schema-backed controls, and an atomic Action that creates and verifies an ordinary Database record."
remains: "Content and Agent Native Forms need one shared engine, with polished public submission, richer validation, conditional behavior, permissions, spam protection, receipts, and dependable downstream Rule handoff."
required_capabilities:
  [
    "content.form.shared-engine",
    "content.property.constraints",
    "content.agent.action-parity",
    "content.event.committed",
  ]
enhancing_capabilities: ["content.rule.deterministic", "content.job.durable"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 21: Collect structured input

Build Forms over the same schema, validation, and submission Actions as the Database they populate.

## Product contract

- **Form View:** Saves field selection, order, presentation, and submission behavior over one Database.
- **Shared schema:** Reuses the same Property types and validation as Agent Native Forms and ordinary record editing.
- **Conditional fields:** Shows or requires inputs through the typed expression language rather than custom form-only logic.
- **Submission grants:** Allow a person to submit without silently granting broad access to the underlying Database.
- **Idempotent submission:** Prevents duplicate records when a request retries or returns ambiguously.
- **Receipts:** Records the submitted values, actor, resulting Page, and downstream Actions the submitter may inspect.
