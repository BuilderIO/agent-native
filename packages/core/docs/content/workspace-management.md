---
title: "Workspace Governance"
description: "Branching, CODEOWNERS, PR review, and how Dispatch handles runtime governance alongside git-level governance."
---

# Workspace Governance

This guide covers the operational side of running an agent-native workspace — how to branch, who reviews what, how to set up code ownership, and how the Dispatch control plane fits into your governance model.

For workspace setup, shared auth, and deployment, see [Multi-App Workspaces](/docs/multi-app-workspace).

## Branching

### Feature Branches

Use short-lived feature branches for all work:

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**Naming conventions:**

- **Single-app changes:** `feat/<app>-<description>` or `fix/<app>-<description>` — e.g. `feat/mail-thread-search`, `fix/calendar-recurrence-parse`
- **Framework changes:** `feat/core-<description>` or `fix/core-<description>` — e.g. `feat/core-polling-v2`
- **Dispatch changes:** `feat/dispatch-<description>` — e.g. `feat/dispatch-vault-policies`
- **Cross-app changes:** if a framework change requires template updates, do both in one branch so they ship atomically

Keep branches short-lived. Long-lived branches diverge from main and create painful merges — especially in a monorepo where multiple teams push daily.

### Non-Developer Branching

Not everyone who needs to make changes is comfortable with git. [Builder.io](https://www.builder.io) supports a visual branching model that maps to git branches under the hood — useful for content and copy changes, layout adjustments, design iterations, and A/B testing without a dev environment.

## Code Ownership

GitHub's CODEOWNERS file auto-assigns reviewers to PRs based on which files changed. Create `.github/CODEOWNERS` at the repo root:

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# Dispatch control plane — secrets, integrations, workspace resources
templates/dispatch/                @your-org/platform-team

# Per-app ownership — each team reviews their own app
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# Workspace-level config — broad review since it affects everyone
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

Key tips: use GitHub teams (`@org/team`), not individuals. Framework and Dispatch changes should always require platform review. See [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) for glob syntax and multiple-owner patterns.

To enable required reviews: Settings → Branches → Branch protection for `main` → **Require a pull request before merging** → **Require review from Code Owners**.

## PR Labeling

Auto-label PRs by app with `.github/labeler.yml` (excerpt):

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**
app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**
core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

Then add the [actions/labeler](https://github.com/actions/labeler) action — see that repo's README for the full workflow YAML. Labels apply automatically when PRs are opened or updated.

## PR Review Guidelines

| Change type                       | Who reviews                           | What to watch for                                                         |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| **App-only** (`templates/<app>/`) | Owning app team                       | Domain correctness, action schemas                                        |
| **Framework** (`packages/core/`)  | Platform team + one affected app team | Breaking changes, performance, backwards compat                           |
| **Schema migrations**             | Platform team + senior engineer       | Data safety, dialect agnosticism (SQLite + Postgres)                      |
| **Actions**                       | Owning team                           | Actions are both agent tools AND HTTP endpoints — review from both angles |
| **Cross-app A2A**                 | Both app teams                        | If you change an A2A interface, the callers need to know                  |
| **Dispatch vault/resources**      | Platform team                         | Secret access, grant scope, who gets what                                 |

### Concurrent Agent Work

Agent-native workspaces often have multiple AI agents working on the same branch simultaneously. This is by design — the agents share a branch and push independently.

When reviewing PRs in this environment:

- **Don't revert changes you didn't make** unless they're clearly broken
- **Files may be modified by multiple agents** in the same PR — this is normal
- **Run `pnpm run prep`** (typecheck + test + format) before pushing to catch integration issues between agents' changes
- **If two agents touch the same file,** the later commit wins. Conflicts surface at review time, not at commit time
- **Fix bugs in any code in the PR,** regardless of which agent wrote it. The PR is reviewed as a whole.

## Dispatch as Governance

The [Dispatch](/docs/dispatch) app is the workspace's runtime control plane. It complements git-level governance with runtime governance:

| Concern                         | Git / GitHub                  | Dispatch                                                     |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Who can change code             | CODEOWNERS, branch protection | —                                                            |
| Who can access secrets          | —                             | Vault policy, grants, request workflow                       |
| What instructions agents follow | —                             | Global workspace resources (AGENTS.md, instructions, skills) |
| Which agents are shared         | —                             | Workspace agent profiles                                     |
| Integration inventory           | —                             | Workspace connections and integrations catalog               |
| Runtime change approval         | —                             | Dispatch approval flow                                       |
| Audit trail                     | `git log` / `git blame`       | Vault audit + dispatch audit logs                            |
| Messaging & routing             | —                             | Slack / Telegram integration                                 |

**Git handles code governance. Dispatch handles runtime governance.** Don't try to replicate git workflows inside Dispatch or vice versa.

Dispatch manages: vault secrets, reusable workspace connections, workspace resources (skills, instructions, agent profiles, MCP servers), approvals, and audit logs. For public app route configuration (`workspaceApp.audience` / `publicPaths` / `protectedPaths`), see [Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment).

For the resource model and canonical paths, see [Workspace — Global resources](/docs/workspace#global-resources).

## Setup Checklist

For a new workspace, after running `npx @agent-native/core@latest create`:

**Git & GitHub:**

- [ ] Create `.github/CODEOWNERS` with per-app team ownership
- [ ] Enable branch protection on `main` with required code owner reviews
- [ ] Add `.github/labeler.yml` for auto-labeling PRs by app
- [ ] Create GitHub teams for each app and the platform team

**Dispatch:**

- [ ] Add shared secrets to the vault (API keys, OAuth credentials, etc.)
- [ ] Keep the default all-apps vault policy or switch to manual per-app grants
- [ ] Sync vault secrets to push them to apps
- [ ] Register reusable workspace connections for shared provider accounts, then
      grant apps such as Brain, Analytics, Mail, or Dispatch only when they need
      that account
- [ ] Add workspace-wide skills, guardrail instructions, and brand/company reference resources via the Resources page. See [Workspace](/docs/workspace#global-resources) for the full resource-model table and the recommended starter pack.
- [ ] Configure the approval policy and approver emails
- [ ] Set up SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) for admin notifications
- [ ] Connect Slack or Telegram for workspace messaging
- [ ] Configure shared MCP servers — add `mcp-servers/<name>.json` workspace resources in Dispatch for All-app or selected-app grants; use `mcp.config.json` or [MCP hub mode](/docs/mcp-clients#hub) for lower-level deployments
