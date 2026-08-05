---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Add a transactional email catalog.

Apps declare the transactional emails they send with `defineTransactionalEmail`
from `@agent-native/core/email-catalog`, giving each one a stable id, a
plain-language trigger, recipient and sender logic, and a preview rendered from
dummy data. Three actions (`list-transactional-emails`,
`render-transactional-email-preview`, `list-email-log`) mount into every app
automatically, so the catalog is readable without each app opting in.

`sendEmail` now accepts a `templateId`. It tags the message at the provider so
delivery and open metrics attribute to one email instead of the whole account,
and records every attempt — success and failure — to a new additive `email_log`
table, which keeps send counts and last-sent independent of the provider's short
activity retention window.

Dispatch gains a Transactional email screen listing every app's emails with
previews, send counts, open rates, and a per-message activity feed, plus a
read-only detail page per email. Metrics distinguish "not yet sent" from "could
not be read": an unreadable send log renders as unknown rather than zero, and an
unconfigured provider surfaces the reason instead of a 0% open rate.
