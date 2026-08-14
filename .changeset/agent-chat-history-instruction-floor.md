---
"@agent-native/core": patch
---

Keep the user's own messages in agent chat history when a tool-heavy turn is large. The request history was priced against one 64,000-char budget spent newest-first, so a single read-heavy assistant turn could evict every earlier thing the user asked for — in one measured production thread the model saw none of the user's previous nine asks and re-derived the same answer each turn. Tool payloads and user messages now draw on separate budgets, and an oversized recent turn no longer drops the cheaper messages behind it.
