---
"@agent-native/toolkit": patch
---

Dispatch an `agentNative.guidedQuestionsSubmitted` window event (`GUIDED_QUESTIONS_SUBMITTED_EVENT`) once per guided question submit whose delivery the flow's `onSubmitMessage` confirms, so apps can observe answers without owning the flow.
