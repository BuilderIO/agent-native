---
"@agent-native/core": patch
---

Keep the model's original draft when a final-response guard's retry fails. A guard that sets `exhaustedDraftPrefix` now shows the earlier draft with that label, instead of an error, when the retry returns an empty response, throws a provider error, or ends with an empty draft. Errors the user must act on (missing credentials, credits limits, rate limits, authorization, context length) still show their error after the draft. The failure is recorded on the run as an `agent-native.response-guard` rich event. `read-attachment` failures now also return an `errorCode` (`attachment_not_stored`, `attachment_reread_failed`, `attachment_read_failed`); the `error` text is unchanged.
