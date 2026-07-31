---
"@agent-native/core": patch
---

Give delegated agent turns their app's actions as native tools in dev, so asking
a sibling app a question actually returns an answer.

In dev the interactive surface deliberately omits template actions from the tool
registry and lets the agent reach them through `bash`, which sidesteps the
degenerate empty-object tool call some models emit for complex schemas. That is
a reasonable trade for a person, who sees the bad call and rephrases. It is the
wrong trade for a delegated turn. An A2A caller, or an external host calling
`ask_app` over MCP, has nobody to intervene: with no native action the receiving
agent shells out, the call runs long, and the caller records "Interrupted before
this tool returned a result" — after which callers commonly fall back to
composing their own queries against a schema they do not own.

Both delegated surfaces now keep template actions native even in dev. A rejected
`{}` call returns a schema error the model can correct on its next step, which
is strictly better than a shell loop no caller can see or recover from.
