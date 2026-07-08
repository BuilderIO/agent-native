---
"@agent-native/core": patch
---

Fix "The model returned an empty response" on hard/long-context chat turns: interactive chat now resolves max_output_tokens to min(model ceiling, 32K) instead of the flat 4096-8192 per-engine defaults, Anthropic/Gemini numeric thinking budgets are clamped to always leave real output headroom under max_tokens, and the empty-final-response retry now raises the token ceiling and steps reasoning effort down a tier (with the retry budget raised from 1 to 2 attempts) instead of re-issuing the identical doomed request.
