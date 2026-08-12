---
"@agent-native/core": patch
---

Keep agent runs alive when the SQL abort state is briefly unreadable. A few consecutive failed abort-state reads (roughly 9s of database unreadability) used to self-abort the run with `aborted_abort_check_unavailable`, killing in-flight work the user was waiting on. The check now fails open and reports the outage to Sentry instead; the run stays bounded by the soft timeout, no-progress backstop, and iteration limits.
