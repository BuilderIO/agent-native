---
"@agent-native/core": patch
---

Stop sending `temperature` on model requests that carry Claude thinking. Effort
defaults to High on every reasoning-capable Claude model, so internal callers
that asked only for `temperature: 0` — the Observational Memory compactor, eval
judges, sentiment inference — always got a 400 ("`temperature` may only be set
to 1 when thinking is enabled or in adaptive mode"). The Anthropic, AI SDK, and
Builder gateway engines now drop the sampling parameters when thinking is on or
when the model family removed them, and Observational Memory compaction runs at
low effort so thinking cannot consume its whole output budget.
