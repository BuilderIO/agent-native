---
title: "Workspace Governance"
description: "Branching, CODEOWNERS, PR review, and how Dispatch handles runtime governance alongside git-level governance."
---

# Workspace Governance

This guide covers the operational side of running an agent-native workspace — how to branch, who reviews what, how to set up code ownership, and how the dispatch control plane fits into your governance model.

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

- **Single-app changes:** `feat/<app>-<description>` or `fix/<app>-<description>` — e.g. `feat/mail-thread-search`, `fix/recruiting-resume-parse`
- **Framework changes:** `feat/core-<description>` or `fix/core-<description>` — e.g. `feat/core-polling-v2`
- **Dispatch changes:** `feat/dispatch-<description>` — e.g. `feat/dispatch-vault-policies`
- **Cross-app changes:** if a framework change requires template updates, do both in one branch so they ship atomically

Keep branches short-lived. Long-lived branches diverge from main and create painful merges — especially in a monorepo where multiple teams push daily.

### Non-Developer Branching

Not everyone who needs to make changes is comfortable with git. For teams with designers, product managers, or content editors who need to make visual changes:

[Builder.io](https://www.builder.io) supports a visual branching model that maps to git branches under the hood:

- Create branches from Builder's dashboard — no terminal needed
- Edit content, components, layouts, and configuration visually
- Preview changes in isolation before merging
- Changes map to git branches, so developer and non-developer work converges

This is useful for content and copy changes, layout adjustments, design iterations, and A/B testing — work that shouldn't require a dev environment. Developer code changes and Builder visual changes can coexist on the same branch.

## Code Ownership

GitHub's CODEOWNERS file auto-assigns reviewers to PRs based on which files changed. In a monorepo with many apps, this is how you make sure the right people review the right code without everyone reviewing everything.

### Example CODEOWNERS

Create `.github/CODEOWNERS` at the repo root:

```
# Framework core — platform/infra team reviews all changes here
# because they affect every app in the workspace
packages/core/                     @your-org/platform-team

# Desktop app shell
packages/desktop-app/              @your-org/platform-team

# Dispatch control plane — secrets, integrations, workspace resources
templates/dispatch/                @your-org/platform-team

# Per-app ownership — each team reviews their own app
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
templates/content/                 @your-org/content-team
templates/recruiting/              @your-org/recruiting-team
templates/forms/                   @your-org/forms-team
templates/issues/                  @your-org/issues-team
templates/slides/                  @your-org/slides-team
templates/videos/                  @your-org/videos-team

# Workspace-level config — broad review since it affects everyone
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
.env.example                       @your-org/platform-team
```

### Tips

- **Use GitHub teams, not individuals.** `@org/analytics-team` survives people changing roles. `@jdoe` doesn't.
- **Framework changes need platform review.** A one-line change in `packages/core/` can break every app. The platform team should always see these.
- **App teams own their templates.** The people who built and maintain an app understand its domain — they should review changes to it.
- **Dispatch is infrastructure.** Treat it like core. It manages secrets and resources that affect the whole workspace.
- **You can narrow with globs.** `templates/mail/**/*.tsx` if you want to assign frontend-specific reviewers for UI-only changes.
- **Multiple owners are fine.** List both the app team and a senior engineer for critical paths like DB schemas or auth.

### Enabling Required Reviews

1. Create `.github/CODEOWNERS` with the patterns above
2. In GitHub → Settings → Branches → Branch protection for `main`:
   - Enable **Require a pull request before merging**
   - Enable **Require review from Code Owners**
   - Set minimum required approvals (1 is usually fine, 2 for regulated environments)
3. Create the GitHub teams referenced in CODEOWNERS

Once enabled, GitHub won't let a PR merge until each CODEOWNERS-matched team has approved. A PR that touches `templates/mail/` and `packages/core/` requires approval from both `@your-org/mail-team` and `@your-org/platform-team`.

## PR Labeling

Auto-labeling PRs by app makes it easy to filter and prioritize reviews. Add `.github/labeler.yml`:

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**

app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**

app:calendar:
  - changed-files:
      - any-glob-to-any-file: templates/calendar/**

app:recruiting:
  - changed-files:
      - any-glob-to-any-file: templates/recruiting/**

dispatch:
  - changed-files:
      - any-glob-to-any-file: templates/dispatch/**

core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

Then add the [actions/labeler](https://github.com/actions/labeler) GitHub Action to `.github/workflows/labeler.yml`:

```yaml
name: Label PRs
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  label:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/labeler@v5
```

Labels apply automatically when PRs are opened or updated. Teams can then filter their review queue by label.

## PR Review Guidelines

### By Change Type

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

| Concern                         | Git / GitHub                  | Dispatch                                   |
| ------------------------------- | ----------------------------- | ------------------------------------------ |
| Who can change code             | CODEOWNERS, branch protection | —                                          |
| Who can access secrets          | —                             | Vault grants + request workflow            |
| What instructions agents follow | —                             | Workspace resources (skills, instructions) |
| Which agents are shared         | —                             | Workspace agent profiles                   |
| Integration inventory           | —                             | Integrations catalog                       |
| Runtime change approval         | —                             | Dispatch approval flow                     |
| Audit trail                     | `git log` / `git blame`       | Vault audit + dispatch audit logs          |
| Messaging & routing             | —                             | Slack / Telegram integration               |

**Git handles code governance. Dispatch handles runtime governance.** Don't try to replicate git workflows inside dispatch or vice versa. They cover different surfaces.

### What Dispatch Manages

- **Vault** — store credentials centrally, grant them to specific apps, sync on demand. Non-admins can request access; admins approve.
- **Integrations catalog** — see which credentials each app needs, what's configured, what's missing, what's granted from the vault.
- **Workspace resources** — share skills, behavioral instructions, and reusable agent profiles across apps. Scope to all apps or grant per-app.
- **Approvals** — require review before runtime changes (destinations, settings) take effect.
- **Audit** — full history of secret access, grants, syncs, and changes.

## Setup Checklist

For a new workspace, after running `agent-native create`:

**Git & GitHub:**

- [ ] Create `.github/CODEOWNERS` with per-app team ownership
- [ ] Enable branch protection on `main` with required code owner reviews
- [ ] Add `.github/labeler.yml` for auto-labeling PRs by app
- [ ] Create GitHub teams for each app and the platform team

**Dispatch:**

- [ ] Add shared secrets to the vault (API keys, OAuth credentials, etc.)
- [ ] Grant secrets to the apps that need them
- [ ] Sync granted secrets to push them to apps
- [ ] Add workspace-wide skills and instructions via the Resources page
- [ ] Configure the approval policy and approver emails
- [ ] Set up SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) for admin notifications
- [ ] Connect Slack or Telegram for workspace messaging
- [ ] Configure shared MCP servers — drop `mcp.config.json` at the workspace root, or enable Dispatch as the workspace [MCP hub](/docs/mcp-clients#hub) so every app inherits the same server list
