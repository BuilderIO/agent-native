---
"@agent-native/core": patch
---

Name agent traces by what started them. Background automation runs now emit `background_automation_run:<job name>` as their span name (plus a `run_label` property carrying `recurring-job:` / `manual-automation:` / `automation:`), and a chat turn that sets `usageLabel` emits `agent_run:<label>` instead of a bare `agent_run`.

`sendToAgentChat` accepts a `usageLabel`, which rides the submit payload through the composer and the chat request body to that label.
