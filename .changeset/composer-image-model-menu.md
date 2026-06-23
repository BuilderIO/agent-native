---
"@agent-native/core": patch
---

Composer model picker improvements. The picker now supports an optional secondary "image model" menu via a new `imageModelMenu` prop on `AgentChatSurface` / `AssistantChat` (opt-in; chat-only apps are unaffected) — apps that drive a separate generation model (e.g. Assets' image model) can surface it in the same dropdown so it's clear which model reasons about the request and which produces the output. The reasoning-effort list is now a collapsed-by-default accordion (matching the provider groups) instead of always-expanded, keeping the menu compact. Model catalog: the Builder gateway list now lists Opus 4.8 (was 4.7) and drops the retired GPT-5.1 Codex Mini entry.
