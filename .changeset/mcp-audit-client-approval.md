---
"@agent-native/core": minor
---

Audit rows now record which MCP client made a call and whether a person approved it. `reportedClientName` and `reportedClientVersion` hold the client's self-reported `clientInfo`, `oauthClientId` holds the OAuth client its credential was issued to, and `approval` (`agent-chat` or `mcp-elicitation`) is set only when a person approved that exact call. The new columns are nullable, older rows are not rewritten, and CSV and OCSF exports include the new fields. CSV exports also prefix formula-like values in every column with an apostrophe before escaping to reduce spreadsheet formula execution risk.
