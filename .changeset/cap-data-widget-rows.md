---
"@agent-native/core": patch
---

Stop `render-data-widget` from stalling on large result sets. The tool is a pure
echo — the model authors every row as tool-call arguments — so an uncapped table
cost minutes of argument decode before anything rendered, and a 211-row answer
was observed stalling for six minutes until the run heartbeat died. Rows are now
clamped server-side (50 table rows, 200 chart points) with the existing
`totalRows`/`sampledRows`/`truncated` flags set, and both the tool description
and the framework prompts state the ceiling instead of asking for "compact real
data" and forbidding markdown tables outright.
