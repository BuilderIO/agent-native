---
"@agent-native/core": patch
---

Surface a visible "model returned an empty response" message when an engine ends a turn with reasoning-only content and zero output text (e.g. OpenAI gpt-5+ Responses runs where reasoning consumes the entire output-token budget). Previously the SSE stream finished cleanly with no text, producing a silent empty assistant bubble.
