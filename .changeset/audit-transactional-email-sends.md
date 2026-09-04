---
"@agent-native/core": patch
"@agent-native/dispatch": minor
---

Add a durable audit trail for every transactional email send attempt. The shared `sendEmail()` transport now records the outbound request payload (with auth links and message bodies redacted) and the raw provider response/status for both successes and failures, so Dispatch can show exactly what was sent, to whom, and why a send failed. The `list-email-log` action gained filters for recipient, sender, status, provider, and date range with stable pagination, and a new searchable "Send log" section was added to `/admin/transactional-email`. Magic-link sign-in emails are now tagged with a `core.magic-link` template id so they show up alongside other auth emails in the catalog and send log.
