---
record_type: "feature"
id: "content.feature.when-this-happens-that-follows"
number: 17
name: "When this happens, that follows"
chapter: "content.chapter.working-systems"
order: 17
roadmap_status: "partially_implemented"
summary: "React to committed Events with visible, governed Actions, retries, notifications, and receipts."
example_workflow: "When a qualified lead enters a Database, a Rule assigns the owner, asks an agent for a bounded summary, sends the right notification, and leaves one receipt showing every action and retry."
works_today: "Shared Actions, audit history, a framework scheduler, notifications, Automations, provider effects, and active Event and Rule work already cover much of the execution substrate."
remains: "Content needs one durable Event spine and Rule model with atomic claims, retries, idempotency, agent effects, notification routing, receipts, and a humane inspection surface."
required_capabilities:
  [
    "content.event.committed",
    "content.rule.deterministic",
    "content.agent.action-parity",
  ]
enhancing_capabilities:
  [
    "content.automation.scheduled",
    "content.action.button",
    "content.agent.automation",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 17: When this happens, that follows

React to committed Events with visible, governed Actions, retries, notifications, and receipts.

## Product contract

- **Events:** Provide atomic facts about what committed, who or what caused it, and which objects changed.
- **Rules:** Match typed conditions after commit without becoming a second expression or permission engine.
- **Actions:** Invoke the same operations available to the interface and agents.
- **Schedules and heartbeats:** Use the framework's single scheduler for time-based conditions and missed-run policy.
- **Buttons:** Give owners an explicit interface for invoking governed Actions with known inputs and consequences.
- **Agent effects:** Delegate bounded work without granting the Rule more authority than its actor or policy permits.
- **Receipts and retries:** Preserve exactly-once claims, crash recovery, honest skips, and queryable outcomes.
