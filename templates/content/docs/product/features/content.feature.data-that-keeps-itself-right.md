---
record_type: "feature"
id: "content.feature.data-that-keeps-itself-right"
number: 13
name: "Data that keeps itself right"
chapter: "content.chapter.working-systems"
order: 13
roadmap_status: "partially_implemented"
summary: "Use typed defaults, formulas, validation, and rendering so ordinary data stays consistent."
example_workflow: "An operations lead creates a request Database whose defaults fill the creator and timestamp, formulas calculate cost, validation rejects an impossible quantity, and a guarded budget change explains its consequences before committing."
works_today: "Content has a broad typed Property system, formulas and computed fields, editable values, form-required fields, audit fields, and several useful validation donors."
remains: "Defaults, formulas, validation, conditional rendering, guarded changes, typed errors, and time semantics need one expression language and one coherent configuration surface across every Property type."
required_capabilities:
  [
    "content.property.typed",
    "content.property.constraints",
    "content.property.guarded-change",
    "content.expression.language",
    "content.time.types",
  ]
enhancing_capabilities:
  [
    "content.view.dynamic-create",
    "content.property.actor",
    "content.expression.cached-result",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 13: Data that keeps itself right

Use typed defaults, formulas, validation, and rendering so ordinary data stays consistent.

## Product contract

- **Typed Properties:** Give text, numbers, choices, dates, people, relationships, files, and rich Blocks explicit behavior.
- **Creation defaults:** Evaluate one-time typed Expressions inside the successful creation transaction.
- **Formulas:** Derive live values from the current row and related data without storing a second truth.
- **Validation:** Reject invalid values consistently across the interface, Actions, API, agents, imports, and Forms.
- **Safeguards:** Add customizable consequence text, confirmation, approval, or conditional authority before sensitive changes commit.
- **Typed errors:** Keep null, error, unavailable, and stale cached values distinct and understandable.
- **Time semantics:** Separate Dates from timezone-aware Instants and quarantine ambiguous legacy floating times honestly.
