---
"@agent-native/core": minor
---

Audit rows now record which MCP client made a call and the authorization signal associated with it. `reportedClientName` and `reportedClientVersion` hold the client's self-reported `clientInfo`, `oauthClientId` holds the OAuth client its credential was issued to, and `approval` (`agent-chat` or `mcp-client-accepted`) records the signal for that exact call. `agent-chat` records a person's approval in agent chat; `mcp-client-accepted` records that the MCP client accepted its elicitation, which does not verify who responded. The new columns are nullable, older rows are not rewritten, and CSV and OCSF exports include the new fields. CSV exports also prefix formula-like values in every column with an apostrophe before escaping to reduce spreadsheet formula execution risk.
