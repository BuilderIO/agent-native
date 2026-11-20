---
"@agent-native/core": patch
---

Keep the model's original draft when a final-response guard's retry fails. A guard that sets `exhaustedDraftPrefix` now shows the earlier draft with that label when the retry returns an empty response, throws a provider error, or ends with an empty draft. After a provider error the normal error still follows the draft, except for a rejected request (`invalid_request`), which ends with the draft alone. An error the turn continues from (timeouts, 5xx, throttling) shows no draft, so the continuation does not repeat it. The failure is recorded on the run as an `agent-native.response-guard` rich event. `read-attachment` failures now also return an `errorCode` (`attachment_not_stored`, `attachment_reread_failed`, `attachment_read_failed`); the `error` text is unchanged.

A request the provider read none of (`request_not_read`, usually too many or too complex tool definitions) is now treated as a rejected request: it is not resent, a kept draft is shown alone, and the chat explains that the request was too large or complex. The empty-response error no longer claims the output-token budget was the cause.
