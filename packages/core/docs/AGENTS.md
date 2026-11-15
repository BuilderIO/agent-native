# Agent-Native Package Lookup For Agents

Version-matched framework docs ship with `@agent-native/core`. The first-party
template corpus is a separate opt-in package; install it at the same version as
Core when template examples are needed:

```txt
node_modules/@agent-native/core/docs
node_modules/@agent-native/core-corpus/corpus
node_modules/@agent-native/core/dist
```

```bash
pnpm add -D @agent-native/core-corpus@<installed-core-version>
```

Use these version-matched markdown docs before coding against Agent-Native
framework APIs or advanced features. Use the corpus when you need first-party
template patterns to replicate, and `dist/` (compiled sources plus `.d.ts`) when
you need the framework's own implementation details. Public docs are useful for
browsing, but the package docs, corpus, and `dist/` match the exact framework
version installed in the app. Source-search continues to cover readable Core
and Toolkit code without the corpus package, and prints this install hint when
template source is unavailable.

## Fast Lookup

From a generated app root:

```bash
pnpm action framework-search --pattern "defineAction"
pnpm action framework-search --pattern "templates/*/actions/*.ts" --mode glob --scope source
pnpm action framework-search --pattern "Agent(?:Panel|Sidebar)" --mode regex --scope source
pnpm action docs-search --list
pnpm action docs-search --query "actions"
pnpm action docs-search --slug actions
pnpm action source-search --list
pnpm action source-search --query "defineAction useActionQuery"
pnpm action source-search --path templates/plan/AGENTS.md
pnpm action source-search --path templates/chat/actions/hello.ts
```

The built-in app agent also has a read-only `framework-search` tool for one
bounded search across docs and readable Core, Toolkit, and first-party
template source. Use `docs-search` and `source-search` for focused reads after
it identifies the relevant page or file.

If the action runner is unavailable, search the package files directly:

```bash
rg -n "actions|automations|a2a|sharing" node_modules/@agent-native/core/docs
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core-corpus/corpus
```

Then read the matching files under `node_modules/@agent-native/core/docs/content/`.
For template examples, read matching files under
`node_modules/@agent-native/core-corpus/corpus/templates/`. For framework internals,
read `node_modules/@agent-native/core/dist/` — the corpus carries templates
only, not a second copy of Core's own source.

Readable Toolkit TypeScript is available under
`node_modules/@agent-native/toolkit/src/`. Before adapting it, read the
generated app's `customizing-agent-native` skill. Treat installed source as a
read-only reference, copy only the smallest UI piece into app-owned source, and
preserve public action, state, auth, and agent-chat runtime contracts.

## What To Read First

| Task                                         | Start with                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Define or call app operations                | `content/actions-overview.mdx`, `content/client-overview.mdx`                                                |
| Add PostgreSQL data, schema, or access rules | `content/server-database.mdx`, `content/security.mdx`, `content/sharing.mdx`                                 |
| Keep the UI and agent in sync                | `content/context-awareness.mdx`, `content/client-overview.mdx`                                               |
| Localize UI copy and language choices        | `content/internationalization.mdx`, `content/client-overview.mdx`                                            |
| Build headless or chat-first apps            | `content/pure-agent-apps.mdx`, `content/agent-surfaces.mdx`, `content/using-your-agent.mdx`                  |
| Add automations or scheduled work            | `content/automations.mdx`, `content/recurring-jobs.mdx`                                                      |
| Compose apps or call sibling agents          | `content/a2a-protocol.mdx`, `content/multi-app-workspace.mdx`, `content/agent-resources.mdx`                 |
| Expose tools to external agents              | `content/external-agents.mdx`, `content/mcp-protocol.mdx`, `content/mcp-apps.mdx`, `content/mcp-clients.mdx` |
| Add integrations, setup, or secrets          | `content/onboarding.mdx`, `content/workspace-connections.mdx`, `content/security.mdx`                        |
| Build extensions or custom widgets           | `content/extensions.mdx`, `content/agent-web-surfaces.mdx`                                                   |
| Deploy or configure hosting                  | `content/deployment.mdx`, `content/server-overview.mdx`                                                      |
| Write agent instructions or skills           | `content/skills-guide.mdx`, `content/writing-agent-instructions.mdx`                                         |
| Plan a breaking package API change           | `migrations/README.md`                                                                                       |
| Migrate the Core chat API to AgentKit        | `migrations/agentkit-chat.md`, `content/native-chat-ui.mdx`                                                  |

## Rules

- Prefer the app's own `AGENTS.md` and `.agents/skills/` for app-specific
  behavior. Use this package docs tree for framework APIs and the package
  corpus for first-party template patterns.
- If local instructions and package docs conflict, local app instructions win
  for that app, but verify the framework API shape in package docs or types.
- Do not invent Agent-Native APIs. Search these docs and installed type
  definitions before adding imports, routes, actions, or framework config.
- For package API migrations, read the matching versioned guide under
  `node_modules/@agent-native/core/docs/migrations/` before changing imports or
  chat ownership.
