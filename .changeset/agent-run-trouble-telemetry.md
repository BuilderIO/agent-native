---
"@agent-native/core": patch
---

Report why agent runs fail. `agent_run_outcome` now carries a `cause` (one of `AGENT_TROUBLE_CAUSES`) or a normalized `error_message` for failed and interrupted runs, stopped runs are reported unsampled, and thumbs-up or thumbs-down feedback sends `agent_feedback_submitted` with the browser session.
