---
"@agent-native/core": minor
---

Add a local Context X-Ray skill installer that writes a turnkey context-xray
command, Codex/Claude skill instructions, and slash-command prompts for
visualizing local coding-agent context usage.

Project-scoped installs now stay in project `.agents` artifacts, Codex session
analysis honors `--project`, `--open` uses a local HTML file instead of a
detached server, and Windows installs get a native command launcher.
