---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/agentkit": patch
---

Never persist inline image or file bytes in chat storage: thread snapshots, queued messages, run events and dispatch payloads keep a durable URL or an explicit omitted marker instead of `data:` URLs. Chat now reports typed, localized upload and attachment errors (including a "Retry without attachment" action for provider-rejected files), replays earlier attachments and the original ask in long threads, keeps a provider ownership check from failing on one unreachable provider, marks interrupted tool results as unknown-outcome errors, and no longer records experiment assignments when a model was chosen explicitly.
