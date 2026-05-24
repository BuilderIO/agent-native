# Workbench — Product Requirements Document

> A visual command center for AI-assisted work. Runs as a standalone web app, as an MCP App inside Claude / ChatGPT / Cursor / Codex / Claude Code, and as a forkable template teams can self-host. The Attention Queue is the home; rooms (PRs, Agent Runs, Custom Tools) are the depth.

**Status:** Draft v0.2
**Owner:** Steve
**Last updated:** 2026-05-23

---

## 1. One-liner

> **Workbench is a visual command center for AI-assisted work — see what needs your attention, review PRs, monitor agent runs, and build your own mini-tools, all in one place.**

## 2. Why now

Three forcing functions in May 2026:

1. **AI agents are producing more work than humans can review.** Claude Code, Cursor, Codex, Copilot, Devin generate PRs, run tests, hit errors, and need oversight at a rate GitHub's flat list + Slack pings can't handle. The "47 PRs to review and 12 agent runs to check on" problem is real and worsening.
2. **MCP Apps spec (SEP-1865) shipped Jan 26, 2026** — Claude, ChatGPT, Cursor, VS Code all render inline UI now. Tool-only MCP servers are commoditized; visual MCP apps are where new value is being created.
3. **The MCP ecosystem is graveyard-shaped.** 52% of published servers are abandoned because they're one-off SaaS API wrappers without a real product behind them. A vendor-backed suite with a maintenance commitment will outlast the long tail.

The agent-native framework gives us shared workspace integrations, collab, sharing, real-time sync, auth, sandboxed extensions, run-manager / agent-teams, and three-surface deploy — all of which Workbench inherits for free.

## 3. Goals & non-goals

### Goals (v1)

- Best-in-class **multi-source Attention Queue** unifying PRs, agent runs, and errors that need your attention
- Best-in-class **PR review** experience that beats GitHub's UI for engineers reviewing >5 PRs/week
- First-class **agent run monitoring** — local agent-native runs in v1.0 (Claude Code session data in v1.1)
- **Custom Tools** (extensions) integrated so users can extend Workbench without forking
- Run on **three surfaces** from one codebase: standalone web app, MCP App, forkable template
- **GitHub via shared workspace integration** (no Workbench-owned OAuth) — connect once, used by Workbench + Brain + Analytics + future apps
- Compose cleanly with **existing MCP servers** (Sentry, Postgres, k8s, etc.)

### Non-goals (v1)

- ❌ Designer / PM modes — separate templates on the same chassis, later
- ❌ Replacing IDE features (in-editor edit, refactor, language-server)
- ❌ Dedicated Errors / CI / SQL / Schema / Env rooms — moved to v1.1+
- ❌ Mobile-first design — desktop-first; mobile is "view, not act"
- ❌ Replacing Sentry / Datadog / Postman / DataGrip
- ❌ GitLab / Bitbucket support (GitHub only)
- ❌ AI code generation inside diffs — agent does it via chat
- ❌ Codex / Cursor / Copilot agent-run adapters in v1.0

## 4. ICP & personas

### Primary (v1): Engineering IC overseeing AI agent work

- 5–50 PRs/week to review across 1–10 repos (many AI-authored)
- Running 2–10 agent sessions/week (Claude Code, local agent-native)
- Uses Claude Code / Cursor / Copilot / Codex daily
- Frustrated with scattered "what needs my attention" surfaces
- Open to MCP apps; already has one or two installed

### Secondary: Engineering manager / tech lead

- Monitoring direct reports' PRs and agent work
- Wants risk signals + team velocity overview
- Cares about review SLAs + stale work

### Tertiary: Solo / indie devs

- Wear all hats; want one tool to triage GitHub + agent runs + Sentry
- Strong willingness to fork and customize

### Out-of-scope personas (v1)

- PMs (separate Workbench mode later)
- Designers (separate Workbench mode later)
- Non-technical stakeholders

## 5. Differentiation

### vs. GitHub Notifications + GitHub PR review

|                      | GitHub                        | Workbench                                                  |
| -------------------- | ----------------------------- | ---------------------------------------------------------- |
| Cross-source queue   | GitHub-only notifications     | PRs + agent runs + errors in one inbox                     |
| Inbox-zero mechanics | Flat list, opaque "mark read" | Snooze / dismiss / done / mute-by-type                     |
| Multi-PR triage      | Flat list, no risk signal     | Ranked queue with AI risk badges + staleness               |
| PR summary           | None                          | AI summary card with risk, schema impact, suggested tests  |
| File tree badges     | None                          | Per-file: tests, lint, schema, secrets                     |
| Agent integration    | Bolted on (Copilot)           | Native: agent surfaces work, drafts reviews, takes actions |
| Inline-in-chat       | No                            | Yes — same UI renders in Claude / ChatGPT / Cursor         |
| Agent run visibility | None                          | First-class — runs, transcripts, blockers, artifacts       |

### vs. one-off MCP servers (GitHub MCP, Sentry MCP)

- Those expose **data**; Workbench renders **UI** + adds the unifying Queue
- Those install per-server; Workbench is one install for the whole suite
- Those work in isolation; Workbench cross-links (run → PR → review → CI)

### vs. Reviewable / Graphite / CodeRabbit

- They are PR-only; Workbench unifies review + agent monitoring + extensions
- They don't render in chat; Workbench does
- They aren't forkable or extensible by end users; Workbench is

## 6. Three surfaces, one codebase

```
┌─────────────────────────────────────────────────────────────┐
│                    templates/workbench/                      │
│  (one React app + Nitro server + actions + MCP exposure)     │
└────────┬──────────────────────┬────────────────────┬─────────┘
         │                      │                    │
         ▼                      ▼                    ▼
  Standalone web app       MCP App inside       Forkable template
  workbench.agent-         Claude / ChatGPT /    agent-native create
  native.com               Cursor / Codex /      workbench
                           Claude Code
```

## 7. Information architecture

### App shell (web + MCP)

```
┌──────────────────────────────────────────────────────────────┐
│  Workbench │ Queue │ PRs │ Runs │ Code │ Tools │  ⋯ Settings │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                     [ Room surface ]                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

In the MCP App render, the shell is hidden — only the requested room surface renders inline.

### Routes (web app)

| Route                             | Purpose                   | Room  |
| --------------------------------- | ------------------------- | ----- |
| `/`                               | Attention Queue (home)    | Queue |
| `/prs`                            | PR list (filtered view)   | PRs   |
| `/prs/:owner/:repo/:n`            | Single PR review          | PRs   |
| `/runs`                           | Agent runs list           | Runs  |
| `/runs/:id`                       | Single run inspector      | Runs  |
| `/code`                           | Code Room welcome view    | Code  |
| `/code/<relative-file-path>`      | Open file in editor       | Code  |
| `/code/diff/<relative-file-path>` | Open file in diff viewer  | Code  |
| `/extensions`                     | Custom tools (extensions) | Tools |
| `/extensions/:id`                 | Single custom tool        | Tools |
| `/settings`                       | Connections + preferences | —     |
| `/onboarding`                     | First-run setup           | —     |

## 8. Rooms spec

### 8.1 Attention Queue (HOME)

The unifying view. First thing you see. The single place where "what needs my attention right now?" is answered across all connected sources.

#### Card types in v1.0

| Card type                                     | Source                       | Example                                                                  |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| **PR to review**                              | GitHub (shared integration)  | "sarah-dev opened #1234 in acme/api — 3d ago — 🔴 HIGH RISK"             |
| **My PR with status change**                  | GitHub                       | "Your PR #1199 in acme/web has 2 new comments"                           |
| **My PR with CI failure**                     | GitHub Actions               | "CI failed on #1199 — 2 jobs red"                                        |
| **Agent run needing input**                   | Local agent-native runs      | "Run #abc paused — agent asked you a question"                           |
| **New error in prod** _(if Sentry connected)_ | Sentry workspace integration | "New unhandled error in payment-svc — 14 users affected, started 2h ago" |

#### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Workbench │ Queue │ PRs │ Runs │ Tools │              [Settings] │
├──────────────────────────────────────────────────────────────────┤
│ Inbox · 12 items                              [Filter ▾] [⚙]    │
│ ────────────────────────────────────────────────────────────────│
│ ╭─ 🔴 PR · 3d old ─────────────────────────────────────────╮   │
│ │ acme/api #1234 — Auth refresh token rotation              │   │
│ │ sarah-dev · 12 files · ❌ CI failed                       │   │
│ │ Adds OAuth refresh. Touches users table.                  │   │
│ │ [Review]  [Snooze ▾]  [Dismiss]                            │   │
│ ╰────────────────────────────────────────────────────────────╯   │
│ ╭─ 🟡 Run · paused 4m ago ──────────────────────────────────╮   │
│ │ Local run · "fix mail attachment bug"                     │   │
│ │ Agent is asking: "Found two candidate files..."            │   │
│ │ [Open Run]  [Snooze ▾]                                     │   │
│ ╰────────────────────────────────────────────────────────────╯   │
│ ╭─ 🔴 Error · started 2h ago · 14 users ───────────────────╮   │
│ │ payment-svc · TypeError: cannot read property 'id'        │   │
│ │ at processCharge (payment.ts:142)                         │   │
│ │ [Open in Sentry]  [Snooze ▾]  [Dismiss]                    │   │
│ ╰────────────────────────────────────────────────────────────╯   │
└──────────────────────────────────────────────────────────────────┘
```

#### Inbox-zero mechanics

- **Read state**: items marked read on view, dismissed explicitly, or auto-snoozed
- **Snooze**: until tomorrow / next week / specific date / specific event (e.g. "until CI passes")
- **Dismiss**: hide permanently
- **Done**: hide once you've taken the action
- **Mute type**: don't show this card type for me anymore
- **Filter**: by type, repo, age, risk
- **Sort**: priority (default), oldest, newest, risk

#### Empty state

"🟢 Inbox zero. Nothing needs your attention right now." + link to "Configure repos / sources" if none added.

#### Actions

| Action                 | Tool? | Renders UI?  |
| ---------------------- | ----- | ------------ |
| `list-attention-queue` | ✓     | Queue widget |
| `snooze-queue-item`    | ✓     | Toast        |
| `dismiss-queue-item`   | ✓     | Toast        |
| `mark-queue-item-done` | ✓     | Toast        |
| `mute-card-type`       | ✓     | Toast        |

### 8.2 PR Room

The deep PR review experience. The standalone-app wedge — competitive with Reviewable / Graphite for engineers reviewing >5 PRs/week.

#### List page (`/prs`)

Same card pattern as Attention Queue, filtered to PR items, with multi-select for bulk actions ("approve all green-CI PRs by trusted authors", "snooze all draft PRs").

#### Single PR (`/prs/:owner/:repo/:n`)

**Header:** PR title, #number, status pill, author, base/head branches, "Open in GitHub"

**AI summary card** (collapsible, expanded by default):

- What changed
- Risk areas
- Suggested tests
- Related issues/PRs

**Three-column body:**

Left rail (resizable, 240px default): file tree with per-file badges (✓ tests, ⚠ lint, 🔒 secrets, 📋 schema). Click file → scroll diff.

Center (flex): Monaco diff viewer. Split view default; toggle to unified. Hunk-level action buttons. Inline comment threads.

Right rail (resizable, 320px default): tabs

- **Conversation** — threaded comments
- **Checks** — CI runs with status + expandable logs (v1.1)
- **Sentry** — errors touching modified files (v1.1)
- **Related** — linked issues, related PRs, **Linked Run** card if a `workbench_run_pr_links` row matches

**Bottom sticky action bar:**

```
○ Comment  ● Approve  ○ Request changes
[Optional message...] [Template ▾]                  [Submit review]
```

#### Linked Run card (cross-room magic)

If the PR was authored by an agent run Workbench knows about, the right rail shows a "Linked Run" card with click-through to the Run Room.

#### Actions

| Action                      | Tool? | Renders UI?          |
| --------------------------- | ----- | -------------------- |
| `list-prs`                  | ✓     | List widget          |
| `inspect-pr`                | ✓     | PR widget (compact)  |
| `review-pr`                 | ✓     | Full review widget   |
| `summarize-pr`              | ✓     | Summary card         |
| `approve-pr`                | ✓     | Toast                |
| `request-changes-pr`        | ✓     | Toast                |
| `comment-pr`                | ✓     | Toast                |
| `add-pr-inline-comment`     | ✓     | Toast                |
| `find-run-that-authored-pr` | ✓     | Run widget (compact) |

### 8.3 Run Room (NEW)

Monitor AI agent runs. v1.0 covers local agent-native runs (from framework `run-manager` tables). Claude Code session parsing lands in v1.1.

#### List page (`/runs`)

```
┌──────────────────────────────────────────────────────────────────┐
│ Workbench │ Queue │ PRs │ Runs │ Tools │              [Settings] │
├──────────────────────────────────────────────────────────────────┤
│ Runs · 8 active · 32 recent                  [Filter ▾] [⚙]    │
│ ────────────────────────────────────────────────────────────────│
│ ╭─ 🟡 Paused · 4m ago ──────────────────────────────────────╮   │
│ │ "fix mail attachment bug"                                  │   │
│ │ Asked: "Found two candidate files..."                      │   │
│ │ [Open]  [Resume with answer]                               │   │
│ ╰────────────────────────────────────────────────────────────╯   │
│ ╭─ 🟢 Running · 1h elapsed ─────────────────────────────────╮   │
│ │ "refactor analytics post-events for v2 schema"            │   │
│ │ 12 tool calls · 4 files touched · no errors               │   │
│ │ [Open]  [Stop]                                             │   │
│ ╰────────────────────────────────────────────────────────────╯   │
└──────────────────────────────────────────────────────────────────┘
```

#### Single run (`/runs/:id`)

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Back to runs                                                    │
│ Run #abc · "fix mail attachment bug" · 🟡 Paused                  │
├──────────────────────────────────────────────────────────────────┤
│ ┌─ Summary ──────────────────────────────────────────────┐       │
│ │ Started 14m ago · agent-native local · 8 tool calls    │       │
│ │ Touched: templates/mail/actions/send-email.ts          │       │
│ │ Current blocker: agent is asking about file ambiguity  │       │
│ └────────────────────────────────────────────────────────┘       │
├──────────────────┬───────────────────────────────────────────────┤
│ Transcript       │ Touched files (4)                              │
│                  │                                                │
│ 🤖 Looking at... │ templates/mail/actions/send-email.ts  +12 -2   │
│ 🛠 ReadFile...   │ templates/mail/actions/draft-email.ts +5  -1   │
│ 🤖 I see the...  │ templates/mail/components/attach.tsx  +18 -0   │
│ ❓ Found two...  │                                                │
│                  │ Artifacts (2)                                  │
│                  │ test-output.log                                │
│                  │ screenshot-after.png                           │
└──────────────────┴───────────────────────────────────────────────┘
```

#### Linked PR card (cross-room magic)

If the run produced a PR Workbench knows about, the right rail shows a "Linked PR" card with click-through to the PR Room.

#### Actions

| Action             | Tool? | Renders UI?         |
| ------------------ | ----- | ------------------- |
| `list-runs`        | ✓     | List widget         |
| `inspect-run`      | ✓     | Run detail widget   |
| `resume-run`       | ✓     | Toast               |
| `stop-run`         | ✓     | Toast               |
| `find-pr-from-run` | ✓     | PR widget (compact) |

### 8.4 Custom Tools

Extensions, rendered inside the Workbench shell. Visible nav item, not the headline, but the unique-to-Workbench customization moat.

#### List page (`/extensions`)

Grid of user's tools (your own + shared by org). "+ New tool" CTA opens the agent sidebar with a scaffold prompt ("Build me a tool that…").

#### Detail (`/extensions/:id`)

Tool rendered in iframe inside Workbench chrome. Edit / share / delete from header. Uses the existing extensions system as-is.

#### Pitch

> Don't see what you need? Ask the agent — it'll build you one. No fork, no PR, no deploy. Persistent to your org, scoped per user, shareable.

### 8.5 Code Room (NEW)

A mini IDE inside Workbench — bring IDE features into your chat agent. The
user picks a local filesystem workspace and we render a VS Code-style
shell: activity bar on the left edge, sidebar panels, file tabs, a
Monaco editor / diff viewer in the center, and a one-click
"commit + push + open PR" flow on the Source Control panel.

The Code Room composes cleanly with the rest of Workbench: changes
opened from the Code Room flow into the PR Room via the same shared
GitHub integration, runs the agent kicks off can edit files in the
same workspace, and the Cmd+P palette is the agent's quickest
"open this file" path back from chat.

#### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Workbench │ Queue │ PRs │ Runs │ Code │ Tools │       Settings   │
├──┬───────────────┬───────────────────────────────────────────────┤
│📁│ Workspace ▾  │ ▼ file1.ts [×] file2.ts [×] file3.tsx [×]    │
│Δ │  Explorer    ├───────────────────────────────────────────────┤
│🔍│  ─ src       │                                                │
│⌥ │    ├ auth/   │                                                │
│  │    │  └ ...  │       Monaco Editor                            │
│  │    ├ db/     │       (file edit or diff view)                 │
│  │    └ ...     │                                                │
│  │   package... │                                                │
│⚙ │               │       Status bar: branch · path                │
└──┴───────────────┴───────────────────────────────────────────────┘
```

- **Activity bar** (48px) — Explorer / Changes / Search / Source Control,
  with a Settings gear at the bottom that swaps the sidebar to the
  workspace manager.
- **Sidebar** (280px) — content per activity. Explorer is a lazy file
  tree; Changes is grouped staged / unstaged / untracked; Search is a
  debounced substring search; Source Control surfaces the current
  branch + "Create PR" button.
- **Editor area** — file tabs at the top, Monaco editor (or
  `<DiffEditor>` when the URL is `/code/diff/...`) below, status bar
  with workspace label + file path at the bottom.
- **Cmd+K / Cmd+P** opens the command palette — a `cmdk`-powered fuzzy
  file switcher that also falls back to server-side substring search
  for deep paths past the eagerly-loaded tree.

#### Tables

| Table                       | Purpose                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `workbench_code_workspaces` | Per-user list of registered absolute paths + friendly labels.      |
| `workbench_open_files`      | Per-user, per-workspace remembered open tabs (restored on reload). |

#### Server lib

| Module                         | Owns                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| `server/lib/code-workspace.ts` | Resolve workspace by id + per-user scope; `assertPathInWorkspace` guard. |
| `server/lib/file-ops.ts`       | fs reads / writes / lists / search, gated by `assertPathInWorkspace`.    |
| `server/lib/git-ops.ts`        | simple-git wrappers: status, diff, commit, push, GitHub remote parsing.  |

Every fs and git operation roots itself at the workspace's absolute path
and funnels through `assertPathInWorkspace` — no path supplied by the
client can escape the workspace via `..`.

#### Actions

| Action                    | Tool? | Renders UI?            |
| ------------------------- | ----- | ---------------------- |
| `list-code-workspaces`    | ✓     | Workspace picker       |
| `add-code-workspace`      | ✓     | Toast                  |
| `remove-code-workspace`   | ✓     | Toast                  |
| `list-files-in-workspace` | ✓     | Explorer panel         |
| `read-file`               | ✓     | Editor pane            |
| `write-file`              | ✓     | Toast                  |
| `search-files`            | ✓     | Search panel + palette |
| `git-status`              | ✓     | Status bar             |
| `git-changes`             | ✓     | Changes panel          |
| `git-diff-file`           | ✓     | Diff editor            |
| `create-pr-from-changes`  | ✓     | PR dialog              |

The PR creation flow uses the shared workspace GitHub integration —
Workbench never carries a GitHub OAuth flow of its own (per the
broader connections model in §9).

### 8.6 v1.1+ roadmap

Rooms that earned consideration but didn't make MVP:

- **Errors Room** — dedicated Sentry-style error inbox + stack trace inspector (errors appear as Queue cards in v1.0)
- **CI Room** — dedicated runs / DAG / job log view (CI status in Queue + PR Room in v1.0)
- **SQL Room** — query workbench with EXPLAIN visualizer
- **Schema Room** — ERD browser + migration diff
- **Env Room** — masked env vars manager
- **Codex / Cursor / Copilot run adapters** — for the Run Room
- **Claude Code session adapter** — for the Run Room
- **Slack integration** — mentions and feedback in the Queue
- **GitLab / Bitbucket** — additional Git hosts
- **Linear ↔ PR linking**
- **AI risk badges** — model-based scoring on top of v1 heuristics
- **Code Room — GitHub-remote browsing** (read from a remote repo without a local clone)
- **Code Room — live collaborative editing** (Yjs multi-cursor)
- **Code Room — terminal panel**
- **Code Room — language servers / type checking** (Monaco gets built-in highlighting in v1)

## 9. Connections

**All via the framework's shared workspace integration model** — no Workbench-owned OAuth. Connect a provider once (in Dispatch) and grant it to Workbench (and Brain, Analytics, etc.) as needed.

| Connection              | Required for                | Source                                  | v1.0?        |
| ----------------------- | --------------------------- | --------------------------------------- | ------------ |
| GitHub                  | Queue (PR cards), PR Room   | Shared workspace integration            | **Required** |
| Local agent-native runs | Queue (run cards), Run Room | Framework `run-manager` SQL tables      | **Auto**     |
| Sentry                  | Queue (error cards)         | Shared workspace integration (existing) | **Optional** |
| Claude Code sessions    | Run Room                    | Local `~/.claude` session files         | v1.1         |
| Slack                   | Queue (mentions)            | Shared workspace integration            | v1.1+        |
| Linear                  | PR ↔ Issue links            | Shared workspace integration            | v1.1+        |

Onboarding flow:

1. Sign in → Workbench loads
2. Onboarding checklist: ✓ Connect GitHub (via Dispatch shared integration), ◯ Add repos to queue, ◯ Connect Sentry (optional), ◯ Try Custom Tools (optional)
3. User connects GitHub + adds first repo → queue populates → first-user-moment achieved

## 10. Data model

All in SQL (Drizzle) per framework convention. Per-user / per-org scoped using `ownableColumns()` + `createSharesTable()`.

### New tables

| Table                        | Purpose                                                             | Scoping                    |
| ---------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `workbench_repos`            | Repos added to the queue                                            | ownable                    |
| `workbench_queue_state`      | Per-user per-item state (snoozed-until, dismissed, done, last-seen) | ownable                    |
| `workbench_pr_state`         | Per-user PR-specific state (last reviewed at, custom flags)         | ownable                    |
| `workbench_run_pr_links`     | Cross-room links: run → PR                                          | ownable, indexed both ways |
| `workbench_review_templates` | Team-saved review comment templates                                 | ownable, shareable to org  |
| `workbench_muted_types`      | Per-user muted card types                                           | ownable                    |

### Existing tables we leverage

- `extensions` / `extension_data` / `extension_shares` — Custom Tools
- `application_state` — ephemeral UI state
- Framework auth tables
- Sentry workspace integration tables (existing)
- `run-manager` tables (existing) — agent run data
- Shared workspace integrations tables (existing) — GitHub / Sentry / Slack tokens

### What we don't store

- PR content (always fetched live from GitHub; cached in memory only)
- Error details (fetched live from Sentry workspace integration)
- Run transcripts (read live from run-manager)

## 11. MCP exposure

Per the framework's standard pattern: every action defined with `defineAction` is auto-mounted at `/_agent-native/actions/:name` AND exposed as an MCP tool.

### Named tools (v1.0)

- `list-attention-queue`
- `snooze-queue-item` / `dismiss-queue-item` / `mark-queue-item-done`
- `list-prs` / `inspect-pr` / `review-pr` / `summarize-pr` / `approve-pr` / `request-changes-pr` / `comment-pr`
- `list-runs` / `inspect-run` / `resume-run` / `stop-run`
- `find-pr-from-run` / `find-run-that-authored-pr`
- `create-custom-tool` / `list-custom-tools`

### Catch-all deep link

`open-workbench` with optional params:

```json
{
  "room": "queue" | "prs" | "runs" | "tools",
  "provider": "github",
  "repo": "owner/repo",
  "pullRequest": 123,
  "runId": "abc",
  "toolId": "xyz",
  "embed": true
}
```

### Compact vs full render

- **Compact in chat**: Queue widget shows 5–10 cards; PR widget shows summary + file tree + first file diff; Run widget shows summary + transcript snippet
- **Full in standalone**: "Open in Workbench" deep link opens the rich web app

### Distribution

| Surface              | How users get it                         |
| -------------------- | ---------------------------------------- |
| Claude Web + Desktop | Add via Connectors panel                 |
| ChatGPT              | Via OpenAI Apps Directory                |
| Cursor               | `.cursor/mcp.json` snippet from Settings |
| Claude Code          | `claude mcp add` snippet from Settings   |
| VS Code (Copilot)    | MCP config snippet                       |
| Codex CLI            | MCP config snippet                       |

## 12. Customization model

### Hard custom (fork)

```
agent-native create workbench acme-workbench
cd acme-workbench
# edit templates/workbench/...
pnpm deploy
```

### Soft custom (Custom Tools, no fork)

End users prompt the agent inside Workbench:

- "Add a tool that pulls my Linear sprint as a kanban"
- "Add a tool that shows our top 10 slowest endpoints from Datadog"
- "Add a tool that lists all flaky tests this week"

The agent calls `create-extension`. Tool appears in `/extensions` scoped to user/org. **No new code, no PR, no deploy.**

## 13. Success metrics

### v1 launch criteria

- ✅ Sign in with GitHub via shared workspace integration; list real PRs in ≤2s
- ✅ Queue page renders with real PR + Run + (if Sentry connected) Error cards
- ✅ Review a real PR end-to-end (open, diff, stamp approve, syncs to GitHub)
- ✅ Run Room shows real local agent-native runs
- ✅ Custom Tools room works (create / view / share)
- ✅ Works as standalone web app
- ✅ Works as MCP App in Claude Desktop with widget rendering
- ✅ Works as MCP App in Claude Code with widget rendering
- ✅ Forkable via `agent-native create workbench`
- ✅ Onboarding completes in <2 minutes

### Activation signals (first 4 weeks)

- % of installs that reach "first queue item actioned" within 24h (target: >60%)
- Avg queue items actioned per user per week (target: >10)
- % of users who connect ≥1 optional source in first week (target: >25%)
- % of users who create ≥1 custom tool in first month (target: >10%)

### Retention signals (first 8 weeks)

- W4 retention of weekly active users (target: >45%)
- Avg sessions/week for active users (target: >4)
- NPS at 30 days (target: >40)

## 14. Out of scope for v1

- ❌ GitLab / Bitbucket / Gitea
- ❌ Self-hosted enterprise
- ❌ AI code generation inside diffs
- ❌ Code search / grep across repos
- ❌ Profiler / flame graphs
- ❌ K8s / Terraform / Docker tools
- ❌ Mobile-optimized layout
- ❌ Real-time multi-reviewer cursors in PR review
- ❌ Pricing / billing
- ❌ Workbench-for-PM / Workbench-for-Designer
- ❌ Errors / CI / SQL / Schema / Env dedicated rooms (v1.1+)
- ❌ Slack mentions in Queue (v1.1+)
- ❌ Codex / Cursor / Copilot / Claude Code run adapters (v1.1+)

## 15. Build milestones

### Milestone 0 — Spec & scaffold

- [x] PRD v0.2 written
- [ ] Scaffold `templates/workbench/` with framework default + room route stubs
- [ ] Empty shell renders (top nav, agent sidebar, four room tabs)
- [ ] Register as **hidden** template in `packages/shared-app-config/templates.ts`

### Milestone 1 — Shared workspace GitHub integration

- [ ] Wire GitHub via shared workspace integration (not own OAuth)
- [ ] Settings page showing connection status + "connect via Dispatch" CTA when not connected
- [ ] `workbench_repos` table + UI for adding repos

### Milestone 2 — Attention Queue (home)

- [ ] `workbench_queue_state` + `workbench_muted_types` tables + actions
- [ ] `list-attention-queue` action — aggregates PRs (GitHub) + runs (local) + errors (Sentry if connected)
- [ ] Queue page with card rendering by type
- [ ] Snooze / dismiss / done / mute mechanics

### Milestone 3 — PR Room

- [ ] `inspect-pr` / `review-pr` actions
- [ ] PR list page (filtered queue view)
- [ ] Single PR page with file tree + Monaco diff + right rail (Conversation tab first)
- [ ] `approve-pr` / `request-changes-pr` / `comment-pr` → sync to GitHub
- [ ] Review templates (per-user defaults)

### Milestone 4 — Run Room

- [ ] `list-runs` / `inspect-run` actions reading from `run-manager` tables
- [ ] Run list + single run pages
- [ ] `resume-run` / `stop-run` actions
- [ ] Cross-room links (Run ↔ PR)

### Milestone 5 — Custom Tools

- [ ] `/extensions` and `/extensions/:id` routes mounting existing extensions system
- [ ] "+ New tool" CTA → agent chat
- [ ] Visible nav slot

### Milestone 5b — Code Room (Mini IDE)

- [ ] `workbench_code_workspaces` + `workbench_open_files` tables
- [ ] `list-code-workspaces` / `add-code-workspace` / `remove-code-workspace` actions
- [ ] `list-files-in-workspace` / `read-file` / `write-file` / `search-files` actions
- [ ] `git-status` / `git-changes` / `git-diff-file` / `create-pr-from-changes` actions
- [ ] `server/lib/code-workspace.ts` (resolver + `assertPathInWorkspace` guard)
- [ ] `server/lib/file-ops.ts` (fs ops gated through the guard)
- [ ] `server/lib/git-ops.ts` (simple-git wrappers, GitHub remote parsing)
- [ ] `/code` + `/code/$` routes
- [ ] Activity bar, Explorer, Changes, Search, Source Control, Settings panels
- [ ] Monaco editor pane (lazy-loaded) + Monaco DiffEditor pane
- [ ] File tabs + Cmd+P command palette
- [ ] Create-PR dialog wired through the shared GitHub integration

### Milestone 6 — MCP App registration

- [ ] Declare UI resources for hero widgets per SEP-1865
- [ ] Test in Claude Desktop, Claude Code, ChatGPT, Cursor
- [ ] Install snippets in Settings page

### Milestone 7 — AI summarization & marketing

- [ ] `summarize-pr` action via delegate-to-agent pattern
- [ ] Risk classifier (heuristic v1)
- [ ] Public landing at `workbench.agent-native.com`
- [ ] Per-room docs, install snippets per host, showcase video

### Suggested v1.0 cut

Milestones 0–6. AI summarization and marketing land in v1.1.

## 16. Risks

| Risk                                                    | Mitigation                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub API rate limits                                  | Per-user GitHub OAuth (5000 req/hr/user); aggressive caching with ETag; lazy-load PR details          |
| MCP App spec churns                                     | Track SEP-1865 closely; framework abstraction layer                                                   |
| AI summary cost at scale                                | Cache per-PR-SHA; only re-summarize on new commits                                                    |
| Sentry-MCP regressions                                  | Test in CI; fallback to direct Sentry API token                                                       |
| Cursor doesn't render MCP App UI                        | Track Cursor support; fallback to "Open in Workbench" deep link                                       |
| Cross-room linking accuracy                             | Only link via explicit signals (commit SHA match); don't infer from titles                            |
| Queue noise without good defaults                       | Smart defaults (mute closed PRs, mute resolved errors), strong filter UX, mute-type as core primitive |
| Reviewable / Graphite / CodeRabbit compete on PR review | Differentiator: agent integration + MCP-inline + multi-room suite + forkability                       |
| GitHub ships better review UI                           | Our chat-inline + agent integration + cross-source queue remain unique                                |
| Users don't trust AI summaries on PRs                   | Make them transparent (show source files used); dismissible; opt-out per repo                         |

## 17. Open questions

1. Web app domain — subdomain vs path vs own brand
2. Pricing model — free in v1, beyond TBD
3. AI summary cost — user's connected provider vs hosted
4. Risk badges — heuristic v1 / model v1.5
5. Queue scoping — per-user only v1, org-shared "team queue" v1.5?
6. GHE support — defer to v1.5
7. PR inline render mode — compact v1, full opt-in
8. Custom tools surface — top-level only v1, section drop-ins v2
9. PM/Designer modes — separate templates or modes
10. OSS license — same as framework
11. Run Room adapters — how community-extensible should the adapter pattern be in v1?
12. Sentry in Queue — via existing workspace integration or require explicit per-Workbench grant?

## 18. Inspirational references

- **GitHub Notifications** — what Queue should beat
- **Reviewable.io** — multi-file PR review
- **Graphite** — stacked PR + multi-PR queue
- **CodeRabbit** — AI summary card pattern
- **GitHub Files Changed** — Monaco diff + comments
- **Linear inbox** — inbox-zero mechanics done right
- **Superhuman inbox** — keyboard-first inbox actions
- **Tredict MCP App** — domain widget rendered inline
- **OpenAI Apps SDK Zillow demo** — filterable list from chat

## 19. Glossary

- **MCP** — Model Context Protocol
- **MCP App** — MCP server that declares UI resources rendered inline by the host (SEP-1865)
- **Host** — the app rendering the UI (Claude Desktop, ChatGPT, Cursor, Claude Code)
- **Room** — a major surface in Workbench (Queue, PRs, Runs, Tools)
- **Card** — a single item in the Attention Queue
- **Shared workspace integration** — the framework's primitive for connecting providers once and granting them to multiple apps
- **Run** — an AI agent session
- **Cross-room link** — relation between data in different rooms (e.g. Run ↔ PR)

---

_End of PRD v0.2. Edits welcome — this is a living doc._
