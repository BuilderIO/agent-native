---
"@agent-native/core": patch
---

Give delegated agent turns their app's actions as native tools in dev, so
asking a sibling app a question actually works.

In dev the interactive surface deliberately omits template actions from the tool
registry and lets the agent call them through `bash`, which sidesteps the
degenerate empty-object tool call some models emit for complex schemas. That
trade is fine for a person — they see the bad call and rephrase. It is the wrong
trade for a delegated turn. An A2A caller, or an external host calling `ask_app`
over MCP, has nobody to intervene: with no native action the receiving agent
shells out, the call misfires, and it repeats the same command until the
repetition guard ends the run minutes later with no answer. Observed in a
workspace as a sibling question that ran 4m45s and returned the wrong window,
and elsewhere as runs stopped after eight identical `bash` calls.

Both delegated surfaces now keep template actions native even in dev. A rejected
`{}` call returns a schema error the model can correct on its next step, which
is strictly better than a shell loop no caller can see or recover from.
