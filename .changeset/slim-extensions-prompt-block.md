---
"@agent-native/core": patch
---

Cut the "Generative UI and Extensions" block in the in-app runtime agent's system prompt down to a short pointer. The removed prose (helper API list, `update-extension` operation contract, get-extension/list-extensions/legacy-`tools`-table guidance, the 7-row extension-vs-code-change routing table, and worked examples) already exists verbatim in the `render-inline-extension`/`create-extension`/`update-extension`/`connect-builder` tool descriptions, in `shared-rules.ts`'s single copy of the db-tools rule, and in the `extensions`/`generative-ui` skills — this only removes the duplicate copy from the prompt paid on every turn. Kept in place: the app-native-artifact-first rule, the "don't send existing extension edits to `connect-builder`" guardrail, and the extension-can't-reach-native-chrome boundary sentence, none of which have another home.

Full base prompt's extension block: ~7.7KB → ~1.8KB. Compact base prompt's extension block: ~4.2KB → ~1.6KB (the compact base prompt shrinks by about 2.5KB total, roughly 14% of its prior size).
