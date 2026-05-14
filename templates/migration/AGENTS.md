# {{APP_NAME}} — Agent Guide

This is the Migration Workbench. It migrates existing apps to agent-native through a resumable flow: discover, plan, approve, sweep, verify, report. The source project must be read-only. Generated output goes to the run's `outputRoot`, usually a sibling folder such as `../migrated-app`.

## Core Rules

- Never mutate the source project.
- Do not write generated output until the run has an approved plan.
- Use actions for every operation the UI can perform.
- Keep run state in SQL and artifacts on disk under `data/migration-runs/<runId>/`.
- Treat verification as part of the product: every migration claim needs a report or verifier result.

## Application State

| State Key    | Purpose                                                |
| ------------ | ------------------------------------------------------ |
| `navigation` | Current Workbench view and selected run context        |
| `navigate`   | One-shot command for the UI to open the Workbench view |

The current screen state is auto-injected into chat. Use `view-screen` when you need a richer snapshot of the selected run and task list.

## Migration Flow

1. `create-migration-run` records source/output paths. It does not write output.
2. `assess-migration` reads the Next.js source and writes `01-assessment.md`.
3. `generate-migration-plan` creates recipes/tasks and writes `02-plan.md` and `03-tasks.md`.
4. `approve-migration-plan` unlocks generated output writes.
5. `run-migration-task` performs the V1 sweep/scaffold step and marks task status.
6. `verify-migration` runs deterministic verifiers and writes `04-report.md`.

## Actions

| Action                    | Args                                         | Purpose                                   |
| ------------------------- | -------------------------------------------- | ----------------------------------------- |
| `list-migration-runs`     |                                              | List runs and task counts                 |
| `get-migration-run`       | `--id <runId>`                               | Get run details, tasks, verifiers         |
| `create-migration-run`    | `--sourceRoot <path> [--outputRoot <path>]`  | Create a run                              |
| `assess-migration`        | `--id <runId>`                               | Build IR and assessment artifacts         |
| `generate-migration-plan` | `--id <runId>`                               | Build plan and task artifacts             |
| `approve-migration-plan`  | `--id <runId>`                               | Approve generated output writes           |
| `run-migration-task`      | `--id <runId> [--taskId <taskId>]`           | Run the next migration task               |
| `verify-migration`        | `--id <runId>`                               | Run deterministic verification            |
| `read-migration-artifact` | `--id <runId> --file <artifact.md>`          | Read assessment, plan, tasks, report      |
| `get-migration-seed`      |                                              | Read CLI seed from `agent-native migrate` |
| `view-screen`             |                                              | See current UI/run context                |
| `navigate`                | `--view <name>`, `--runId <id>`, or `--path` | Navigate the UI                           |

## Agent-Native Mapping Rules

Recipe names mirror the migration contract:

- `api-routes-to-actions`
- `app-data-to-drizzle`
- `llm-calls-to-agent-chat`
- `important-client-state-to-application-state`
- `mutations-to-optimistic-actions`
- `shared-resources-to-access-helpers`
- `public-pages-to-ssr`
- `logged-in-pages-to-client-app-shell`

## Skills

Read these before changing the Workbench itself:

| Skill               | When to read                                               |
| ------------------- | ---------------------------------------------------------- |
| `adding-a-feature`  | Any Workbench feature must keep UI/action/app-state parity |
| `actions`           | Before adding or changing Workbench actions                |
| `storing-data`      | Before changing migration SQL tables                       |
| `context-awareness` | Before changing navigation or `view-screen`                |
| `security`          | Before changing path handling, source reads, or access     |
| `frontend-design`   | Before changing the dashboard UI                           |
| `shadcn-ui`         | Before adding UI primitives                                |
