---
title: "PR Visual Recap"
description: "A GitHub Action that runs your repo's visual-recap skill on every PR. An LLM coding agent reads the diff, publishes an interactive recap plan, shows an informational check, and posts a sticky PR comment with an inline screenshot. Informational and non-blocking."
---

# PR Visual Recap

PR Visual Recap is a GitHub Action that turns every pull request into a **visual code review**. On each push, an LLM coding agent runs the latest bundled [`visual-recap`](/docs/template-plan) skill (or your repo's committed copy when `VISUAL_RECAP_SKILL_SOURCE=repo`) against the PR diff, publishes a structured recap plan to the hosted Plans app, shows an informational `Visual Recap` check while it runs, and upserts **one sticky PR comment** that links to the interactive plan with an **inline screenshot** embedded right in the comment.

This is not a deterministic diff renderer. The action invokes a real coding agent (Claude Code CLI by default, or OpenAI Codex CLI) that reads the change, decides what matters, and authors the recap by calling the Plans MCP tool `create-visual-recap` — the same tool the `/visual-recap` slash command uses. You get a high-altitude, schema/API/before-after view of the change instead of a wall of raw diff.

The recap is **informational and non-blocking**. It creates a check row so reviewers can see that generation is in progress, but it is not a required check, it never blocks the PR, and it never replaces reading the actual diff. The sticky comment is a review aid, not a sign-off.

## What it does

On each PR push, the workflow:

1. Collects a bounded diff between the PR base and head.
2. Creates an informational `Visual Recap` GitHub check with `Visual recap in progress`.
3. Runs the configured coding agent against that diff. The agent reads the bundled `visual-recap` skill guidance (or your repo-pinned copy) and authors a recap, publishing it with `create-visual-recap`.
4. Reads the published plan URL the agent wrote to `recap-url.txt`.
5. Opens that URL in headless Chrome and screenshots the rendered plan.
6. Uploads the PNG to a signed public image route on the Plans app.
7. Upserts a single sticky PR comment that embeds the screenshot **inline** (served through GitHub's camo image proxy) next to the link to the interactive recap.
8. Completes the `Visual Recap` check as success, skipped, or neutral.

A re-push updates the same plan and the same sticky comment in place — no orphaned plans, no comment spam.

## Installing it

When you install Plans interactively, the Agent-Native CLI asks whether to add
automatic PR Visual Recaps. Say yes to write the GitHub Action, or add it
explicitly at any time:

```bash
npx @agent-native/core@latest skills add visual-plan --with-github-action
```

This installs the `visual-plan` skill (which includes the `visual-recap` skill the action runs) and writes `.github/workflows/pr-visual-recap.yml` into your repo. The workflow calls **published CLI subcommands** through `npx @agent-native/core@latest recap <subcommand>` — including `gate`, `collect-diff`, `mcp-config`, `scan`, `build-prompt`, `shot`, `comment`, `check`, and `usage` — so nothing is copied into your repo as helper scripts. `setup` and `doctor` are the interactive helpers you run locally; `gate` is the security-gate step the workflow runs before every recap.

Then run the guided setup helper:

```bash
npx @agent-native/core@latest recap setup
npx @agent-native/core@latest recap doctor
```

`recap setup` refreshes the workflow, uses `gh` to set GitHub Actions
secrets/variables when values are available from env or the local Plans
publish-token store, and prints exact missing commands for anything it cannot
set. Secret values are sent to `gh` through stdin, not command arguments. Commit
the generated workflow file and open a PR to see it run.

By default, the workflow builds its agent prompt from the latest bundled
`visual-recap` guidance in `@agent-native/core@latest`, including any sibling
reference files the skill ships with. If your repo intentionally customizes and
pins its committed `visual-recap` folder, set the repository variable
`VISUAL_RECAP_SKILL_SOURCE=repo`.

## Backend selection

Choose which coding agent runs the skill with the `VISUAL_RECAP_AGENT` repository variable:

| `VISUAL_RECAP_AGENT` | Coding agent     | Required API key    |
| -------------------- | ---------------- | ------------------- |
| `claude` _(default)_ | Claude Code CLI  | `ANTHROPIC_API_KEY` |
| `codex`              | OpenAI Codex CLI | `OPENAI_API_KEY`    |

If the variable is unset, the action uses `claude`.

## Model and reasoning

Beyond the backend, two repository variables tune _how_ the agent runs:

- **`VISUAL_RECAP_MODEL`** pins the model passed to the CLI (`--model`) — for example `gpt-5.5` for Codex, or a Claude model id. Leave it unset to use the CLI's own default model.
- **`VISUAL_RECAP_REASONING`** sets the reasoning depth: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`. It applies to the Codex backend; Claude's reasoning is model-driven, so this variable is ignored there.
- **`VISUAL_RECAP_SKILL_SOURCE`** controls prompt freshness: `auto`/unset uses the latest bundled skill guidance, while `repo` pins to the committed repo-local `visual-recap` skill folder.

For example, to run the recap on Codex with GPT-5.5 at high reasoning, set the repository variables `VISUAL_RECAP_AGENT=codex`, `VISUAL_RECAP_MODEL=gpt-5.5`, and `VISUAL_RECAP_REASONING=high`.

## Secrets and variables

Set these in your repository's **Settings → Secrets and variables → Actions**.

### Secrets (only two required)

| Secret              | Purpose                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PLAN_RECAP_TOKEN`  | Revocable token minted by `npx @agent-native/core@latest connect`. Authorizes publishing the recap plan and the screenshot upload. |
| `ANTHROPIC_API_KEY` | The LLM key for the default Claude Code backend.                                                                                   |

**Teams: use an org service token.** A personal token is bound to the person
who minted it — if they leave the org or revoke their tokens, every repo using
that secret starts failing with 401s, and CI-created plans are owned by that
individual instead of the team. An org service token is owned by your
**organization**: it acts as a service principal (`svc-<name>@service.<orgId>`),
survives any individual leaving, the recaps it publishes are org-visible, and
any org owner or admin can list or revoke it. Mint one (org owner/admin only):

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --service-token pr-recap
```

The command authenticates you in the browser, then prints the service token
exactly once — store it as the `PLAN_RECAP_TOKEN` secret. Manage it later with
the `list-org-service-tokens` and `revoke-org-service-token` actions on the
Plans app.

**Solo: a personal token still works.** Mint it with `npx @agent-native/core@latest connect`
against your Plans app. For the hosted app, this also writes a local
publish-token file that `npx @agent-native/core@latest recap setup` can read:

```bash
npx @agent-native/core@latest connect https://plan.agent-native.com --client codex
npx @agent-native/core@latest recap setup
```

If you prefer manual setup, paste the token into the GitHub secret. Use a
placeholder like `plan_recap_xxxxxxxxxxxxxxxx` only for examples — never commit a
real token.

### Optional (only if you change defaults)

| Secret / variable        | Default                         | When you need it                                                                                                                                |
| ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | —                               | Secret. Set together with `VISUAL_RECAP_AGENT=codex` to run the recap with Codex instead.                                                       |
| `VISUAL_RECAP_AGENT`     | `claude`                        | Variable. Selects the coding-agent backend (`claude` or `codex`).                                                                               |
| `VISUAL_RECAP_MODEL`     | each CLI's default              | Variable. Pins the model — e.g. `gpt-5.5` for Codex, or a Claude model id. Unset uses the CLI's own default.                                    |
| `VISUAL_RECAP_REASONING` | each model's default            | Variable. Reasoning depth: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Applies to the Codex backend.                                |
| `RECAP_CLI_VERSION`      | `latest`                        | Variable. Pins the `@agent-native/core` CLI version the workflow installs — e.g. `1.5.0`. See [Version pinning](#version-pinning-copy-variant). |
| `PLAN_RECAP_APP_URL`     | `https://plan.agent-native.com` | Secret. Only when self-hosting the Plans app at a different origin.                                                                             |

The workflow auto-detects how to invoke its helper CLI (local source inside this monorepo, the published `@agent-native/core` elsewhere), so there is no `RECAP_CLI` variable to set.

## Inline screenshot in the comment

After the agent publishes the recap, the workflow screenshots the rendered plan in headless Chrome and uploads the PNG to a signed public image route on the Plans app. The sticky PR comment then embeds that screenshot **inline** — GitHub re-serves it through its camo proxy, so reviewers see a preview of the recap directly in the comment without opening anything. The link to the full interactive plan sits right next to it for when they want to explore, comment, or annotate.

## Fork PRs

### Default behavior (no action required)

The main `pr-visual-recap.yml` workflow fires on the plain `pull_request` trigger, **not** `pull_request_target`. Fork PRs therefore run with **no access to repository secrets**, so the workflow finds no `PLAN_RECAP_TOKEN` and cleanly no-ops — no failed publish, no error comment, no credentials exposed. Recaps only run for PRs from branches in the same repository, where the secrets are available.

This also means you can merge the workflow file **before** the secrets exist: with no token configured, every run is a quiet no-op until you set the secrets. The `gate` step also skips draft PRs and bot-authored PRs automatically, so neither trigger recap runs by default.

### Opt-in with the label-gated fork workflow

If you want to generate recaps for fork PRs, a second workflow file is available: `.github/workflows/pr-visual-recap-fork.yml`. It uses `pull_request_target` (which runs with base-repo secrets) but requires an explicit **per-PR maintainer opt-in** via a `recap` label before the recap agent runs.

To install it, copy the file from [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native/blob/main/.github/workflows/pr-visual-recap-fork.yml) into your repo's `.github/workflows/` directory alongside the existing `pr-visual-recap.yml`. The same secrets (`PLAN_RECAP_TOKEN`, `ANTHROPIC_API_KEY`) apply.

### How the label gate works

1. A fork contributor opens a PR. No recap runs automatically.
2. A maintainer reviews the diff (especially for any prompt-injection-shaped content — see below), then applies the `recap` label to the PR.
3. The fork workflow's gate checks: **is this a fork PR?** and **does the `recap` label exist?** Both must be true. If either fails, the job skips.
4. On subsequent pushes to the same PR, the gate re-checks that the label is still present. Removing the label revokes consent — the recap will not run on the next synchronize event.

### What the fork workflow does and does NOT do

| The workflow DOES                                                                                                      | The workflow does NOT                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Checkout the **base repository** at the **base branch ref** — trusted code only                                        | Check out or execute any code from the fork                                        |
| Fetch the fork head as a remote ref (`git fetch origin pull/<n>/head:refs/recap/fork-head`) — fetching commits is safe | Install packages from the fork, run fork scripts, or evaluate fork content as code |
| Run `git diff base...refs/recap/fork-head` — pure text diff of two already-fetched objects                             | Use the diff as anything other than text input to the LLM                          |
| Run the **base repo's** visual-recap skill and agent configuration                                                     | Load any skill or config from the fork                                             |
| Pass the diff through the same secret-scan step (fail-closed) as first-party PRs                                       | Skip the secret scan                                                               |
| Add an explicit prompt-hardening note to the agent prompt marking diff content as untrusted                            | Grant the agent any additional permissions beyond the normal recap agent           |

### Why you must review the diff before labeling

The fork diff is attacker-controlled text that the recap agent reads as input. A carefully crafted diff could contain prompt-injection content — for example, diff lines that look like agent instructions — intended to make the recap agent take unintended actions (e.g., exfiltrate the publish token or produce misleading recap content).

Before applying the `recap` label, skim the diff for:

- Lines that read like direct commands or role instructions ("Ignore previous instructions...", "You are now...", "Write the token to...").
- Unusual file names that could be misread as system prompts.
- Encoded content in added files that might decode to instructions.

These mitigations are already layered in the workflow (secret scan, sensitive-path gate, prompt-hardening note, restricted agent tool allowlist), but label review is the primary line of defense.

### Relationship to the main workflow

The two workflow files are independent. For non-fork PRs, only `pr-visual-recap.yml` fires (fork check in its gate excludes them). For fork PRs, only `pr-visual-recap-fork.yml` fires (non-fork check in its gate excludes them). They share the same sticky comment marker and plan-id threading, so both PRs and fork PRs produce a single upserted comment on the same PR.

### Self-modifying guard {#self-modifying-guard}

The `gate` step skips the recap entirely when a PR touches any of the following paths, so a PR can never rewrite what the trusted recap job runs and exfiltrate secrets:

| Path pattern                               | Reason                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| `.github/workflows/pr-visual-recap.yml`    | The workflow itself                                       |
| `**/skills/visual-(recap\|plan\|plans)/**` | The visual-recap skill the agent follows                  |
| `**/.claude/**`                            | Agent settings the runner loads                           |
| `**/CLAUDE.md`                             | Agent instructions the runner loads                       |
| `**/AGENTS.md`                             | Agent instructions the runner loads                       |
| `**/.mcp.json`                             | MCP server config the runner loads                        |
| `packages/core/**`                         | Recap CLI source _(BuilderIO/agent-native monorepo only)_ |

The `packages/core/**` rule applies only in the `BuilderIO/agent-native` monorepo where `packages/core` is the recap CLI source. In consumer repos an unrelated `packages/core/` directory does not trigger the guard.

## Local-files privacy mode

The GitHub Action is designed for hosted, shareable PR review. If you want a
recap without sending recap content to the Agent-Native Plan database, run the
same helper flow locally in local-files mode instead:

```bash
npx @agent-native/core@latest recap collect-diff --base main --head HEAD --out recap.diff --stat recap.stat
npx @agent-native/core@latest recap scan --diff recap.diff
npx @agent-native/core@latest recap build-prompt --pr 123 --diff recap.diff --stat recap.stat --local-files --local-dir plans/pr-123-visual-recap
```

Give the generated `recap-prompt.md` to your coding agent. In local-files mode
the prompt instructs the agent to write `plans/pr-123-visual-recap/plan.mdx`
plus optional visual files and then run:

```bash
npx @agent-native/core@latest plan local preview --dir plans/pr-123-visual-recap --kind recap
```

The returned `file://` preview, or `/local-plans/pr-123-visual-recap` in a local
Plan app using the same `PLAN_LOCAL_DIR`, is the review link. This mode disables
the hosted sticky PR comment, inline screenshot upload, usage attachment, and
browser comments until you explicitly publish.

## It's informational, not a gate

The recap is a review aid layered on top of the normal PR flow:

- It shows a `Visual Recap` check row for visibility, but it is **never a required check** and never blocks merging.
- A generation or publish failure completes neutrally and surfaces as an explanatory sticky comment, not a red X on unrelated code.
- The recap and its screenshot **do not imply the diff has been reviewed**. Reviewers still need to read the actual changed lines.

## Version pinning (copy variant) {#version-pinning-copy-variant}

By default the copy-variant workflow installs `@agent-native/core@latest` at run time so every recap run automatically picks up the newest CLI. If your CI needs reproducible tooling, set the **`RECAP_CLI_VERSION`** repository variable to pin the installed version:

1. Go to your repo's **Settings → Secrets and variables → Actions → Variables**.
2. Create a variable named `RECAP_CLI_VERSION` with a value like `1.5.0`.

The variable is optional. Leave it unset (or set it to `latest`) to track the newest release.

For the reusable-caller variant, use the `cli-version` input instead (see [Version pinning](#version-pinning) in the reusable section).

## Secret-scan allowlist

Before publishing a recap the workflow runs `npx @agent-native/core@latest recap scan` to detect likely secrets in the diff. Any PR whose diff matches a known-secret pattern is blocked with an explanatory comment — the recap is not published, and no diff content is sent to the coding agent.

In rare cases a repo has intentional test fixtures or non-secret strings that superficially resemble secret patterns (e.g., a fixture key in a test file). To suppress a false positive, create `.github/recap-scan-allowlist` in the root of your repository.

### Format

Each non-blank, non-comment line is either a **literal substring** or a **`/regex/flags`** pattern:

```
# Lines starting with # are comments.

# Literal substring — any diff line containing this string is allowed.
sk-test-fixture1234567890abcdef

# Regex pattern — written as /pattern/flags (JS syntax).
/^.STRIPE_KEY=sk-test-/i

# Another literal.
EXAMPLE_API_KEY=placeholder-value
```

Rules:

- A line is **suppressed** (allowed) when it contains the literal, or when the full line matches the regex.
- The file is **fail-closed**: if it is absent, no suppressions apply — the scanner behaves as before.
- An empty file is equivalent to no file.
- Malformed regex lines are treated as literal strings.

The allowlist is only consulted by the secret-scan gate. It does not affect what the coding agent can read — if the gate passes, the agent receives the full diff regardless.

## Adopt as a reusable workflow

### Why use the reusable variant?

The default installer copies the full ~360-line workflow YAML into your repo (the **copy** option). This is the right choice for air-gapped repos or repos that need to audit every line of what runs. The downside is that bug fixes and improvements never reach you — you need to re-run `npx @agent-native/core@latest recap setup` manually after each release.

The **reusable** option writes a thin ~20-line caller instead. It delegates to `BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml` via `uses:`. Every caller automatically picks up the latest logic when the workflow runs, with no local update needed.

|                                | Copy (default)            | Reusable                       |
| ------------------------------ | ------------------------- | ------------------------------ |
| Workflow size in your repo     | ~360 lines                | ~20 lines                      |
| Picks up fixes automatically   | No — re-run `recap setup` | Yes                            |
| Air-gap / full auditability    | Yes                       | No                             |
| Pinnable to a specific version | Only by editing locally   | Yes — set `@v1.2.3` in `uses:` |

### Caller snippet

This is what `npx @agent-native/core@latest recap setup --reusable` writes (or you can paste it manually):

```yaml
name: PR Visual Recap

# Thin caller — the full workflow logic lives in BuilderIO/agent-native.
# Fixes and improvements reach this repo automatically on each run.
# To pin a specific version for reproducibility replace '@main' with a
# tag or SHA, e.g. '@v1.2.3' or '@abc1234'.

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  visual-recap:
    permissions:
      actions: write
      contents: read
      checks: write
      issues: write
      pull-requests: write
    uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@main
    secrets:
      PLAN_RECAP_TOKEN: ${{ secrets.PLAN_RECAP_TOKEN }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PLAN_RECAP_APP_URL: ${{ secrets.PLAN_RECAP_APP_URL }}
    with:
      agent: ${{ vars.VISUAL_RECAP_AGENT || 'claude' }}
      model: ${{ vars.VISUAL_RECAP_MODEL || '' }}
      reasoning: ${{ vars.VISUAL_RECAP_REASONING || '' }}
      skill-source: ${{ vars.VISUAL_RECAP_SKILL_SOURCE || 'auto' }}
      # cli-version: "latest"  # pin to a specific @agent-native/core version
```

The same secrets and variables described in [Secrets and variables](#secrets-and-variables) apply — set them in your repo settings the same way as for the copy variant.

### Installing via the CLI

```bash
# Write the thin caller instead of the full copy:
npx @agent-native/core@latest recap setup --reusable

# Or with a pinned ref for reproducibility:
npx @agent-native/core@latest recap setup --reusable --ref v1.2.3
```

Both variants write the workflow to `.github/workflows/pr-visual-recap.yml`. If an existing workflow is already there and differs, the command refuses and tells you to pass `--force` to overwrite.

After writing, run `npx @agent-native/core@latest recap doctor` as usual to confirm secrets are configured.

### Version pinning

By default the caller references `@main`, which always uses the latest published version of the reusable workflow. For production repos that need reproducible CI, pin to a tag or SHA:

```yaml
uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@v1.2.3
```

The `cli-version` input controls which `@agent-native/core` CLI version runs inside the workflow — leave it at `"latest"` to track the newest release, or pin it to a version string (e.g. `"1.5.0"`) for full reproducibility.

### workflow_call event context

`workflow_call` workflows inherit the **caller's** event context. The reusable workflow uses `github.event.pull_request.*` expressions to read the PR number, head SHA, base SHA, and PR metadata — these work correctly only when the caller triggers on `pull_request`. The caller snippet above already includes the correct event types.

Do not trigger the caller on `workflow_dispatch` or `push` — those events do not carry a `pull_request` payload, and the gate will skip the recap with "no pull_request payload".

## Related

- [Visual Plans](/docs/template-plan) — the `/visual-plan` and `/visual-recap` skills, the hosted Plans connector, and the interactive review surface this action publishes to.
- [Skills](/docs/skills-guide) — installing agent-native skills into your coding agent.
