---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Store the rendered HTML/text body of every transactional email send alongside the existing send-log record, and show it in the Dispatch send log detail dialog so an org admin can see exactly what was sent, not just the redacted provider request. Magic links, password-reset/verification links, JWT-shaped tokens, and OTP/verification codes are redacted from the body before it is persisted, since `email_log` is org-admin readable. The list query never returns bodies (fetched lazily per row via a new `get-email-log-body` action once a row is opened), and the sandboxed HTML preview now carries a restrictive CSP so a body can't load remote tracking images/styles.
