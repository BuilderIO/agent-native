---
"@agent-native/core": patch
---

Add `callActionWithRetry` for imperative client reads whose failure the UI has
to render as a state. It applies the same transient-failure budget
`useActionQuery` already uses, so a gateway blip against a cold backend no
longer settles a page on an error over data that is about to arrive, while a
deterministic refusal (400/403/404/409/500) and a timeout still surface on the
first attempt.
