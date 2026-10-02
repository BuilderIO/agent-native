---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A prompt refused for missing AI setup now keeps what its retry needs (references, model, engine, effort, request mode) and a refusal marker in the thread, so the setup card finds it after a reload; the server lets only one tab send the after-setup resend of a refused run. The composer's `onBeforeSubmit` receives the draft it is holding and the handle gains `getDraftSnapshot()`, so a host resumes only a draft that was not edited while connecting. An unreadable provider 403 during a key check is retryable instead of a rejected key, and a misconfigured Builder host is no longer reported as a credit-service outage.
