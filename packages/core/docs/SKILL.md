---
name: agent-native-docs
description: "How to look up version-matched Agent Native framework docs in node_modules. Use before coding against @agent-native/core APIs or advanced features."
---

# Agent Native Docs Lookup

## Rule

Before implementing non-trivial Agent Native functionality, read the
version-matched docs installed with `@agent-native/core`.

## How

1. Start from the generated app root.
2. Search with `pnpm action docs-search --query "<feature>"`.
3. Read a specific page with `pnpm action docs-search --slug <slug>`.
4. If the action runner is unavailable, search
   `node_modules/@agent-native/core/docs` directly with `rg`.
5. For app-specific rules, also read the app's own `AGENTS.md` and any relevant
   `.agents/skills/<name>/SKILL.md`.

## Useful Slugs

| Need | Slugs |
| --- | --- |
| Actions and typed client calls | `actions`, `client` |
| SQL, auth, access, sharing | `database`, `authentication`, `security`, `sharing` |
| UI state visible to the agent | `context-awareness` |
| Headless and chat-first apps | `pure-agent-apps`, `agent-surfaces`, `using-your-agent` |
| Automations and schedules | `automations`, `recurring-jobs` |
| Cross-app and external agents | `a2a-protocol`, `external-agents`, `mcp-protocol`, `mcp-apps` |
| Skills and instructions | `skills-guide`, `writing-agent-instructions` |

## Don't

- Do not rely on memory for framework APIs when local package docs are present.
- Do not add custom REST wrappers for normal app data before reading `actions`.
- Do not add inline LLM calls before reading `using-your-agent` and
  `agent-surfaces`.
