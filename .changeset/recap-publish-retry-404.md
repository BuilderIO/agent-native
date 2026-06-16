---
"@agent-native/core": patch
---

Make PR visual recap robust to plan-app deploy-propagation windows. The recap
CLI ships to npm independently of the plan-app server, so a recap can run after
the new CLI is live but before the matching action routes have propagated to
every cold-start server instance:

- `create-visual-recap` publish now retries a transient 404 (the route 404s on a
  not-yet-updated instance) instead of failing the recap outright.
- The live block-reference fetch (`get-plan-blocks`) now retries transient
  404s/timeouts before falling back to bundled instructions, so the agent
  authors against the current block vocabulary instead of stale tags.
