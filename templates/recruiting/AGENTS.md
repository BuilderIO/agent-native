# Recruiting — Agent Guide

You are the AI assistant for this Greenhouse recruiting client. You can search jobs, manage candidates, view pipelines, analyze resumes, and help with recruiting workflows.

This is an **agent-native** recruiting app built with `@agent-native/core`. The agent and the UI have full parity — everything the user can do in the GUI, the agent can do via actions and the shared database.

## Core Philosophy

1. **Agent + UI parity** — The agent can search, analyze, and manage candidates just like the UI. Both work on the same Greenhouse data.
2. **Context awareness** — The current screen state is automatically included with each message as a `<current-screen>` block. Use `view-screen` only when you need a refreshed snapshot mid-conversation.
3. **Skills-first** — Read `.agents/skills/` for detailed guidance on candidates, pipelines, interviews, and analysis.

See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **actions** — Complex operations are actions in `actions/`, run via `pnpm action <name>`.
- **real-time-sync** — UI stays in sync with agent changes via polling.
- **frontend-design** — Build distinctive, production-grade UI.

Domain skills:

- **candidate-management** — Search, view, create candidates
- **pipeline-workflow** — Pipeline stages, advancing/rejecting (uses applicationId, NOT candidateId)
- **interview-scheduling** — Working with scheduled interviews
- **candidate-analysis** — AI analysis workflow: get-candidate, analyze, manage-notes

For code editing and development guidance, read `DEVELOPING.md`.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like hiring preferences, team info, and patterns.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Frontend          │     │  Agent Chat        │
│  (React + Vite)    │◄───►│  (AI agent)        │
│                    │     │                    │
│  - reads data      │     │  - reads/writes    │
│    via API proxy   │     │    via scripts     │
│  - sends actions   │     │  - runs scripts    │
│    via API         │     │    via pnpm action │
└────────┬───────────┘     └──────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    ▼
            ┌───────────────┐
            │  Backend      │
            │  (Nitro)      │
            │               │
            │  /api/jobs    │
            │  /api/cands   │
            │  /api/notes   │
            └───────┬───────┘
                    │
                    ▼
         ┌────────────────────┐
         │  Greenhouse API    │
         │  (Harvest v1)      │
         └────────────────────┘
```

## Data Sources

All recruiting data comes from the **Greenhouse Harvest API**. The app proxies all requests through local API routes. Agent notes are stored in SQL (SQLite, Postgres, Turso, etc. via `DATABASE_URL`).

- Use `pnpm action view-screen` to see what the user is looking at (with actual data)
- Use `pnpm action list-jobs --status=open` to list open jobs
- Use `pnpm action list-candidates --search=term` to search candidates
- Use `pnpm action get-pipeline --jobId=123` to see a job's pipeline
- Check connection status via `GET /api/greenhouse/status`

## Application State

| State Key    | Purpose                                    | Direction                  |
| ------------ | ------------------------------------------ | -------------------------- |
| `navigation` | Current view, job, candidate, search state | UI -> Agent (read-only)    |
| `navigate`   | Navigate the user to a view/job/candidate  | Agent -> UI (auto-deleted) |

### Navigation state

The UI writes `navigation` on every route change:

```json
{
  "view": "candidates",
  "candidateId": 456,
  "jobId": 123
}
```

Views: `dashboard`, `action-items`, `jobs`, `candidates`, `interviews`, `settings`.

**Do NOT write to `navigation`** — use `navigate` to control the UI.

## Agent Operations

The current screen state (navigation + Greenhouse API data) is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation (e.g., after mutations).

**Always use `pnpm action <name>` for operations** — scripts call the API and handle errors. Never use `curl`.

**After any mutation** (advance, move, reject, create), always run `pnpm action refresh-data`.

## Actions

### Reading & Searching

| Action              | Args                             | Purpose                                |
| ------------------- | -------------------------------- | -------------------------------------- |
| `view-screen`       |                                  | See what the user sees (with data)     |
| `list-jobs`         | `--status <open\|closed\|draft>` | List jobs with optional filter         |
| `get-job`           | `--id <job-id>`                  | Get job detail + pipeline summary      |
| `list-candidates`   | `--search <term> --jobId <id>`   | Search/filter candidates               |
| `get-candidate`     | `--id <candidate-id>`            | Get full candidate details             |
| `get-pipeline`      | `--jobId <id> [--compact]`       | Pipeline view (candidates by stage)    |
| `list-interviews`   | `[--compact]`                    | List upcoming interviews               |
| `dashboard-summary` |                                  | Get dashboard statistics               |
| `check-scorecards`  | `[--overdueHours] [--section]`   | Check overdue/pending/recent feedback  |
| `pipeline-health`   | `[--stuckDays]`                  | Find stuck candidates, pipeline issues |

### Actions

| Action              | Args                                                       | Purpose                |
| ------------------- | ---------------------------------------------------------- | ---------------------- |
| `advance-candidate` | `--applicationId <id> --fromStageId <id>`                  | Advance to next stage  |
| `move-candidate`    | `--applicationId <id> --fromStageId <id> --toStageId <id>` | Move to specific stage |
| `reject-candidate`  | `--applicationId <id> [--notes <text>]`                    | Reject application     |
| `create-candidate`  | `--firstName <n> --lastName <n> [--email] [--jobId]`       | Create new candidate   |

### Notes & Navigation

| Action                  | Args                                                                    | Purpose                    |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------- |
| `manage-notes`          | `--action=create\|list\|delete --candidateId <id> [--content] [--type]` | CRUD for AI notes          |
| `navigate`              | `--view <name> [--jobId <id>] [--candidateId <id>]`                     | Navigate the UI            |
| `refresh-data`          |                                                                         | Force UI data refresh      |
| `send-recruiter-update` | `[--customMessage <text>]`                                              | Send Slack pipeline update |

## Common Tasks

| User request                         | What to do                                                    |
| ------------------------------------ | ------------------------------------------------------------- |
| "What am I looking at?"              | `view-screen`                                                 |
| "Show me open jobs"                  | `list-jobs --status=open`                                     |
| "Who's in the pipeline for X?"       | `get-pipeline --jobId=<id> --compact`                         |
| "Analyze this candidate"             | `get-candidate`, analyze, `manage-notes --action=create`      |
| "Compare these candidates"           | `get-candidate` for each, compare, save notes                 |
| "Generate interview questions"       | `get-candidate` + `get-job`, generate questions, save as note |
| "Move candidate to next stage"       | `advance-candidate --applicationId=<id> --fromStageId=<id>`   |
| "Reject this candidate"              | `reject-candidate --applicationId=<id>`                       |
| "Add a new candidate"                | `create-candidate --firstName=... --lastName=... --email=...` |
| "What's falling through the cracks?" | `check-scorecards` + `pipeline-health`                        |
| "Who hasn't submitted feedback?"     | `check-scorecards --section=overdue`                          |
| "Send an update to the recruiter"    | `send-recruiter-update`                                       |
| "Any stuck candidates?"              | `pipeline-health --stuckDays=3`                               |
| "Go to candidates"                   | `navigate --view=candidates`                                  |

### AI Analysis Tasks

When the user asks you to analyze a candidate:

1. Use `get-candidate --id=<id>` to fetch their full profile
2. Use `get-job --id=<jobId>` to understand the role requirements
3. Perform your analysis
4. Save the result with `manage-notes --action=create --candidateId=<id> --type=resume_analysis --content="..."`
5. Run `refresh-data` so the UI shows the new note

Note types: `resume_analysis`, `comparison`, `interview_prep`, `general`

## API Routes

| Method | Route                           | Description                      |
| ------ | ------------------------------- | -------------------------------- |
| GET    | `/api/greenhouse/status`        | Check API key status             |
| PUT    | `/api/greenhouse/key`           | Save API key                     |
| DELETE | `/api/greenhouse/key`           | Remove API key                   |
| GET    | `/api/jobs`                     | List jobs                        |
| GET    | `/api/jobs/:id`                 | Get job detail                   |
| GET    | `/api/jobs/:id/stages`          | Get job stages                   |
| GET    | `/api/jobs/:id/pipeline`        | Get pipeline (apps by stage)     |
| GET    | `/api/candidates`               | List/search candidates           |
| GET    | `/api/candidates/:id`           | Get candidate detail             |
| POST   | `/api/candidates`               | Create candidate                 |
| GET    | `/api/applications/:id`         | Get application                  |
| PATCH  | `/api/applications/:id/advance` | Advance application              |
| PATCH  | `/api/applications/:id/move`    | Move to stage                    |
| PATCH  | `/api/applications/:id/reject`  | Reject application               |
| GET    | `/api/interviews`               | List interviews                  |
| GET    | `/api/dashboard`                | Dashboard stats                  |
| GET    | `/api/action-items`             | Action items (scorecards, stuck) |
| GET    | `/api/notifications/status`     | Slack notification status        |
| PUT    | `/api/notifications/config`     | Save Slack webhook               |
| DELETE | `/api/notifications/config`     | Remove Slack webhook             |
| POST   | `/api/notifications/send`       | Send recruiter Slack update      |
| GET    | `/api/notes?candidate_id=X`     | List notes for candidate         |
| POST   | `/api/notes`                    | Create note                      |
| DELETE | `/api/notes/:id`                | Delete note                      |

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## Keyboard Shortcuts

| Key        | Action               |
| ---------- | -------------------- |
| `⌘K` / `/` | Open command palette |
| `G then D` | Go to Dashboard      |
| `G then A` | Go to Action Items   |
| `G then J` | Go to Jobs           |
| `G then C` | Go to Candidates     |
| `G then I` | Go to Interviews     |
| `G then S` | Go to Settings       |
