---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Realtime voice acts on requests instead of declining them and says what it is doing. The spoken GPT-Live model now gets its own instructions to delegate every lookup, web search, navigation, or change to the tool model, to name each action before it runs, and to mention a slow step instead of going quiet; the tool model keeps the app context. `web-search` and `web-request` load with each session. Apps can set `realtimeVoice` on `createAgentChatPlugin` to add voice guidance, preload their main edit tools (kept through tool discoveries), and choose a default intelligence that applies until the user picks one. On GPT-Live, Balanced now raises the tool model to medium reasoning and Deep to high. Each voice turn reports a `realtime_voice_turn` event with speech-to-first-audio time, tool call counts, and whether the user spoke again within 10 seconds of an edit, with no transcript text.
