---
"@agent-native/toolkit": patch
---

Dispatch an `agentNative.guidedQuestionsSubmitted` window event (`GUIDED_QUESTIONS_SUBMITTED_EVENT`) once per guided question submit whose `onSubmitMessage` resolves `{ delivered: true }`, so apps can observe answers without owning the flow.
