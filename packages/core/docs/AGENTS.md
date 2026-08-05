# Agent Native Package Lookup For Agents

The version-matched docs and template corpus are bundled with
`@agent-native/core` and installed at:

```txt
node_modules/@agent-native/core/docs
node_modules/@agent-native/core/corpus
node_modules/@agent-native/core/dist
```

Use these version-matched markdown docs before coding against Agent Native
framework APIs or advanced features. Use the corpus when you need first-party
template patterns to replicate, and `dist/` (compiled sources plus `.d.ts`) when
you need the framework's own implementation details. Public docs are useful for
browsing, but the package docs, corpus, and `dist/` match the exact framework
version installed in the app.

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
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core/corpus
```

Then read the matching files under `node_modules/@agent-native/core/docs/content/`.
For template examples, read matching files under
`node_modules/@agent-native/core/corpus/templates/`. For framework internals,
read `node_modules/@agent-native/core/dist/` — the corpus carries templates
only, not a second copy of Core's own source.

Readable Toolkit TypeScript is available under
`node_modules/@agent-native/toolkit/src/`. Before adapting it, read the
generated app's `customizing-agent-native` skill. Treat installed source as a
read-only reference, copy only the smallest UI piece into app-owned source, and
preserve public action, state, auth, and agent-chat runtime contracts.

## What To Read First

| Task                                  | Start with                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Define or call app operations         | `content/actions.md`, `content/client.md`                                                                |
| Add SQL data, schema, or access rules | `content/database.md`, `content/security.md`, `content/sharing.md`                                       |
| Keep the UI and agent in sync         | `content/context-awareness.md`, `content/client.md`                                                      |
| Localize UI copy and language choices | `content/internationalization.md`, `content/client.md`                                                   |
| Build headless or chat-first apps     | `content/pure-agent-apps.md`, `content/agent-surfaces.md`, `content/using-your-agent.md`                 |
| Add automations or scheduled work     | `content/automations.md`, `content/recurring-jobs.md`                                                    |
| Compose apps or call sibling agents   | `content/a2a-protocol.md`, `content/multi-app-workspace.md`, `content/agent-resources.mdx`               |
| Expose tools to external agents       | `content/external-agents.md`, `content/mcp-protocol.md`, `content/mcp-apps.md`, `content/mcp-clients.md` |
| Add integrations, setup, or secrets   | `content/onboarding.md`, `content/workspace-connections.md`, `content/security.md`                       |
| Build extensions or custom widgets    | `content/extensions.md`, `content/agent-web-surfaces.md`                                                 |
| Deploy or configure hosting           | `content/deployment.md`, `content/server.md`                                                             |
| Write agent instructions or skills    | `content/skills-guide.md`, `content/writing-agent-instructions.md`                                       |

## Rules

- Prefer the app's own `AGENTS.md` and `.agents/skills/` for app-specific
  behavior. Use this package docs tree for framework APIs and the package
  corpus for first-party template patterns.
- If local instructions and package docs conflict, local app instructions win
  for that app, but verify the framework API shape in package docs or types.
- Do not invent Agent Native APIs. Search these docs and installed type
  definitions before adding imports, routes, actions, or framework config.
