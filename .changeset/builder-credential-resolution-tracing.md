---
"@agent-native/core": patch
---

Builder credential resolution: implicit-org fallback + trace logging.

- `agent-chat-plugin`: when `session.orgId` is null (Better Auth leaves it null until the user explicitly switches orgs), fall back to `getOrgContext()` to pick up implicit org membership. A fresh signup with a domain-matched org now sees its org-scoped Builder credentials instead of looking unconnected.
- `resolveSecret`: log every Builder credential lookup (`[resolve-secret]` lines covering hit/miss + scope + email + orgId). "I connected Builder but chat says no LLM" reports can now be diagnosed from server logs without rerunning the request. Other keys are gated behind `DEBUG_CREDENTIAL_RESOLVE=1` to keep noise low.
- `core-routes-plugin` builder-connect: log the resolved write scope so we can see which scope (user/org/workspace) a connect actually persisted to.
