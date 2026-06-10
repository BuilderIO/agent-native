---
title: "Frames"
description: "The local dev frame, the embedded agent panel, and the cloud frame — the ways an AI agent runs alongside your app."
---

# Frames

Every agent-native app runs with an AI agent next to the app UI. A **frame** is
the wrapper that hosts both: it shows your app and gives the agent a place to
chat, run, and (in dev) edit code. There are three frames, sharing one runtime:

- **Embedded agent panel** — ships inside every app from `@agent-native/core`.
  This is the sidebar your app renders itself, in development and in production.
- **Local dev frame** — a thin wrapper that loads your running app in an iframe
  and adds the same agent panel plus an integrated CLI terminal beside it. Used
  for local development of templates in this repo.
- **Builder.io cloud frame** — a managed, hosted frame with collaboration,
  visual editing, and parallel agent runs.

Your app code is identical regardless of which frame hosts it. The agent talks
to your app through the same actions and application state in every case.

## Embedded agent panel {#embedded-agent}

The embedded panel is the agent sidebar your app renders. It ships with
`@agent-native/core` — there is no separate package to install — and is the same
component in dev and prod.

- Exported as `AgentPanel` from `@agent-native/core/client`, with a
  production-only variant `ProductionAgentPanel`.
- Provides the full Chat / CLI / Workspace surface, so the agent input stays on
  the shared composer stack used everywhere else in the framework.
- Reads `application_state.navigation` every turn, so it already knows which
  view you're in and what's selected — you don't have to re-explain "this".

### App vs Code tool modes {#tool-modes}

The panel runs in one of two tool modes:

- **App mode** — the agent only has your app's own tools: the actions you
  defined with `defineAction`, plus navigation and context. No filesystem or
  shell access. This is what end users get.
- **Code mode** — adds the shared coding tools (`bash`, `read`, `edit`, `write`)
  and database access on top of the app tools, so the agent can change the app's
  own source. Code requests are gated: when a message requires code
  (`type: "code"`) and no code-capable frame is connected, the panel shows a
  dialog explaining that code changes need Agent Native Desktop or Builder;
  when a frame is connected, the request is routed to it and a code-agent
  indicator shows while it works (`useSendToAgentChat`). For the canonical
  coding-tool list and shared UI contracts, see
  [Agent-Native Code UI](/docs/code-agents-ui).

"Code mode" is the agent-capability toggle — distinct from environment dev mode
(`NODE_ENV` / Vite). For back-compat the underlying `AGENT_MODE` env var, the
`/_agent-native/agent-chat/mode` endpoint (whose payload still uses `devMode`),
and the `agent-chat.mode` settings key are unchanged. The client hook is
`useCodeMode()` (the older `useDevMode()` remains as a deprecated alias).

In the local dev frame, the settings cog toggles between these modes. Switching
off Code mode hides the frame's own sidebar and shows the app's in-app agent
sidebar inside the iframe instead, so you can preview exactly what end users see.

## Integrated terminal and CLI switching {#cli-terminal}

In development the panel includes an embedded terminal (`AgentTerminal`, also
from `@agent-native/core/client`) backed by a PTY server. You can run a real
coding CLI right beside the app and switch between them; the terminal restarts
with the selected CLI.

The supported CLIs come from the core CLI registry
(`packages/core/src/terminal/cli-registry.ts`). Only these commands are allowed
to spawn — the PTY server validates the requested command against the registry
allow-list to prevent injection:

| CLI         | Command    | Install package             |
| ----------- | ---------- | --------------------------- |
| Claude Code | `claude`   | `@anthropic-ai/claude-code` |
| Builder.io  | `builder`  | (built in)                  |
| Codex       | `codex`    | `@openai/codex`             |
| Gemini CLI  | `gemini`   | `@google/gemini-cli`        |
| OpenCode    | `opencode` | `opencode-ai`               |

If the selected CLI isn't found on `PATH`, the terminal falls back to running it
through `npx --yes <install-package>` (where an install package exists). The
default command is `claude`. Switch CLIs from the agent panel settings at any
time.

## Builder.io cloud frame {#cloud-frame}

[Builder.io](https://www.builder.io) provides a managed frame that hosts the
same app and the same agent panel, in the cloud:

- Real-time collaboration — multiple users can watch and interact at once.
- Visual editing, roles, and permissions.
- Parallel agent execution for faster iteration.
- Good for team use, where everyone shares one hosted environment.

Code requests from the embedded panel route to the Builder frame the same way
they route to the local dev frame, so the dev-vs-prod behavior above is
consistent across both.

## Runtime APIs {#runtime-apis}

These ship with `@agent-native/core` and are what your app uses to talk to the
agent, regardless of which frame is hosting it:

1. **Send a message** — `sendToAgentChat()` sends a message to the agent. The
   `useSendToAgentChat()` hook wraps it with the code-request gating described
   above and returns a `codeRequiredDialog` element to render. See
   [Drop-in Agent](/docs/drop-in-agent) for full usage and options.
2. **Generation state** — `useAgentChatGenerating()` tracks when the agent is
   running, so the UI can show progress without polling the agent directly.
3. **Polling sync** — database-backed sync keeps UI caches fresh when the agent
   changes data or application state.
4. **Action system** — `pnpm action <name>` dispatches to the same callable
   actions the agent invokes as tools, so anything the agent can do, you can
   script.

## Running it {#running}

The embedded agent panel is part of every app — scaffold a template and it's
already there:

```bash
npx @agent-native/core@latest create my-app --template mail --standalone
cd my-app
pnpm dev
```

The local dev frame (the private `@agent-native/frame` package in the framework repo) is an internal tooling package that is not published to npm. It loads the active app's dev server in an iframe and mounts the embedded panel beside it, selecting the app via the `app` query param. The integrated CLI terminal requires Agent Native Desktop, which provides the local code and PTY access the terminal needs; without it, the panel shows the chat surface and prompts you to open Desktop to use the CLI.
