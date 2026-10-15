---
"@agent-native/core": patch
---

Add the recorder: every app keeps a short, redacted, in-memory record of its recent actions, `application_state` writes, route changes, errors, and error toasts, and can turn it into a report. Import `recorder` and `configureRecorder` from `@agent-native/core/client/recorder` to add events, watch values, send reports to a destination, or turn it off. Apps with browser Sentry get the recent events as breadcrumbs and a `recorder.json` attachment on each error.
