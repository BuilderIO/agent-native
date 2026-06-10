---
"@agent-native/core": patch
---

Add a framework-level `core-send-email` agent tool (registered in every template when RESEND_API_KEY or SENDGRID_API_KEY is set) that sends markdown-body emails via the core transport. The tool description enforces a draft-first safety rule so the agent always shows the email to the user before sending. Keyed `core-send-email` to avoid colliding with the mail template's richer `send-email` action.
