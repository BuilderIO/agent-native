# Agent Native Plans for VS Code

Open Agent-Native Plans and handoff links inside VS Code.

## Install

Install
[Agent Native Plans](https://marketplace.visualstudio.com/items?itemName=Builder.agent-native)
from the Visual Studio Marketplace, or run:

```bash
code --install-extension Builder.agent-native
```

## Commands

- **Agent Native: Open Agent Native** opens the configured default app.
- **Agent Native: Open Agent Native URL** opens any `http(s)` Agent Native app
  URL or `vscode://builder.agent-native/open?url=...` handoff link.
- **Agent Native: Connect Workspace to Agent Native MCP** runs the existing
  `@agent-native/core` connect flow for VS Code / GitHub Copilot MCP.

## Handoff URL

External agents can open a focused Agent Native app view with:

```text
vscode://builder.agent-native/open?url=https%3A%2F%2Fplan.agent-native.com
```

The embedded URL must be `http` or `https`.

## Development

```bash
pnpm --filter agent-native build
pnpm --filter agent-native test
pnpm --filter agent-native test:e2e
```
