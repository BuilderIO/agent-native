---
description: Visualize local Codex/Claude context usage and get optimization tips.
argument-hint: [current|threads|trends|--since 7d]
---

Run the local Context X-Ray analyzer and show the user the generated report link
plus the top warnings.

Use this command by default:

```sh
~/.agent-native/context-xray/context-xray --open $ARGUMENTS
```

If `$ARGUMENTS` is empty, analyze the current or most recent local thread. If
the user asks for a picker or all sessions, use `threads --open`. If they ask
for trends, use `trends --since 7d --open`.

`--open` opens a local HTML report file directly; there should not be a
long-running server process to monitor.

After the command finishes, summarize:

- the report link
- sessions analyzed
- the largest context bucket
- the most important warning
- two or three concrete ways to improve this thread
