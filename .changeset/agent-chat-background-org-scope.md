---
"@agent-native/core": patch
---

Fix agent chat resolving a null org in cookieless durable background runs, which
made the agent see and write only `org_id IS NULL` rows while the UI (carrying
the session) used the real org. The agent could not list or read resources the
UI showed, and agent-created rows landed outside the user's org. The background
run already pre-seeds the owner from the run row; org resolution now falls back
to `resolveOrgIdForEmail(owner)` when there is no session, so the agent and the
UI scope to the same org-shared data.
