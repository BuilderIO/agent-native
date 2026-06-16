---
"@agent-native/core": patch
---

Retry a transient 404 from `create-visual-recap` when publishing a PR visual
recap. The recap CLI ships to npm independently of the plan-app server, so a
recap can run after the new CLI is live but before the matching action route has
fully propagated to every (cold-start) server instance. A bounded retry now
rides through that deploy-propagation window instead of failing the recap.
