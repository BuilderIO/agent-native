---
"@agent-native/core": patch
---

Scope the `recordUsage` refId replacement delete to the recording owner. A
caller-supplied `refId` is not globally unique, so re-recording a run could
delete another user's usage row for the same label and refId, silently removing
their spend and call counts from usage metrics.
