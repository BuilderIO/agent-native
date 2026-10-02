---
"@agent-native/core": patch
---

Report why agent runs fail. `agent_run_outcome` now carries a `cause` (one of `AGENT_TROUBLE_CAUSES`) or a normalized `error_message` for failed and interrupted runs. Normalizing replaces quoted text, emails, URLs, file paths, hostnames, and numbers or ids with placeholders; other words in a message can remain. Stopped runs are reported unsampled under their own per-page cap, thumbs-up or thumbs-down feedback sends `agent_feedback_submitted` with the browser session, and every pageview carries `agent_signals: 1` so Analytics counts cancelled runs and thumbs-down only for sessions whose client reports them.
