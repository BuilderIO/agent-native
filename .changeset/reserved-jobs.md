---
"@agent-native/core": minor
---

Add `registerReservedJob({ name, reason })` so templates with native cron loops (e.g. `server/plugins/sequencer-jobs.ts`) can reserve job names. Both `manage-jobs.create` and `manage-automations.define` consult the registry and refuse to create matching `jobs/*.md` resources, surfacing `reason` back to the agent. Prevents agents from accidentally duplicating native background loops as agentic automations (each `runAgentLoop` tick costs LLM credits even when the loop has nothing to do).

```ts
import { registerReservedJob } from "@agent-native/core/jobs";

registerReservedJob({
  name: /^send-due-steps$|^check-replies$/,
  reason:
    "Native cron runs these every 60s in server/plugins/sequencer-jobs.ts.",
});
```
