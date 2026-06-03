# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. It turns a normal
Markdown/Codex/Claude Code plan into a visual review surface with diagrams,
wireframes, prototype options, annotations, share links, feedback, and proof
gates.

## Install

Use the Agent-Native CLI:

```sh
agent-native skills add plans
```

The CLI installs the Plans skills and registers the MCP app connector. You do
not need to wire the MCP server separately.

Supported aliases include:

- `agent-native skills add plans`
- `agent-native skills add visual-plan`
- `agent-native skills add visualize-plan`

Restart or reload the host if the tools are not visible immediately.

## Use

Type `/visual-plan` when you want a fresh plan before the agent builds.

Type `/visualize-plan` when you already have a Codex, Claude Code, Markdown, or
pasted plan and want a richer visual companion.

Plans should be visual by default:

- diagrams for architecture, data flow, dependencies, and state machines
- wireframes and quick mockups for UI work
- prototype options when interaction or design direction is uncertain
- plannotator-style comments, corrections, and annotations
- review prompts for assumptions, choices, risks, and missing proof

## Review Loop

1. The agent creates a plan and opens the MCP app inline or as a browser link.
2. The user reacts to visuals instead of reading a wall of Markdown.
3. The user annotates, corrects, chooses options, or asks for more proof.
4. The agent reads structured feedback before editing and updates the plan or
   implementation.
5. The user can keep the plan local or sign in to share a private review link.

Local development can use the framework's auto-created dev account. Hosted
persistence, private sharing, reviewer links, and team feedback use account
login, with Google sign-in available when OAuth env vars are configured.

## Hosted App

The hosted MCP app is expected at:

- App: `https://plan.agent-native.com`
- MCP: `https://plan.agent-native.com/_agent-native/mcp`

The local template remains useful for development and self-hosting.
