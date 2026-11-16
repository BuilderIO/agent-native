---
"@agent-native/core": patch
---

The agent's raw database tools (`db-query`, `db-exec`, `db-patch`) refuse `sandbox_executions`, `automation_runs`, `agent_trace_spans`, `agent_trace_summaries`, `agent_feedback` and `agent_instruction_updates`. Those tables were scoped to the organization only, so one member's agent could read, and change, another member's code runs, automation runs, traces and feedback.
