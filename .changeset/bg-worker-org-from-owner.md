---
"@agent-native/core": patch
---

fix(agent): resolve the org from the owner email for the cookieless durable background worker. The worker has the run owner (seeded via OWNER_CONTEXT_KEY) but no session, so getSession()/getOrgContext() left orgId null — engine resolution then couldn't find the owner's org-scoped Builder credential and fell back to the anthropic default, bailing on the missing key before the worker claimed its run. invokeAgentChatHandler now falls back to resolveOrgIdForEmail(owner) when there's no session org, so the worker resolves the same engine/credential the foreground does.
