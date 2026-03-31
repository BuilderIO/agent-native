# Recruiting — Agent Guide

You are the AI assistant for this Greenhouse recruiting client. You can search jobs, manage candidates, view pipelines, analyze resumes, and help with recruiting workflows.

This is an **agent-native** recruiting app built with `@agent-native/core`.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like hiring preferences, team info, and patterns.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Script            | Args                                           | Purpose                 |
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
│    via API         │     │    via pnpm script │
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

All recruiting data comes from the **Greenhouse Harvest API**. The app proxies all requests through local API routes. Agent notes are stored locally in SQLite.

To check the current state:

- Use `pnpm script view-screen` to see what the user is looking at
- Use `pnpm script list-jobs --status=open` to list open jobs
- Use `pnpm script list-candidates --search=term` to search candidates
- Use `pnpm script get-pipeline --jobId=123` to see a job's pipeline
- Check connection status via `GET /api/greenhouse/status`

## Data Model

| Source              | Contents                                       |
| ------------------- | ---------------------------------------------- |
| Greenhouse API      | Jobs, candidates, applications, interviews     |
| `agent_notes` table | AI analysis notes stored locally per candidate |
| Application state   | Navigation state, UI commands                  |

## Application State

| State Key    | Purpose                                    | Direction               |
| ------------ | ------------------------------------------ | ----------------------- |
| `navigation` | Current view, job, candidate, search state | UI -> Agent (read-only) |
| `navigate`   | Navigate the user to a view/job/candidate  | Agent -> UI (one-shot)  |

## Agent Operations

**Always run `pnpm script view-screen` first** before taking any action.

**Always use `pnpm script <name>` for operations** — scripts call the API and handle errors. Never use `curl`.

**After any mutation** (advance, move, reject, create), always run `pnpm script refresh-data`.

## Scripts

### Reading & Searching

| Script              | Args                             | Purpose                             |
| ------------------- | -------------------------------- | ----------------------------------- |
| `view-screen`       |                                  | See what the user is looking at     |
| `list-jobs`         | `--status <open\|closed\|draft>` | List jobs with optional filter      |
| `get-job`           | `--id <job-id>`                  | Get job detail + pipeline summary   |
| `list-candidates`   | `--search <term> --jobId <id>`   | Search/filter candidates            |
| `get-candidate`     | `--id <candidate-id>`            | Get full candidate details          |
| `get-pipeline`      | `--jobId <id> [--compact]`       | Pipeline view (candidates by stage) |
| `list-interviews`   | `[--compact]`                    | List upcoming interviews            |
| `dashboard-summary` |                                  | Get dashboard statistics            |

### Actions

| Script              | Args                                                       | Purpose                |
| ------------------- | ---------------------------------------------------------- | ---------------------- |
| `advance-candidate` | `--applicationId <id> --fromStageId <id>`                  | Advance to next stage  |
| `move-candidate`    | `--applicationId <id> --fromStageId <id> --toStageId <id>` | Move to specific stage |
| `reject-candidate`  | `--applicationId <id> [--notes <text>]`                    | Reject application     |
| `create-candidate`  | `--firstName <n> --lastName <n> [--email] [--jobId]`       | Create new candidate   |

### Notes & Navigation

| Script         | Args                                                                    | Purpose               |
| -------------- | ----------------------------------------------------------------------- | --------------------- |
| `manage-notes` | `--action=create\|list\|delete --candidateId <id> [--content] [--type]` | CRUD for AI notes     |
| `navigate`     | `--view <name> [--jobId <id>] [--candidateId <id>]`                     | Navigate the UI       |
| `refresh-data` |                                                                         | Force UI data refresh |

### AI Analysis Tasks

When the user asks you to analyze a candidate:

1. Use `get-candidate --id=<id>` to fetch their full profile
2. Use `get-job --id=<jobId>` to understand the role requirements
3. Perform your analysis
4. Save the result with `manage-notes --action=create --candidateId=<id> --type=resume_analysis --content="..."`
5. Run `refresh-data` so the UI shows the new note

Note types: `resume_analysis`, `comparison`, `interview_prep`, `general`

## Common Tasks

| User request                   | What to do                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| "Show me open jobs"            | `list-jobs --status=open`                                     |
| "Who's in the pipeline for X?" | `get-pipeline --jobId=<id> --compact`                         |
| "Analyze this candidate"       | `get-candidate`, analyze, `manage-notes --action=create`      |
| "Compare these candidates"     | `get-candidate` for each, compare, save notes                 |
| "Generate interview questions" | `get-candidate` + `get-job`, generate questions, save as note |
| "Move candidate to next stage" | `advance-candidate --applicationId=<id> --fromStageId=<id>`   |
| "Reject this candidate"        | `reject-candidate --applicationId=<id>`                       |
| "Add a new candidate"          | `create-candidate --firstName=... --lastName=... --email=...` |
| "What's on my screen?"         | `view-screen`                                                 |
| "Go to candidates"             | `navigate --view=candidates`                                  |

## API Routes

| Method | Route                           | Description                  |
| ------ | ------------------------------- | ---------------------------- |
| GET    | `/api/greenhouse/status`        | Check API key status         |
| PUT    | `/api/greenhouse/key`           | Save API key                 |
| DELETE | `/api/greenhouse/key`           | Remove API key               |
| GET    | `/api/jobs`                     | List jobs                    |
| GET    | `/api/jobs/:id`                 | Get job detail               |
| GET    | `/api/jobs/:id/stages`          | Get job stages               |
| GET    | `/api/jobs/:id/pipeline`        | Get pipeline (apps by stage) |
| GET    | `/api/candidates`               | List/search candidates       |
| GET    | `/api/candidates/:id`           | Get candidate detail         |
| POST   | `/api/candidates`               | Create candidate             |
| GET    | `/api/applications/:id`         | Get application              |
| PATCH  | `/api/applications/:id/advance` | Advance application          |
| PATCH  | `/api/applications/:id/move`    | Move to stage                |
| PATCH  | `/api/applications/:id/reject`  | Reject application           |
| GET    | `/api/interviews`               | List interviews              |
| GET    | `/api/dashboard`                | Dashboard stats              |
| GET    | `/api/notes?candidate_id=X`     | List notes for candidate     |
| POST   | `/api/notes`                    | Create note                  |
| DELETE | `/api/notes/:id`                | Delete note                  |

## Keyboard Shortcuts

| Key        | Action               |
| ---------- | -------------------- |
| `⌘K` / `/` | Open command palette |
| `G then D` | Go to Dashboard      |
| `G then J` | Go to Jobs           |
| `G then C` | Go to Candidates     |
| `G then I` | Go to Interviews     |
| `G then S` | Go to Settings       |
