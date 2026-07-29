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
pnpm action source-search --path toolkit/src/index.ts
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

Toolkit source is searchable at `toolkit/` in the Core corpus and also ships as
readable TypeScript under `node_modules/@agent-native/toolkit/src/`. Read
`customizing-agent-native` before taking ownership of a shared component: inspect package
source as a read-only reference, then configure, compose, or eject the smallest
supported unit into app-owned source. Preserve public actions, application
state, auth, and agent-chat runtime contracts. Never edit `node_modules` or
deep-import its private source. Manual copying is only the fallback described by
an unknown third-party package's add-style blueprint.

## Reuse Proven Patterns (rg + cp)

Version-matched installed source outranks web docs or memory: it is the exact
code shipping with this app. `node_modules/@agent-native/core/corpus/templates/`
holds source for every first-party template, not just the one this app started
from, so a pattern from the mail template is fair game for a tasks app. Grep
across it, then copy a whole file as a starting point instead of writing the
pattern from scratch:

```bash
# Find how other templates solved a similar problem
rg -n "drag.*drop|reorder" node_modules/@agent-native/core/corpus/templates

# Grab a proven action file as a starting point, then adapt names/schema
cp node_modules/@agent-native/core/corpus/templates/mail/actions/archive-email.ts \
   actions/archive-item.ts

# Read the full framework source behind an API, not just the corpus copy
rg -n "defineAction" node_modules/@agent-native/core/src/action.ts
```

Copying template-level app code (actions, components, skill files) is the
expected reuse path — templates exist to be forked. This is different from
copying `core`/`toolkit` **runtime internals**: for those, follow
`customizing-agent-native`'s configure/compose/eject ladder instead of
hand-duplicating framework logic.

## Useful Slugs

| Need                           | Slugs                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| Actions and typed client calls | `actions`, `client`                                           |
| SQL, auth, access, sharing     | `database`, `authentication`, `security`, `sharing`           |
| UI state visible to the agent  | `context-awareness`                                           |
| Headless and chat-first apps   | `pure-agent-apps`, `agent-surfaces`, `using-your-agent`       |
| Automations and schedules      | `automations`, `recurring-jobs`                               |
| Cross-app and external agents  | `a2a-protocol`, `external-agents`, `mcp-protocol`, `mcp-apps` |
| Skills and instructions        | `skills-guide`, `writing-agent-instructions`                  |

## Don't

- Do not rely on memory for framework APIs when package docs are present.
- Do not add custom REST wrappers for app data before reading `actions`.
- Do not add inline LLM calls before reading `using-your-agent` and
  `agent-surfaces`.
- Do not copy framework runtime internals when a public API or narrow UI copy
  will do; read `customizing-agent-native` for the supported override ladder.
