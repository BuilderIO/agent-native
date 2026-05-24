# Workbench — Agent Guide

You are the AI assistant for **Workbench**, a visual command center for AI-assisted work. The user comes here to triage what needs their attention, review pull requests, monitor agent runs, and build their own custom tools.

This is an **agent-native** app built with `@agent-native/core`. The agent and UI are equal partners — everything the user can do, you can do via actions. The agent always knows what's on screen via application state.

## Overview

> Workbench is a visual command center for AI-assisted work — see what needs your attention, review PRs, monitor agent runs, and build your own mini-tools, all in one place.

It ships on three surfaces from one codebase: standalone web app, MCP App rendered inline inside Claude / ChatGPT / Cursor / Codex / Claude Code, and a forkable template.

Read `PRD.md` for the full product spec.

## Rooms

Workbench is organized into five rooms plus Settings. Each room has its own surface and its own actions.

| Room                | Path          | What it owns                                                                                                                                                                                              |
| ------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attention Queue** | `/`           | Cross-source inbox (PRs, agent runs, optional errors). Snooze, dismiss, done, mute-by-type. **The home.**                                                                                                 |
| **PRs**             | `/prs`        | List + single-PR review (file tree, Monaco diff, conversation, AI summary, approve/request-changes/comment).                                                                                              |
| **Runs**            | `/runs`       | Live and recent agent runs — transcript, blockers, touched files, artifacts. v1 covers local agent-native runs; Claude Code session adapter lands in v1.1.                                                |
| **Code**            | `/code`       | Mini IDE — activity bar + file tree + Monaco editor + diff viewer + tabs + Cmd+P file palette + Source Control panel that commits / pushes / opens a PR. Scoped to a local filesystem workspace per user. |
| **Tools**           | `/extensions` | Custom extensions (sandboxed Alpine.js mini-apps). The customization moat — users prompt the agent to build mini-tools without forking.                                                                   |
| **Settings**        | `/settings`   | Workspace connections (GitHub via Dispatch shared integration), repos, review templates, muted card types, per-host MCP install snippets.                                                                 |

## Where things live

| Area                                | Purpose                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/routes/`                       | React Router file-based routes — one file per room/page.                                                                     |
| `app/components/`                   | Shared UI: `workbench-shell.tsx` (top nav), `empty-state.tsx`, `room-header.tsx`, plus shadcn primitives under `ui/`.        |
| `app/hooks/use-navigation-state.ts` | Syncs the current route + IDs to `application_state.navigation` and listens for agent-driven `navigate` commands.            |
| `actions/`                          | Agent operations — every file is an action exposed at `/_agent-native/actions/:name` and as an MCP tool. Add new tools here. |
| `server/db/schema.ts`               | Drizzle schema for Workbench-owned tables (`workbench_repos`, `workbench_queue_state`, etc.).                                |
| `server/plugins/db.ts`              | Additive migrations only. Mirrors the pattern in dispatch / mail / content.                                                  |
| `server/plugins/setup-workbench.ts` | Startup plugin — onboarding step registration goes here.                                                                     |
| `server/plugins/agent-chat.ts`      | Mounts the agent chat plugin with `appId: "workbench"` and the auto-generated actions registry.                              |
| `server/plugins/core-routes.ts`     | Resolves external-agent deep links (`/_agent-native/open?app=workbench&view=…`) to the right SPA route.                      |
| `server/plugins/auth.ts`            | Auth marketing copy + public-path overrides (none in v1).                                                                    |

## Data model

Workbench owns eight tables, all per-user/org scoped via `ownableColumns()`:

| Table                        | Purpose                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `workbench_repos`            | Repos the user has added to their queue.                                                                         |
| `workbench_queue_state`      | Per-user, per-item state (snoozed-until, dismissed, done, last-seen) keyed by `itemKey` like `pr:acme/api#1234`. |
| `workbench_pr_state`         | Per-user PR-specific state (last reviewed at, JSON `flags`).                                                     |
| `workbench_run_pr_links`     | Cross-room links: run → PR (indexed both ways).                                                                  |
| `workbench_review_templates` | Team-saved review comment templates. Shareable to org.                                                           |
| `workbench_muted_types`      | Per-user muted card types ("error", "draft-pr", etc.).                                                           |
| `workbench_code_workspaces`  | Local filesystem workspaces registered for the Code Room (`{ label, path }`).                                    |
| `workbench_open_files`       | Per-user, per-workspace remembered open files so the Code Room can restore tabs.                                 |

We don't store PR bodies, error details, or run transcripts — those are read live from GitHub / Sentry / `run-manager` per request.

## Connections (all via shared workspace integration)

| Connection              | Required for                | v1.0?    |
| ----------------------- | --------------------------- | -------- |
| GitHub                  | Queue (PR cards), PR Room   | required |
| Local agent-native runs | Queue (run cards), Run Room | auto     |
| Sentry                  | Queue (error cards)         | optional |
| Claude Code sessions    | Run Room                    | v1.1     |

GitHub is **never** wired with its own OAuth — connect it once in Dispatch and grant it to Workbench (and Brain, Analytics, etc.). Same for Sentry. See the `external-agents` and `sharing` framework skills for the model.

## Conventions

- **TypeScript everywhere.** No `.js` or `.mjs` files.
- **Shadcn/ui only.** Use `app/components/ui/` for dialogs, popovers, dropdowns, tooltips, tabs, etc. Never build custom modals or `position: absolute` dropdowns by hand.
- **Tabler Icons only.** Never emojis as icons, never robot or sparkle icons for the agent/AI — use a message-style icon if you need an agent affordance.
- **No browser dialogs.** Use shadcn `AlertDialog` instead of `window.confirm/alert/prompt`.
- **Optimistic UI by default.** Update the React Query cache and navigate first; fire the mutation in the background; roll back in `onError`. Never block a click on a server round-trip unless the action is destructive.
- **Additive migrations only.** Never rename / drop tables or columns. Never use `drizzle-kit push`. Schema changes go through `server/plugins/db.ts`.
- **Shared workspace integrations.** Do NOT introduce a Workbench-owned OAuth flow for GitHub, Sentry, Slack, or Linear. Connect once in Dispatch and grant Workbench access.
- **No CSS transitions** beyond the shadcn defaults.
- **Keep room surfaces clean.** Progressive disclosure by default — primary action surfaced, secondary in menus / popovers / sheets. Don't pile buttons on the Queue, PR review, or Run detail surfaces.

## Application State (so the agent always knows what's on screen)

Navigation state shape — written by the UI on every route change:

```jsonc
{
  "view": "queue" | "prs" | "pr" | "runs" | "run" | "code" | "code-file" | "tools" | "tool" | "settings",
  "path": "/<current-route>",
  // PR detail:
  "owner": "acme",
  "repo": "api",
  "prNumber": 1234,
  // Run detail:
  "runId": "abc",
  // Tool detail:
  "toolId": "xyz",
}
```

To navigate the user, the agent writes the `navigate` application-state key (one-shot, auto-deleted by the UI):

```jsonc
{ "view": "pr", "owner": "acme", "repo": "api", "prNumber": 1234 }
{ "view": "run", "runId": "abc" }
{ "view": "code" }
{ "path": "/code/src/auth/refresh.ts?ws=<workspaceId>" }
{ "path": "/code/diff/src/auth/refresh.ts?ws=<workspaceId>" }
{ "view": "tools" }
{ "view": "settings" }
```

## Actions (v1.0 targets)

Actions land in follow-up agents. The PRD lists the canonical set:

- Queue — `list-attention-queue`, `snooze-queue-item`, `dismiss-queue-item`, `mark-queue-item-done`, `mute-card-type`
- PRs — `list-prs`, `inspect-pr`, `review-pr`, `summarize-pr`, `approve-pr`, `request-changes-pr`, `comment-pr`, `add-pr-inline-comment`
- Runs — `list-runs`, `inspect-run`, `resume-run`, `stop-run`
- Code — `list-code-workspaces`, `add-code-workspace`, `remove-code-workspace`, `list-files-in-workspace`, `read-file`, `write-file`, `search-files`, `git-status`, `git-changes`, `git-diff-file`, `create-pr-from-changes`
- Cross-room — `find-pr-from-run`, `find-run-that-authored-pr`
- Tools — `create-custom-tool`, `list-custom-tools` (compose with the framework `create-extension` / `update-extension` actions)
- Deep link — `open-workbench` with `{ room, provider, repo, pullRequest, runId, toolId, embed }`

Every `defineAction` is auto-mounted at `/_agent-native/actions/:name` AND exposed as an MCP tool. Distribute the MCP App via Claude Web/Desktop, ChatGPT, Cursor, Claude Code, VS Code Copilot, and Codex CLI — see the `external-agents` framework skill.

## Skills to read (framework-wide)

| Skill               | When                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `adding-a-feature`  | Adding any new room / action / page                              |
| `actions`           | Creating or modifying actions                                    |
| `storing-data`      | New tables, application-state keys                               |
| `real-time-sync`    | Wiring UI that must reflect agent mutations                      |
| `sharing`           | Per-user / per-org access on Workbench-owned resources           |
| `external-agents`   | Connecting Workbench to Claude Code, Cursor, Codex via MCP / A2A |
| `extensions`        | Custom Tools — sandboxed Alpine.js mini-apps                     |
| `onboarding`        | Setup checklist steps (`setup-workbench.ts` registers these)     |
| `frontend-design`   | Building or restyling any UI                                     |
| `shadcn-ui`         | Adding shadcn primitives, theming, motion                        |
| `portability`       | Keeping schema/SQL dialect-agnostic (Neon Postgres in prod)      |
| `delegate-to-agent` | AI work always goes through the agent chat — no inline LLM calls |

## Common Tasks

| User request                             | What to do                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "What needs my attention?"               | Open the Queue (`navigate --view=queue`) and call `list-attention-queue` (when wired).                       |
| "Show me PRs for acme/api"               | `navigate --view=prs` then call `list-prs --owner=acme --repo=api`.                                          |
| "Open PR #1234 in acme/api"              | `navigate --view=pr --owner=acme --repo=api --prNumber=1234`.                                                |
| "Approve this PR"                        | Read screen → `approve-pr --owner=… --repo=… --number=…`.                                                    |
| "Snooze this for a week"                 | `snooze-queue-item --itemKey=… --until=<iso>`.                                                               |
| "What's my agent doing right now?"       | `navigate --view=runs` then `list-runs`.                                                                     |
| "Open the Code Room"                     | `navigate --view=code`.                                                                                      |
| "Show me the diff for src/auth.ts"       | `git-diff-file --workspaceId <id> --path src/auth.ts` then `navigate --path=/code/diff/src/auth.ts?ws=<id>`. |
| "Edit src/auth.ts"                       | `navigate --path=/code/src/auth.ts?ws=<id>` then `read-file` / `write-file`.                                 |
| "Open a PR with my current changes"      | `create-pr-from-changes --workspaceId <id> --title "..."`.                                                   |
| "Build me a tool that lists flaky tests" | `create-extension` with Alpine.js HTML content. **Do NOT modify Workbench source.**                          |
| "Connect GitHub"                         | Direct the user to Dispatch's `/integrations` page; do not start a Workbench OAuth flow.                     |

After any mutation, actions are responsible for triggering UI invalidation — the `useDbSync` hook in `root.tsx` polls the standard query keys.

## Authentication

Workbench uses the framework's default auth (Better Auth, email/password + optional Google / GitHub social providers). Use `getSession(event)` server-side and `useSession()` client-side. Workbench-owned tables carry `ownableColumns()`; every read must go through `accessFilter()` or `resolveAccess()`, and every write through `assertAccess()`. Custom Nitro routes must wrap their handlers in `runWithRequestContext()` — actions auto-mounted under `/_agent-native/actions/…` get this for free.

## Development

For code editing and dev-server guidance, run `pnpm dev` from this directory (default dev port: **8104**). The framework auto-mounts `/_agent-native/*` routes and discovers files in `actions/` at build time.
