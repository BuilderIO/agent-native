---
"@agent-native/core": patch
---

Stop four more plugin-init table bootstraps from hanging later requests on
Cloudflare Workers. `ensureAuditTables`, `ensureExtensionsTables`,
`ensureSlotTables`, and `ensureDataProgramTables` are fired and forgotten at
plugin-init time, where their DDL can never settle on workerd; the module-scope
memo then handed that dead promise to every later caller. The first
authenticated write — `create-design`, for instance — hung forever with no
error. All four now use `createInitMemo`.
