---
name: agent-native-docs
description: >-
  How to find version-matched Agent Native framework docs and source bundled in
  node_modules. Use before implementing or answering questions about
  @agent-native/core APIs, generated apps, workspaces, templates, or advanced
  features.
scope: dev
metadata:
  internal: true
---

# Agent Native Docs Lookup

## Rule

Before implementing or explaining non-trivial Agent Native behavior, read the
version-matched docs installed with `@agent-native/core`. When examples,
imports, or implementation details matter, inspect the packaged source corpus
too.

## Why

Generated apps and workspaces may be on a different framework version than the
public docs or model memory. The installed package is the source that matches
the app in front of you. It also includes a source-only corpus of core and
first-party templates so agents can replicate current best-practice patterns
without needing the framework monorepo checkout.

## How

From a generated app directory:

```bash
pnpm action docs-search --query "<feature>"
pnpm action docs-search --slug <slug>
pnpm action docs-search --list
pnpm action source-search --query "<pattern>"
pnpm action source-search --path templates/plan/AGENTS.md
pnpm action source-search --list
```

The headless `pnpm agent` loop and built-in app agent also expose a read-only
`docs-search` tool with the same `query`, `slug`, and `list` options, plus a
read-only `source-search` tool with `query`, `path`, and `list`.

If the action runner is unavailable, search the package directly:

```bash
rg -n "actions|automations|a2a|sharing" node_modules/@agent-native/core/docs
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core/corpus
```

Then read `node_modules/@agent-native/core/docs/AGENTS.md` or the matching file
under `node_modules/@agent-native/core/docs/content/`. For source examples,
read files under `node_modules/@agent-native/core/corpus/core/` or
`node_modules/@agent-native/core/corpus/templates/`.

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

- Do not rely on memory for framework APIs when package docs are present.
- Do not add custom REST wrappers for app data before reading `actions`.
- Do not add inline LLM calls before reading `using-your-agent` and
  `agent-surfaces`.
