---
title: "Frames"
description: "Embedded agent panel and cloud frame options for running AI agents alongside your app."
---

# Frames

Agent-native apps run with an AI agent alongside the app UI. Locally, the agent panel is embedded directly in your app. In the cloud, Builder.io provides a managed frame with collaboration and visual editing.

## Embedded Agent Panel {#embedded-agent}

- Ships with `@agent-native/core` — no separate package needed
- Agent panel embedded directly in your app with chat and optional CLI terminal
- Supports multiple AI coding CLIs — switch between them from the settings panel
- Toggle between production mode (app tools only) and development mode (full filesystem, shell, and database access)
- Great for local development, self-hosted production, and OSS

## Supported CLIs {#supported-clis}

| CLI         | Command    | Key Flags                                           |
| ----------- | ---------- | --------------------------------------------------- |
| Claude Code | `claude`   | --dangerously-skip-permissions, --resume, --verbose |
| Codex       | `codex`    | --full-auto, --quiet                                |
| Gemini CLI  | `gemini`   | --sandbox                                           |
| OpenCode    | `opencode` | —                                                   |
| Builder.io  | `builder`  | —                                                   |

Switch between CLIs at any time from the agent panel settings. The terminal restarts with the selected CLI.

## [Builder.io Cloud](https://www.builder.io) {#cloud-frame}

- Runs in the cloud
- Real-time collaboration — multiple users can watch/interact simultaneously
- Visual editing, roles and permissions
- Parallel agent execution for faster iteration
- Great for team use

## How It Works {#how-it-works}

The framework provides type-safe APIs so you never deal with raw messaging:

1. **Agent chat** — use `sendToAgentChat()` to send messages to the agent
2. **Generation state** — use `useAgentChatGenerating()` to track when the agent is running
3. **Polling sync** — database-backed sync keeps UI caches fresh when the agent changes state
4. **Action system** — `pnpm action <name>` dispatches to callable actions

Your app code is identical regardless of how the agent is provided.
