---
"@agent-native/core": patch
---

The extension SQL routes refuse `sandbox_executions`, `automation_runs` and `agent_instruction_updates` with a 403, as they already did for the other trace and feedback tables. Before, the request reached the raw database tools, which refuse these tables but report that as output text with a 200 response.
