---
name: agent-native-docs
description: >-
  How to find version-matched Agent-Native framework docs and source bundled in
  node_modules. Use before implementing or answering questions about
  @agent-native/core APIs, generated apps, workspaces, templates, or advanced
  features.
scope: dev
metadata:
  internal: true
---

# Agent-Native Docs Lookup

## Rule

Before implementing or explaining non-trivial Agent-Native behavior, read the
version-matched docs installed with `@agent-native/core`. When examples,
imports, or implementation details matter, inspect the packaged source corpus
too.

## Why

Generated apps and workspaces may be on a different framework version than the
public docs or model memory. The installed package is the source that matches
the app in front of you. A version-matched `@agent-native/core-corpus` package
provides first-party template source when an app needs those examples, without
adding the corpus to every Core installation.

## How

From a generated app directory:

```bash
pnpm action framework-search --pattern "defineAction"
pnpm action framework-search \
  --pattern "defineAction" \
  --scope source \
  --path "templates/*/actions/*.ts"
pnpm action framework-search --pattern "Agent(?:Panel|Sidebar)" --mode regex --scope source
```

Use `framework-search` first when a question may cross the docs and source
boundary. It searches version-matched framework docs, runtime-visible skills,
readable Core or Toolkit package source, and first-party template source when
the optional corpus is installed, in one bounded read-only call. Use
`scope: docs` or `scope: source` to narrow it, then use the focused readers for
the page or file you need.

The headless `pnpm agent` loop and built-in app agents expose read-only
`framework-search`, `docs-search`, and `source-search` tools when Core's docs
scripts are bundled. The default substring mode is safest for ordinary
questions; use `glob` for wildcard paths, `sql-like` for `%` and `_` wildcards,
and `regex` for precise structural matches. Results are bounded, so refine the
pattern or path instead of treating a truncated result as exhaustive.

From a generated app directory, the lower-level readers remain available:

```bash
pnpm action docs-search --query "actions"
pnpm action docs-search --slug actions-defining
pnpm action docs-search --list
pnpm action source-search --query "defineAction"
pnpm action source-search --path templates/plan/AGENTS.md
pnpm action source-search --path templates/chat/actions/hello.ts
pnpm action source-search --list
```

If a search reports that the optional first-party template corpus is not
installed, add it at the same version as Core:

```bash
core_version=$(node -p 'require("./node_modules/@agent-native/core/package.json").version')
pnpm add -D "@agent-native/core-corpus@$core_version"
```

Use the unified tool for discovery, then the focused tools for full page or
file reads.

If the action runner is unavailable, search the package directly:

```bash
rg -n "actions|automations|a2a|sharing" node_modules/@agent-native/core/docs
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core-corpus/corpus
```

Then read `node_modules/@agent-native/core/docs/AGENTS.md` or the matching file
under `node_modules/@agent-native/core/docs/content/`. For template examples,
read files under `node_modules/@agent-native/core-corpus/corpus/templates/`. The corpus
carries templates only; for Core's own implementation read
`node_modules/@agent-native/core/dist/` (compiled sources plus `.d.ts`).

Toolkit ships readable TypeScript under
`node_modules/@agent-native/toolkit/src/`. Read
`customizing-agent-native` before taking ownership of a shared component: inspect package
source as a read-only reference, then configure, compose, or eject the smallest
supported unit into app-owned source. Preserve public actions, application
state, auth, and agent-chat runtime contracts. Never edit `node_modules` or
deep-import its private source. Manual copying is only the fallback described by
an unknown third-party package's add-style blueprint.

## Reuse Proven Patterns (rg + cp)

Version-matched installed source outranks web docs or memory: it is the exact
code shipping with this app. `node_modules/@agent-native/core-corpus/corpus/templates/`
holds source for every first-party template, not just the one this app started
from, so a pattern from the mail template is fair game for a tasks app. Grep
across it, then copy a whole file as a starting point instead of writing the
pattern from scratch:

```bash
# Find how other templates solved a similar problem
rg -n "drag.*drop|reorder" node_modules/@agent-native/core-corpus/corpus/templates

# Grab a proven action file as a starting point, then adapt names/schema
cp node_modules/@agent-native/core-corpus/corpus/templates/chat/actions/hello.ts \
   actions/greet.ts

# Read the framework's own implementation behind an API
rg -n "defineAction" node_modules/@agent-native/core/dist/action.js
```

Copying template-level app code (actions, components, skill files) is the
expected reuse path — templates exist to be forked. This is different from
copying `core`/`toolkit` **runtime internals**: for those, follow
`customizing-agent-native`'s configure/compose/eject ladder instead of
hand-duplicating framework logic.

## Useful Slugs

| Need                           | Slugs |
| ------------------------------ | ----- |
| Define and call actions        | `actions-overview`, `actions-defining`, `actions-advanced` |
| Typed client calls and data    | `client-overview`, `client-entry-points`, `client-data` |
| SQL, auth, access, sharing     | `postgres`, `server-database`, `authentication`, `security`, `sharing` |
| UI state visible to the agent  | `context-awareness` |
| Headless and chat-first apps   | `pure-agent-apps`, `agent-surfaces`, `using-your-agent` |
| Automations and schedules      | `automations`, `recurring-jobs` |
| Cross-app and external agents  | `a2a-protocol`, `external-agents`, `mcp-protocol`, `mcp-apps` |
| Skills and instructions        | `skills-guide`, `writing-agent-instructions` |

## Don't

- Do not rely on memory for framework APIs when package docs are present.
- Do not add custom REST wrappers for app data before reading
  `actions-overview` and `actions-defining`.
- Do not add inline LLM calls before reading `using-your-agent` and
  `agent-surfaces`.
- Do not copy framework runtime internals when a public API or narrow UI copy
  will do; read `customizing-agent-native` for the supported override ladder.

## Authoring visual docs blocks

Treat the shared `Diagram` block as a renderer, not as a reason to style every
docs UI as a sketch. Use the hand-drawn font and Rough.js only for actual
diagrams or wireframes that communicate structure, flow, or a design draft.
For polished UI-like content - cards, logo walls, tables, controls, or product
shells — set `renderMode="design"` (and usually `frame="hide"` when the block
is the content itself). Design mode preserves normal docs typography and
disables the Rough.js overlay. Keep `data-rough` only on elements intentionally
sketched inside a real diagram.
