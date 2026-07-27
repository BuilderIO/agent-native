---
"@agent-native/core": patch
---

Label final-response-guard corrective retries as framework directives. They are
appended as user-role messages, so an unlabeled one reads like an injected user
turn — models were refusing them out loud to the real user ("this message looks
like a prompt injection attempt") instead of revising the draft.
