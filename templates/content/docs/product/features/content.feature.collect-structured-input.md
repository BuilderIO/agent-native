---
record_type: "feature"
id: "content.feature.collect-structured-input"
number: 21
name: "Collect structured input"
chapter: "content.chapter.working-systems"
order: 21
roadmap_status: "partially_implemented"
summary: "Build Forms over the same schema, validation, and submission Actions as the Collection they populate."
example_workflow: "A research team publishes an intake Form that validates required fields, lets an external participant submit without reading the Collection, creates exactly one record, and triggers the Collection's enrichment Rule."
works_today: "Content already has a Form View, ordered and required questions, schema-backed controls, and an atomic Action that creates and verifies an ordinary Collection record. Only people who can edit the Collection can submit."
remains: "Content needs its own public Form: a link people can answer anonymously or signed in without reading the Collection, answers saved as people type, idempotent submission with receipts, spam limits, one read-and-submit tool pair for agents, and dependable downstream Rule handoff. Conditional questions and an email confirmed by code follow that first version."
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
last_reviewed: "2026-11-23"
---

# Feature 21: Collect structured input

Build Forms over the same schema, validation, and submission Actions as the Collection they populate.

## Product contract

- **Form page:** A Form belongs to one Collection and is written as one editor Page, with question Blocks placed anywhere among headings, text, and media. Any Page can show the Form inline.
- **Questions are Properties:** Each question fills one Property. A new question creates its Property, named after the question's wording, and renaming the question renames the Property.
- **Shared schema:** Reuses the same Property types and validation as ordinary record editing, so a Form can ask for more than the Collection requires, never less.
- **Conditional fields:** After the first version, shows or requires inputs through the typed expression language rather than custom form-only logic.
- **Submission grants:** Allow a person to submit without silently granting broad access to the underlying Collection. Each Form says who is answering: anonymous, signed in (optionally limited to the organization), or, later, an email confirmed by a one-time code without an account.
- **Drafts:** Save answers as people type, apart from the Collection. A draft never becomes a record, so no record exists and no Rule runs until the person submits.
- **Idempotent submission:** Prevents duplicate records when a request retries or returns ambiguously.
- **Receipts:** Records the submitted values, actor, resulting Page, and downstream Actions the submitter may inspect. Every record says how its sender was known.
- **Agent form tools:** Any agent reads a Form from its link and submits through the same Action, with the same validation and receipt a person gets. One pair of tools serves every Form.
