# Harnesses

Agent-native apps run inside a **harness** — a host environment that provides the AI agent and displays the app UI side by side.

## Claude Code Harness (Local)

- Open source, ships with `@agent-native/harness-claude-code`
- Runs locally — xterm.js terminal on the left, your app iframe on the right
- Powered by Claude Code CLI via a real PTY (node-pty)
- Settings panel for launch flags (`--dangerously-skip-permissions`, `--resume`, `--verbose`, custom flags)
- Restart button to relaunch with new settings
- Auto-detects when Claude finishes generating and notifies the app
- Best for: solo development, local testing, open-source projects

Quick start:

```bash
# In your agent-native monorepo
pnpm dev:harness
```

## Builder Harness (Cloud)

- Provided by Builder.io — available at builder.io
- Runs locally or in the cloud
- Real-time collaboration — multiple users can watch/interact simultaneously
- Visual editing capabilities alongside the AI agent
- Parallel agent execution for faster iteration
- Best for: teams, production deployments, visual editing, real-time collaboration

## Feature Comparison

| Feature | Claude Code Harness | Builder Harness |
|---------|-------------------|-----------------|
| Local development | Yes | Yes |
| Cloud/remote | No | Yes |
| Real-time collaboration | No | Yes |
| Visual editing | No | Yes |
| Parallel agents | No | Yes |
| Agent chat bridge | Yes | Yes |
| File watcher (SSE) | Yes | Yes |
| Script system | Yes | Yes |
| Open source | Yes | No |

## How It Works

Both harnesses support the same core agent-native protocol:

1. **postMessage bridge** — app sends `builder.submitChat` messages up to the harness
2. **Chat running events** — harness sends `builder.fusion.chatRunning` events down to the app
3. **File watching** — SSE endpoint keeps UI in sync when the agent modifies files
4. **Script system** — `pnpm script <name>` dispatches to callable scripts

Your app code is identical regardless of which harness you use.
