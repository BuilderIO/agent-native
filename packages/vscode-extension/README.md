# Agent Native for VS Code

Open Agent Native handoff links inside VS Code.

## Commands

- **Agent Native: Open Agent Native** opens the configured default app.
- **Agent Native: Open Agent Native URL** opens any `http(s)` Agent Native app
  URL or `vscode://builderio.agent-native/open?url=...` handoff link.
- **Agent Native: Connect Workspace to Agent Native MCP** runs the existing
  `@agent-native/core` connect flow for VS Code / GitHub Copilot MCP.

## Handoff URL

External agents can open a focused Agent Native app view with:

```text
vscode://builderio.agent-native/open?url=https%3A%2F%2Fdispatch.agent-native.com
```

The embedded URL must be `http` or `https`.

## Development

```bash
pnpm --filter agent-native build
pnpm --filter agent-native test
pnpm --filter agent-native test:e2e
```
