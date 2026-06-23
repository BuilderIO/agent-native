# Agent Native Package Lookup For Agents

The version-matched docs and source corpus are bundled with
`@agent-native/core` and installed at:

```txt
node_modules/@agent-native/core/docs
node_modules/@agent-native/core/corpus
```

Use these version-matched markdown docs before coding against Agent Native
framework APIs or advanced features. Use the source corpus when you need import
examples, implementation details, or first-party template patterns to replicate.
Public docs are useful for browsing, but the package docs and corpus match the
exact framework version installed in the app.

## Fast Lookup

From a generated app root:

```bash
pnpm action docs-search --list
pnpm action docs-search --query "actions"
pnpm action docs-search --slug actions
pnpm action source-search --list
pnpm action source-search --query "defineAction useActionQuery"
pnpm action source-search --path templates/plan/AGENTS.md
```

The built-in app agent also has read-only `docs-search` and `source-search`
tools with the same options.

If the action runner is unavailable, search the package files directly:

```bash
rg -n "actions|automations|a2a|sharing" node_modules/@agent-native/core/docs
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core/corpus
```

Then read the matching files under `node_modules/@agent-native/core/docs/content/`.
For source examples, read matching files under
`node_modules/@agent-native/core/corpus/core/` or
`node_modules/@agent-native/core/corpus/templates/`.

## What To Read First

| Task                                  | Start with                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Define or call app operations         | `content/actions.md`, `content/client.md`                                                                |
| Add SQL data, schema, or access rules | `content/database.md`, `content/security.md`, `content/sharing.md`                                       |
| Keep the UI and agent in sync         | `content/context-awareness.md`, `content/client.md`                                                      |
| Build headless or chat-first apps     | `content/pure-agent-apps.md`, `content/agent-surfaces.md`, `content/using-your-agent.md`                 |
| Add automations or scheduled work     | `content/automations.md`, `content/recurring-jobs.md`                                                    |
| Compose apps or call sibling agents   | `content/a2a-protocol.md`, `content/multi-app-workspace.md`, `content/workspace.md`                      |
| Expose tools to external agents       | `content/external-agents.md`, `content/mcp-protocol.md`, `content/mcp-apps.md`, `content/mcp-clients.md` |
| Add integrations, setup, or secrets   | `content/onboarding.md`, `content/workspace-connections.md`, `content/security.md`                       |
| Build extensions or custom widgets    | `content/extensions.md`, `content/agent-web-surfaces.md`                                                 |
| Deploy or configure hosting           | `content/deployment.md`, `content/server.md`                                                             |
| Write agent instructions or skills    | `content/skills-guide.md`, `content/writing-agent-instructions.md`                                       |

## Rules

- Prefer the app's own `AGENTS.md` and `.agents/skills/` for app-specific
  behavior. Use this package docs tree for framework APIs and the package
  corpus for framework/template patterns.
- If local instructions and package docs conflict, local app instructions win
  for that app, but verify the framework API shape in package docs or types.
- Do not invent Agent Native APIs. Search these docs and installed type
  definitions before adding imports, routes, actions, or framework config.
