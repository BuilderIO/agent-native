---
"@agent-native/core": patch
---

Require a session on `POST /_agent-native/speak`, and bound the request before
it is parsed. The route previously enforced authentication only in production
and otherwise resolved `OPENAI_API_KEY` anonymously, so an unauthenticated
caller on any other deploy could spend its speech credits. It also parsed the
whole body before checking the script length, and never bounded `instructions`.
Callers that relied on anonymous synthesis now receive 401.
