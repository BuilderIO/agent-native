---
title: "Visual Plans"
description: "Turn your coding agent's plans into interactive, reviewable documents with /visual-plan. Install authenticates once; reviewers you share with edit as a guest, sign in only to save or share."
---

# Visual Plans

`/visual-plan` is a coding-agent skill that turns the plan your agent would normally write in Markdown into a **structured visual document**: an optional pan/zoom wireframe canvas on top and a Notion-like technical document below, with diagrams, mockups, prototype options, answerable Open Questions, annotations, and comments you can react to before any code changes.

There are two ways into Plans:

- **From your coding agent (CLI)** — one command installs the skill, registers the hosted Plans connector, and authenticates it.
- **In the browser** — anyone you share with can open the editor and create or edit as a **guest, with no sign-up**. They sign in only when they want to save or share.

## Coding agent setup {#install}

Install with the Agent-Native CLI. The command installs the skill instructions, registers the hosted Plans MCP connector, **and authenticates it in the same step**, so your first tool call does not hit an OAuth wall:

```bash
agent-native skills add visual-plan
```

Authentication is a one-time browser sign-in at setup — this is intended, and it is what lets the agent persist and share the plans it generates. This also installs the companion `/visual-recap` command for reviewing changes that already landed (see [Invoking the skill](#invoke)).

What the auth step does depends on your client:

- **OAuth-capable hosts** (Claude Code) get a URL-only MCP entry plus a prompt to run `/mcp` and choose **Authenticate**.
- **Codex / Cowork** run a short browser device-code flow: the CLI prints a code, opens the verification page, and writes the connector once you approve.
- In a **non-interactive shell or CI**, the auth step is skipped and the exact command to run later is printed for you.

Pass `--no-connect` to register the connector without authenticating, then run `agent-native connect https://plan.agent-native.com` whenever you are ready:

```bash
agent-native skills add visual-plan --no-connect
```

To auto-generate a recap on **every pull request**, pass `--with-github-action`. This writes a GitHub Action that runs the `visual-recap` skill on each PR and posts an interactive recap plan with an inline screenshot as a sticky comment — see [PR Visual Recap](/docs/pr-visual-recap).

```bash
agent-native skills add visual-plan --with-github-action
```

## Invoking the skill {#invoke}

Once installed, there are two commands:

- `/visual-plan` — plan **before** implementation. The canonical command for any rich plan: architecture, backend, refactors, or UI. It pulls in diagrams, wireframes, mockups, clickable prototypes, and implementation maps as the work calls for them, and can open with a short visual intake step when the direction is still open.
- `/visual-recap` — review **after** the change. Turns a PR, commit, branch, or git diff that already landed into a high-altitude recap — schema, API, file, and before/after blocks instead of a wall of raw diff. A recap is a review aid, not a replacement for reading the diff. See [PR Visual Recap](/docs/pr-visual-recap) to run it automatically on every pull request.

The agent gates hard: it only builds a polished visual plan when a wrong direction would be costly, and skips it for trivial, unambiguous work. Each command generates a plan and opens the editor.

When a Codex, Claude Code, Markdown, or pasted plan already exists, use `/visual-plan`. The agent should preserve that source plan and build the richer review surface from it instead of starting over.

When a plan has unresolved decisions that are useful to answer after the first pass, the agent can put them in an **Open Questions** form at the bottom of the same plan. You can choose single or multiple options, fill in freeform answers, and send the answers back to the agent to revise the plan.

## Editing in the browser as a guest {#guest}

People you share a plan with do not need to install anything. They open the Plans editor and **create and edit with no sign-up** — they work as a guest. Signing in is only required when someone wants to **save or share** their own work.

When a guest signs in, the plans they created as a guest are **claimed** into their account, so nothing they built is lost.

Plan prose edits inline: click into any text section, type, format with the rich editor toolbar or slash menu, and Plans autosaves the underlying markdown. Review annotation mode temporarily turns text sections read-only so clicks can pin feedback; leave review mode to keep editing prose.

## Sharing and commenting {#sharing}

Sharing and commenting are the workflows that need an account:

- **Viewing** a public or shared plan works for anyone with the link — no account required.
- **Commenting** on a shared plan requires an agent-native account.
- **Sharing** a plan (publishing it to a link, private sharing, reviewer access, cross-device or team review) requires signing in. Google sign-in appears when the standard Google OAuth env vars are configured.

The hosted Plans connector lives at `https://plan.agent-native.com/_agent-native/mcp`. Never put shared secrets in skill files.

## Local mode (advanced, offline) {#local}

For fully offline, no-account use, you can run the Plans app locally and sync your plans to your repo as MDX. This local mode is a separate, advanced path — not the default hosted flow — and is best when you need everything to stay on your machine and in version control.

## Recovering from auth errors {#auth-errors}

If a Plans tool ever returns `needs auth`, `Unauthorized`, or `Session terminated`, do not keep retrying it. Authenticate the connector with `agent-native connect https://plan.agent-native.com` (or re-run `/mcp` → **Authenticate** in an OAuth-capable host), then continue once the connector is available.
