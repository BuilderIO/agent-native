---
"@agent-native/core": patch
---

When `ask_app_status` rejects a task handle as invalid or expired, the error now tells the caller how to keep polling the same task: call `ask_app_status` with the `app` and `taskId` from the `ask_app` result and no `taskHandle`, and don't resubmit `ask_app`, which can duplicate work. Before, the error gave no way forward once a handle expired, an hour after `ask_app` returned it. The MCP docs describe the same fallback, and a new report (`tools-list-size.perf.spec.ts`, run by hand) measures how many tokens each app's `tools/list` costs a connected model under read-only and read-and-write scopes.
