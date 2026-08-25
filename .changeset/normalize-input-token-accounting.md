---
"@agent-native/core": patch
"@agent-native/recap-cli": patch
---

Stop billing cached prompt tokens twice, and normalize what `inputTokens` means
across every engine.

Providers disagree: OpenAI's `prompt_tokens` includes cached tokens, Anthropic's
`input_tokens` excludes them. The `usage` event never said which it carried, so
both conventions reached `calculateCost`, which charged `inputTokens` at the
full input rate and then added `cacheReadTokens` / `cacheWriteTokens` on top.
On a long cached conversation the cache is nearly the whole prompt, so a turn
that cost $0.0054 was reported as $0.0478 — and every `token_usage` row for an
OpenAI-family model was inflated the same way.

- The `usage` event now documents one convention: `inputTokens` is the whole
  prompt and INCLUDES both cache counts, which are a slice of it rather than an
  addition. This matches the AI SDK's own `inputTokens.total` / `noCache` /
  `cacheRead` / `cacheWrite` normalization, and the Builder gateway.
- `anthropic-engine` was the only ENGINE reporting the exclusive form. It now
  adds the cache counts back, which also fixes its prompt size: a fully cached
  turn used to report ~3 input tokens instead of the real 42,438.
- `calculateCost` treats the three counts as a partition and prices each token
  exactly once. Callers with no prompt caching pass zeroes and are unaffected.

The recap CLI carried all three conventions at once and now shares this one:
`parseClaudeUsage` adds Anthropic's cache counts back into the prompt,
`parseCodexUsage` no longer strips OpenAI's cached tokens out of it (it did that
to compensate for the old pricing formula, so keeping both would have swung the
error the other way), and `parseOpenAiCompatibleUsage` was already correct.
