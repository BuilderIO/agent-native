---
title: "Visual Plans"
description: "Turn your coding agent's plans into interactive, reviewable documents with /visual-plan — one command installs and authenticates, then plans run locally with no login."
---

# Visual Plans

`/visual-plan` is a coding-agent skill that turns the plan your agent would normally write in Markdown into a **structured visual document**: an optional pan/zoom wireframe canvas on top and a Notion-like technical document below, with diagrams, mockups, prototype options, annotations, and comments you can react to before any code changes.

It is **local-first and no-login by default**. You run one command to install the skill and authenticate the connector, then `/visual-plan` generates a plan and opens the local editor — no account required. You only sign in later, when you want to share a plan link.

## Install and authenticate in one step {#install}

Install with the Agent-Native CLI. The command installs the skill instructions, registers the Plans MCP connector, **and authenticates it in the same step**, so your first tool call does not hit an OAuth wall:

```bash
agent-native skills add visual-plan
```

This also installs the companion commands `/ui-plan`, `/visual-questions`, and `/visualize-plan` (see [Invoking the skill](#invoke)).

What the auth step does depends on your client:

- **OAuth-capable hosts** (Claude Code) get a URL-only MCP entry plus a prompt to run `/mcp` and choose **Authenticate**.
- **Codex / Cowork** run a short browser device-code flow: the CLI prints a code, opens the verification page, and writes the connector once you approve.
- In a **non-interactive shell or CI**, the auth step is skipped and the exact command to run later is printed for you.

Pass `--no-connect` to register the connector without authenticating, then run `agent-native connect https://plan.agent-native.com` whenever you are ready:

```bash
agent-native skills add visual-plan --no-connect
```

## Invoking the skill {#invoke}

Once installed, use the slash command that fits the work:

- `/visual-plan` — the canonical command for any rich plan (architecture, backend, refactors, UI).
- `/ui-plan` — UI-first work that should start with the screens.
- `/visual-questions` — a short visual intake form before planning.
- `/visualize-plan` — turn an existing Codex, Claude Code, Markdown, or pasted plan into a visual companion.

The agent gates hard: it only builds a polished visual plan when a wrong direction would be costly, and skips it for trivial, unambiguous work.

## No-login local usage {#local}

By default `/visual-plan` runs entirely locally. The agent generates the plan, opens the local editor, and you review the wireframes and document — all without an account. Local development uses the framework's auto-created dev account, so plans stay scoped and the editor works out of the box.

If a Plans tool ever returns `needs auth`, `Unauthorized`, or `Session terminated`, do not keep retrying it — authenticate the connector with `agent-native connect https://plan.agent-native.com` (or re-run `/mcp` → Authenticate in an OAuth-capable host), then continue once the connector is available.

## Sharing a plan {#sharing}

Sharing is the one workflow that needs an account. When you want to send a reviewer a link, sign in (Google sign-in appears when the standard Google OAuth env vars are configured) and the plan is published to a shareable URL. Hosted persistence, private sharing, reviewer links, and cross-device or team review all use account login; everything up to that point stays local and login-free.

The hosted Plans connector lives at `https://plan.agent-native.com/_agent-native/mcp`. Never put shared secrets in skill files.
