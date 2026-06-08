---
title: "PR Visual Recap"
description: "A GitHub Action that runs your repo's visual-recap skill on every PR. An LLM coding agent reads the diff, publishes an interactive recap plan, and posts it as a sticky PR comment with an inline screenshot. Informational and non-blocking."
---

# PR Visual Recap

PR Visual Recap is a GitHub Action that turns every pull request into a **visual code review**. On each push, an LLM coding agent runs your repo's [`visual-recap`](/docs/visual-plans) skill against the PR diff, publishes a structured recap plan to the hosted Plans app, and upserts **one sticky PR comment** that links to the interactive plan with an **inline screenshot** embedded right in the comment.

This is not a deterministic diff renderer. The action invokes a real coding agent (Claude Code CLI by default, or OpenAI Codex CLI) that reads the change, decides what matters, and authors the recap by calling the Plans MCP tool `create-visual-recap` — the same tool the `/visual-recap` slash command uses. You get a high-altitude, schema/API/before-after view of the change instead of a wall of raw diff.

The recap is **informational and non-blocking**. It is not a required check, it never blocks the PR, and it never replaces reading the actual diff. The sticky comment is a review aid, not a sign-off.

## What it does

On each PR push, the workflow:

1. Collects a bounded diff between the PR base and head.
2. Runs the configured coding agent against that diff. The agent reads your repo's `visual-recap` skill and authors a recap, publishing it with `create-visual-recap`.
3. Reads the published plan URL the agent wrote to `recap-url.txt`.
4. Opens that URL in headless Chrome and screenshots the rendered plan.
5. Uploads the PNG to a signed public image route on the Plans app.
6. Upserts a single sticky PR comment that embeds the screenshot **inline** (served through GitHub's camo image proxy) next to the link to the interactive recap.

A re-push updates the same plan and the same sticky comment in place — no orphaned plans, no comment spam.

## Installing it

The Agent-Native CLI writes the workflow into your repository and prints the secrets to set:

```bash
agent-native skills add visual-plan --with-github-action
```

This installs the `visual-plan` skill (which includes the `visual-recap` skill the action runs) and writes `.github/workflows/pr-visual-recap.yml` into your repo. The workflow calls **published CLI subcommands** — `agent-native recap scan|build-prompt|shot|comment` — so nothing is copied into your repo as helper scripts. Commit the generated workflow file, set the secrets below, and open a PR to see it run.

## Backend selection

Choose which coding agent runs the skill with the `VISUAL_RECAP_AGENT` repository variable:

| `VISUAL_RECAP_AGENT` | Coding agent     | Required API key    |
| -------------------- | ---------------- | ------------------- |
| `claude` _(default)_ | Claude Code CLI  | `ANTHROPIC_API_KEY` |
| `codex`              | OpenAI Codex CLI | `OPENAI_API_KEY`    |

If the variable is unset, the action uses `claude`.

## Secrets and variables

Set these in your repository's **Settings → Secrets and variables → Actions**.

### Secrets (required)

| Secret               | Purpose                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PLAN_RECAP_APP_URL` | Base URL of the hosted Plans app the recap publishes to (e.g. `https://plan.agent-native.com`).                             |
| `PLAN_RECAP_TOKEN`   | Per-user, revocable token minted by `agent-native connect`. Authorizes publishing the recap plan and the screenshot upload. |
| `ANTHROPIC_API_KEY`  | Required when `VISUAL_RECAP_AGENT` is `claude` (the default).                                                               |
| `OPENAI_API_KEY`     | Required instead when `VISUAL_RECAP_AGENT` is `codex`.                                                                      |

Mint `PLAN_RECAP_TOKEN` with `agent-native connect` against your Plans app, then paste the printed token into the secret. Use a placeholder like `plan_recap_xxxxxxxxxxxxxxxx` only for examples — never commit a real token.

### Variables (optional)

| Variable             | Default                            | Purpose                                                             |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `VISUAL_RECAP_AGENT` | `claude`                           | Selects the coding-agent backend (`claude` or `codex`).             |
| `RECAP_CLI`          | `npx -y @agent-native/core@latest` | Overrides how the workflow invokes the CLI (e.g. to pin a version). |

## Inline screenshot in the comment

After the agent publishes the recap, the workflow screenshots the rendered plan in headless Chrome and uploads the PNG to a signed public image route on the Plans app. The sticky PR comment then embeds that screenshot **inline** — GitHub re-serves it through its camo proxy, so reviewers see a preview of the recap directly in the comment without opening anything. The link to the full interactive plan sits right next to it for when they want to explore, comment, or annotate.

## Fork-PR safety

The workflow uses the plain `pull_request` trigger, **not** `pull_request_target`. Fork PRs therefore run with **no access to repository secrets**, so the recap step finds no `PLAN_RECAP_TOKEN` and cleanly no-ops — no failed publish, no error comment, no leaked credentials. Recaps only run for PRs from branches in the same repository, where the secrets are available.

This also means you can merge the workflow file **before** the secrets exist: with no token configured, every run is a quiet no-op until you set the secrets.

## It's informational, not a gate

The recap is a review aid layered on top of the normal PR flow:

- It is **never a required check** and never blocks merging.
- A generation or publish failure surfaces as an explanatory sticky comment, not a red X on unrelated code.
- The recap and its screenshot **do not imply the diff has been reviewed**. Reviewers still need to read the actual changed lines.

## Related

- [Visual Plans](/docs/visual-plans) — the `/visual-plan` and `/visual-recap` skills, the hosted Plans connector, and the interactive review surface this action publishes to.
- [Skills](/docs/skills-guide) — installing agent-native skills into your coding agent.
