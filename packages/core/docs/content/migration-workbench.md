---
title: "Migrating to Agent-Native (/migrate)"
description: "Migration is a built-in /migrate goal in the Agent-Native Code workspace — not a separate app. See Agent-Native Code UI for the full guide."
---

# Migrating to Agent-Native (/migrate)

Migration is **not a separate product or template** — it is the built-in
`/migrate` goal inside the [Agent-Native Code](/docs/code-agents-ui) workspace.
It runs as a normal Code session you can resume, attach to, inspect, and stop.

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus dashboard"
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app   # shortcut into the same goal
```

The full guide — input shapes (path / URL / description), `--emit` dossiers,
Plan vs Auto mode, run controls, credentials, Desktop deep links, and the
`@agent-native/migrate` package exports — lives in
[Agent-Native Code UI → Migrating to Agent-Native](/docs/code-agents-ui#migrate).

> [!NOTE]
> The legacy hidden `migration` detail app has been removed. Use the Code
> workspace, the Desktop Code tab, or an emitted dossier as the supported
> surfaces.
