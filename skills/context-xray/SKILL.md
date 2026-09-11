---
name: context-xray
description: >-
  Visualize local Codex and Claude Code context usage, open a report, flag
  warnings, and suggest prompt/tooling optimizations.
metadata:
  visibility: exported
---

# Context X-Ray

Use Context X-Ray when a local coding-agent thread is getting large or the user
wants to understand where context is going.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add context-xray --client all
```

That installs a local `context-xray` command plus Codex/Claude skills and slash
commands. It does not need hosted auth or a remote MCP connector to read local
transcript files.

Use `--scope project` when you only want project `.agents` skill and command
artifacts added to the current repo.

## Run

Current or most recent local thread:

```bash
context-xray --open
```

Recent thread picker:

```bash
context-xray threads --open
```

Weekly trends:

```bash
context-xray trends --since 7d --open
```

`--open` opens the generated local HTML file directly in the browser; it does
not keep a background server running.

After running, summarize the report link, sessions analyzed, largest context
buckets, warnings, and concrete optimizations.
