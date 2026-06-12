---
title: "Plan plugin & marketplace"
description: "Install the Agent-Native Plan skills (/visual-plan, /visual-recap) plus the hosted Plan MCP connector as a Claude Code or Codex plugin, or with the universal CLI. How updates work and whether you need to submit anything."
---

# Plan plugin & marketplace

The Agent-Native **Plan** app ships as one installable bundle. A single install adds both Plan slash-command skills **and** wires up the hosted Plan MCP connector, so the agent can generate plans and the skills can publish them straight into the Plan app.

## What you get {#what-you-get}

One install gives you:

- **Two skills** — `/visual-plan` (the canonical entry point) and `/visual-recap`.
- **The Plan MCP connector** — registered against the hosted app at `https://plan.agent-native.com` (MCP endpoint `https://plan.agent-native.com/_agent-native/mcp`, server name `plan`).

By default, both skills publish to the hosted Plan app — they create a plan via
the MCP connector and hand you a link or inline plan to review. They never dump
an inline Markdown/ASCII plan into chat as the deliverable. If a Plan tool
returns `needs auth`, `Unauthorized`, or `Session terminated`, re-authenticate
the connector instead of falling back to inline output. Access tokens are
long-lived (30-day default, sliding 365-day refresh), so this should be rare;
when it happens, the lightweight fix is:

```bash
npx -y @agent-native/core@latest reconnect https://plan.agent-native.com
```

`reconnect` finds and refreshes the connector by URL — no reinstall needed. In
Claude Code, the equivalent is `/mcp` → **Authenticate / Reconnect**.

The exception is explicit **local-files privacy mode**. When you ask for no DB
writes or set `AGENT_NATIVE_PLANS_MODE=local-files`, the skills must not call
the Plan MCP connector. They write `plans/<slug>/plan.mdx` plus optional
`canvas.mdx`, `prototype.mdx`, and `.plan-state.json`, then preview locally with:

```bash
npx @agent-native/core@latest plan local preview --dir plans/<slug> --kind plan
```

This keeps plan content out of the Agent-Native Plan database. Hosted sharing,
comments, screenshots, and plan history are unavailable until you explicitly
publish later.

Agent Native Desktop has a separate local-file sync path for hosted plans: the
Desktop app can mirror a hosted plan to local MDX files and import edits back
without cloning the Plan app or running a CLI. That workflow keeps the hosted
Plan database as the source of truth; use local-files privacy mode when the goal
is no Plan DB writes.

> The plugin (`agent-native-visual-plans`) carries app id `visual-plans`, which is why the Claude Code plugin name and Codex plugin name are both `agent-native-visual-plans`. The Plan app's display name is "Agent-Native Plan".

## Install routes {#install}

There are three ways in. The **universal CLI route** is the one we recommend by default, because it installs the skills **and** registers and authenticates the MCP connector in a single step. The plugin routes are for hosts with a first-class plugin/marketplace system.

### Universal skill route (any MCP host) {#universal}

Works for any host — Claude Code, Codex, Cursor, Cline, Goose, ChatGPT custom MCP apps, Claude Cowork, and anything else MCP-compatible. The Agent-Native CLI installs both skills, registers the hosted Plan MCP connector, **and authenticates it in the same step**, so your first tool call does not hit an OAuth wall:

```bash
npx @agent-native/core@latest skills add visual-plan
```

This installs `visual-plan` plus the companion `visual-recap` skill, then registers the `plan` connector, then runs auth (OAuth prompt for hosted/account-backed sharing). Useful flags:

- `--client codex|claude-code|claude-code-cli|cowork|all` — which local agents to write the MCP config for (default `codex`).
- `--no-connect` — register the connector without authenticating; run `npx @agent-native/core@latest connect https://plan.agent-native.com` later.
- `--mcp-url <url>` — point the connector at a custom origin (an ngrok tunnel, a local dev server, or a self-hosted deployment) instead of the hosted default.
- `--with-github-action` — also write the PR Visual Recap GitHub Action (see [PR Visual Recap](/docs/pr-visual-recap)).

Interactive installs also offer the PR Visual Recap Action when no workflow is
present. Say yes to add it during skill setup, or run the command above later
with `--with-github-action`. After the workflow is written, run:

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` configures the GitHub Action secrets and variables where possible,
and `recap doctor` verifies the workflow, local publish token, GitHub repo
access, and required Actions configuration. After install finishes, restart or
reload the agent client so the new skills and tools load, then run
`/visual-plan`.

> Note: the bare `npx skills add BuilderIO/agent-native --skill visual-plan` (Vercel/open Skills CLI) installs **instructions only** — it does not register the MCP connector. Use the Agent-Native CLI above when you want the connector wired up too.

### Claude Code (plugin) {#claude-code}

The public `BuilderIO/agent-native` repo is itself a Claude Code plugin marketplace, so you add it directly — no build step. Inside Claude Code:

```text
/plugin marketplace add BuilderIO/agent-native
/plugin install agent-native-visual-plans@agent-native-apps
/reload-plugins
/mcp        # authenticate the Plan connector (one OAuth approval)
```

`/plugin install` adds both Plan skills and a **URL-only** MCP config (no secrets in the package); `/mcp` → **Authenticate** completes the OAuth handshake.

> The marketplace catalog is named `agent-native-apps` and the Plan plugin is `agent-native-visual-plans`, so the install target is always `agent-native-visual-plans@agent-native-apps`.

### Codex (plugin) {#codex}

The same repo is a Codex plugin marketplace. Add it, install the plugin, then authenticate the connector:

```bash
codex plugin marketplace add BuilderIO/agent-native
codex plugin add agent-native-visual-plans@agent-native-apps
codex mcp login plan   # OAuth in the browser
```

After install, **start a new Codex thread** so the skills and MCP tools load into the session. The plugin ships a URL-only connector (`[mcp_servers.plan]` → `https://plan.agent-native.com/_agent-native/mcp`); `codex mcp login plan` runs the OAuth flow. The universal CLI route above also works for Codex (`npx @agent-native/core@latest skills add visual-plan --client codex`) if you prefer one command that installs and authenticates together.

> **Older installs:** if your config still has an `agent-native-plans` entry pointing at the same URL, running `npx -y @agent-native/core@latest reconnect https://plan.agent-native.com` (or `skills add visual-plan` for a full reinstall) consolidates it to the canonical `plan` name.

## Updates {#updates}

The plugin routes auto-update — you do not re-pack or re-add the marketplace for routine skill changes:

- **Claude Code** — the marketplace entry sets `autoUpdate: true` and the plugin uses commit-SHA versioning, so Claude Code pulls new versions from the repo at startup; run `/reload-plugins` to activate. Every push to the repo's default branch reaches installed users automatically.
- **Codex** — the plugin `version` embeds a content hash of the bundled skills and MCP endpoint (e.g. `1.0.0+codex.<hash>`), so any skill or endpoint change yields a new version. Codex's startup auto-upgrade re-installs configured git marketplaces on its own; just **start a new thread** to pick up the change. No manual `codex plugin marketplace upgrade` is needed for routine updates.
- **Universal CLI route** — run `npx @agent-native/core@latest skills status visual-plan` to check copied skill folders, or `npx @agent-native/core@latest skills update visual-plan` to refresh them in place. Re-running `skills add visual-plan` still works when you also want to re-register/authenticate the connector. `@latest` always pulls the current skills from the published `@agent-native/core` package.

The connector points at a **hosted** app, so the Plan app's actions and live tool surface always reflect the deployed version regardless of when you installed; only the bundled skill instructions follow the update mechanisms above.

> **Maintainers:** the marketplace bundle (`.claude-plugin/`, `.agents/plugins/`) is generated from the canonical plan skills by `pnpm sync:plan-marketplace` and verified in CI by `pnpm guard:plan-marketplace`, so the published marketplace always matches the canonical skills. Edit the skill, run `pnpm sync:plan-marketplace`, and commit.

## Do you need to submit anything? {#submission}

**No submission or review is required to distribute or install this.** `BuilderIO/agent-native` is a self-hosted, public git marketplace, so users add it directly with the commands above on **both Claude Code and Codex** — no application or approval. The universal CLI route needs no marketplace at all.

Optional discoverability, if you want a public listing:

- **Claude Code** has a community marketplace you can _optionally_ submit to for listing (submission plus an automated review). The official, Anthropic-curated marketplace is listed at Anthropic's discretion — there is no open self-serve application. Neither is required to use the install commands above.
- **Codex** has an OpenAI-curated plugin catalog (a closed allow-list, sourced as a partnership rather than a self-serve submission). Self-hosted git marketplaces and the CLI route need no submission to work.

In short: ship it as a self-hosted/public git marketplace and users install directly; submit to a curated catalog only if you want it listed for discovery.

## Plugin vs. skill {#plugin-vs-skill}

A **skill** is a single `SKILL.md` instruction file the agent reads when a task matches. A **plugin** (Claude Code marketplace plugin or Codex plugin) is a package that bundles one or more skills **plus** an MCP connector and metadata, so a host can install everything in one step.

Under the hood, all three routes are produced from the same source by the `npx @agent-native/core@latest app-skill` CLI: `app-skill pack` builds the marketplace/plugin adapters, and `skills add` is the friendly one-step installer that also registers and authenticates the MCP connector. See [Skills Guide](/docs/skills-guide) for the app-skill manifest format, and [External Agents](/docs/external-agents) for connecting any MCP host and the `npx @agent-native/core@latest connect` flow.

## What's next {#whats-next}

- [**Visual Plans**](/docs/template-plan) — what the skills do and how to use them
- [**PR Visual Recap**](/docs/pr-visual-recap) — run `/visual-recap` automatically on every pull request
- [**Skills Guide**](/docs/skills-guide) — app-backed skills and the manifest format
- [**External Agents**](/docs/external-agents) — connect any MCP host and round-trip artifacts
