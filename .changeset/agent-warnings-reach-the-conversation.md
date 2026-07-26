---
"@agent-native/core": patch
---

Risky operations now warn the agent in the conversation instead of only the
server console. A new `warnAgent()` channel lets a helper deep inside an action's
call stack — `setActiveOrgId`, `createOrganization` — raise a warning without
access to the action's `ctx`; the agent loop drains it after the tool call and
appends tagged `<agent-warning>` blocks to that tool's result, so it reaches the
model's context, the transcript, and the ledger in one write. A framework core
prompt rule requires the agent to relay a critical warning to the user before
reporting success. Outside an agent run (CLI, migration script, boot) warnings
still go to the console. Also fixes `createOrganization` silently treating an
unreadable membership probe as "this account had no other organization".
