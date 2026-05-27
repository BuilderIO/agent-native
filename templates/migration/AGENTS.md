# {{APP_NAME}} — Agent Guide

This hidden app is the internal run detail/control surface for the Code Agents `/migrate` goal. Code Agents is the user-facing product; `/migrate` is a built-in goal; this app exists to assess sources, require approval, track tasks, expose artifacts, and verify generated output. A migration source can be a local path, a URL, or a human description; adapters turn that source evidence into an inventory before any output work begins. The source project must be read-only. Generated output goes to the run's `outputRoot`, usually a sibling folder such as `../migrated-app`.

## Core Rules

- Never mutate the source project.
- Do not write generated output until the run has an approved plan.
- Use actions for every operation the UI can perform.
- Keep run state in SQL and artifacts on disk under `data/migration-runs/<runId>/`.
- Treat verification as part of the `/migrate` goal: every migration claim needs a report or verifier result.

## Application State

| State Key    | Purpose                                                            |
| ------------ | ------------------------------------------------------------------ |
| `navigation` | Current internal surface view, path, `?run=<id>`, and goal context |
| `navigate`   | One-shot command for the UI to open the internal run surface       |

The current screen state is auto-injected into chat. Use `view-screen` when you need a richer snapshot of the selected run, goal state, task list, and verifier results. Use `navigate --runId <id>` to open `/?run=<id>` in the internal run surface.

## Source Model

Treat source input abstractly:

- **Path** — a local immutable source such as a Next.js app root. V1 can introspect local Next.js paths directly.
- **URL** — a live site, sitemap, CMS endpoint, AEM endpoint, or crawl seed. Capture URL evidence and adapter mode before planning.
- **Description** — a human-entered brief for enterprise migrations where code, CMS, or credentials are incomplete. Convert it into explicit assumptions and manual mapping tasks.

Do not pretend a URL or description has the same confidence as a local source path. Record gaps in the plan and verifier report.

## /migrate Goal Flow

1. `create-migration-run` records path, URL, or description input plus output path. It does not write output.
2. `assess-migration` uses the first matching source adapter, or agent-introspection fallback, and writes `01-assessment.md`.
3. `generate-migration-plan` creates recipes/tasks and writes `02-plan.md` and `03-tasks.md`.
4. `approve-migration-plan` unlocks generated output writes.
5. `run-migration-task` performs the V1 sweep/scaffold step and marks task status.
6. `verify-migration` runs deterministic verifiers and writes `04-report.md`.

Prefer `run-migration-goal` for Code Agents goal-driven operation. It is idempotent and bounded: it safely performs missing assessment/planning, stops for approval before generated output writes, scaffolds once after approval, advances at most `maxTasks` pending tasks, verifies, persists verifier results/report paths, returns `criticDecision`, and tells you the next action.

## Actions

| Action                         | Args                                                           | Purpose                                                   |
| ------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| `list-migration-runs`          |                                                                | List runs and task counts                                 |
| `get-migration-run`            | `--id <runId>`                                                 | Get run details, tasks, verifiers                         |
| `create-migration-run`         | `--sourceRoot <path-url-or-description> [--outputRoot <path>]` | Create a run                                              |
| `update-migration-plan-inputs` | `--id <runId> --planInputsText <json-or-notes>`                | Set custom AEM/Builder/jQuery plan inputs before planning |
| `assess-migration`             | `--id <runId>`                                                 | Build IR and assessment artifacts                         |
| `generate-migration-plan`      | `--id <runId>`                                                 | Build plan and task artifacts                             |
| `approve-migration-plan`       | `--id <runId>`                                                 | Approve generated output writes                           |
| `run-migration-task`           | `--id <runId> [--taskId <taskId>]`                             | Run the next migration task                               |
| `run-migration-goal`           | `--id <runId> [--maxTasks 1] [--verify true]`                  | Safely advance the `/migrate` goal                        |
| `verify-migration`             | `--id <runId>`                                                 | Run deterministic verification                            |
| `read-migration-artifact`      | `--id <runId> --file <artifact.md>`                            | Read assessment, plan, tasks, report                      |
| `get-migration-seed`           |                                                                | Read CLI seed from `agent-native migrate`                 |
| `view-screen`                  |                                                                | See current UI/run context                                |
| `navigate`                     | `--view <name>`, `--runId <id>`, or `--path`                   | Navigate the UI                                           |

## Agent-Native Mapping Rules

Recipe names mirror the `/migrate` goal contract:

- `api-routes-to-actions`
- `app-data-to-drizzle`
- `llm-calls-to-agent-chat`
- `important-client-state-to-application-state`
- `mutations-to-optimistic-actions`
- `shared-resources-to-access-helpers`
- `public-pages-to-ssr`
- `logged-in-pages-to-client-app-shell`
- `aem-evidence-inventory`
- `aem-content-fragments-to-target-models`
- `aem-experience-fragments-to-components`
- `aem-components-to-react`
- `builder-component-registration-plan`
- `route-ownership-map`
- `headless-dynamic-route-map`
- `jquery-clientlibs-to-react`
- `sample-sweep-verification`

Custom plan inputs live as normalized JSON on a run before planning. Use them to
make customer-specific constraints binding: AEM evidence modes, Content Fragment
policy, Experience Fragment policy, Builder route ownership, headless ownership,
jQuery/clientlib policy, and sample/sweep verification gates. Do not change plan
inputs after `generate-migration-plan`; create a new run or add an explicit reset
flow so approved artifacts cannot drift.

## Skills

Read these before changing the internal run surface itself:

| Skill                      | When to read                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| `migration`                | Before creating, advancing, verifying, or reporting a run         |
| `migration-source-nextjs`  | Before assessing or planning a local Next.js source               |
| `migration-source-aem`     | Optional pack for AEM crawl/API/package/code/enterprise input     |
| `migration-target-builder` | Optional pack for Builder-managed routes or content               |
| `adding-a-feature`         | Any internal surface feature must keep UI/action/app-state parity |
| `actions`                  | Before adding or changing internal surface actions                |
| `storing-data`             | Before changing migration SQL tables                              |
| `context-awareness`        | Before changing navigation or `view-screen`                       |
| `security`                 | Before changing path handling, source reads, or access            |
| `frontend-design`          | Before changing the dashboard UI                                  |
| `shadcn-ui`                | Before adding UI primitives                                       |
