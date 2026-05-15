---
title: "Code Agents Workspace and /migrate"
description: "Use the open-source Code Agents workspace for coding sessions, including the built-in /migrate capability."
---

# Code Agents Workspace and /migrate

Start from **Code Agents**:

```bash
npx @agent-native/core@latest
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code
npx @agent-native/core@latest code "fix the failing auth tests"
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
```

**Code Agents** is the open-source Claude Code/Codex-like workspace for coding work in Agent-Native. `agent-native` or `agent-native code` launches it with no prompt required, and a bare prompt starts a generic coding task directly. `/migrate` is one built-in capability for moving an existing app, URL, or described product into agent-native. It uses the same session store, transcript, and desktop hub as the CLI `code` command, so migration behaves like a goal you can resume, attach to, inspect, and stop rather than a separate one-off product.

By default `/migrate` creates a generic Code Agents session plus a portable migration dossier. The hidden `migration` app is now a legacy/internal detail surface, available with `--app-surface` when a run needs a richer assessment/approval/task/verifier dashboard. It is not the migration product and should not be scaffolded as a normal app/template.

The direct `migrate` command remains a shortcut into the same goal:

```bash
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app
```

## Code Workspace

`agent-native code` opens the interactive Code Agents shell for coding-agent work. You do not need to pass an initial prompt:

```bash
npx @agent-native/core@latest code
```

Inside the shell, type a task or use slash goals as commands:

```text
code> fix the failing auth tests
code> /task fix the failing auth tests
code> /migrate ./my-next-app --out ../migrated-app
code> /audit --url https://example.com
```

The same goals can run directly from the command line:

```bash
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code "fix the failing auth tests"
npx @agent-native/core@latest code exec "fix the failing auth tests"
npx @agent-native/core@latest code -p "fix the failing auth tests"
npx @agent-native/core@latest code /task "fix the failing auth tests"
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /audit --url https://example.com
```

Run `agent-native code goals` to see the goals registered in your checkout. `/task` starts a local coding-agent session for open-ended code work, streams the run, records transcript/status/tool events, and accepts follow-up prompts through the same run record.

Bare `agent-native` launches the Code Agents workspace in this branch, and `agent-native "prompt"` starts a generic Code Agents task directly, matching the Codex/Claude Code habit of treating unknown text as a coding prompt. If an installed version does not include that top-level entrypoint yet, run `agent-native code` directly.

## Input Shapes

Use a local source path when you have code:

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
```

Use a URL when the first artifact is a live site or product surface:

```bash
npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site plus logged-in dashboard"
```

Use a description when the migration starts from requirements, screenshots, or a handoff brief:

```bash
npx @agent-native/core@latest code /migrate --describe "A Rails admin app with reports, approvals, and CSV imports" --emit
```

For local paths, the source is read-only. Generated output must live outside the source tree.

## Internal Run Surface

The normal command creates a generic Code Agents session and writes artifacts under the Code Agents run store. It does **not** scaffold an app/template.

Open the legacy hidden `migration` detail surface only when you explicitly want that richer dashboard:

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --app-surface
cd migration
pnpm install
pnpm dev
```

The local dev URL is printed by Vite. In first-party dev setups it is usually:

```text
http://localhost:8101/
```

Inside that optional internal surface, the flow is:

1. **Discover** reads the source and creates `01-assessment.md`.
2. **Plan** creates recipe tasks and writes `02-plan.md` plus `03-tasks.md`.
3. **Approve** unlocks generated output writes.
4. **Sweep** runs migration tasks against the generated output project.
5. **Verify** runs deterministic checks and writes `04-report.md`.

Useful CLI helpers:

```bash
npx @agent-native/core@latest code status --last
npx @agent-native/core@latest code list
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code logs --last
npx @agent-native/core@latest code resume --last
npx @agent-native/core@latest code --continue "check the auth edge cases next"
npx @agent-native/core@latest code resume --last "check the auth edge cases next"
npx @agent-native/core@latest code ui --last
npx @agent-native/core@latest code stop --last
```

`attach --last` follows a live transcript until the run reaches a terminal state, while `logs --last` prints the transcript once. `resume --last` reopens the latest run handoff. Passing a quoted prompt, or using `--continue "prompt"`, records it as a follow-up transcript event and, for executable goals such as `/task`, immediately runs that follow-up against the same session context.

`stop` marks the run paused and sends SIGTERM when the run has a tracked Desktop/CLI runner process id. If the active work belongs to another terminal or external agent, stop that owner directly.

## Long-Running Goals

The `/migrate` goal has an action named `run-migration-goal`. It advances a run in bounded iterations:

- before approval, it can assess and plan but cannot write generated output
- after approval, it scaffolds once, advances pending tasks, verifies, and records verifier results
- if verification fails, the critic policy returns `retry-with-more-context`, `tune-recipe`, `manual-decision-needed`, `rollback-generated-output`, or `accept`

That gives the flow Claude Code `/goal`-style semantics without making migration a one-shot rewrite. The app state and disk artifacts let you resume after restarts, long pauses, or manual decisions.

## Credentials

The `/migrate` goal reuses the same credentials system as agent-native. There is no migration-specific key store and no `MIGRATION_*` secret namespace.

In Code Agents, Desktop, or the internal run surface, connect providers through the normal settings and onboarding surfaces. For headless CLI use, existing provider environment variables are detected, including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and other provider env vars supported by the framework. Secret values are never copied into migration artifacts.

## Code Agents

Agent-Native Desktop includes a **Code Agents** hub for long-running coding-agent sessions. It is the general Code app/surface in Desktop, and it pairs with the `agent-native code` shell as the primary CLI/Desktop coding experience. `/task` is the generic executable coding session, and `/migrate` is one specialized capability there: the hub can show runs, filter by active, approval, issues, or complete status, tail transcripts, render tool events, send follow-up prompts, stop tracked runners, open a terminal in the run workspace, and handle links like:

```text
agentnative://open?goal=migrate&run=<runId>
```

The legacy app-style deep link still works and opens the internal run detail surface:

```text
agentnative://open?app=migration&run=<runId>
```

The hub also includes `/audit`, a lightweight native goal backed by `agent-native audit-agent-web`, to keep the shell honest about more than one goal:

```bash
npx @agent-native/core@latest code /audit --url https://example.com
```

The hub exposes the same generic run controls the CLI does: resume opens the goal surface or reattaches to the run, a quoted resume prompt records and executes follow-up feedback for executable goals, status refreshes the run list, and stop reports or stops the owning process when one is known. Browser/Desktop approval remains the trust gate for generated output writes. Future coding goals can reuse the same CLI and desktop shell by registering another slash goal.

## Emit Mode

Use `--emit` when you want Codex, Claude Code, another code agent, or Agent-Native Desktop to do the next phase without opening the internal run surface:

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --emit ../migration-dossier
```

The dossier is always written outside `sourceRoot`. It includes:

- `AGENTS.md` with migration-specific instructions
- `.agents/skills/migration*/SKILL.md` when migration skills are available from the template
- `MIGRATION_PLAYBOOK.md`
- `01-assessment.md`
- `ir.json` when file-level inventory is available

Hand the dossier to your preferred coding agent with a prompt like:

```text
Use this migration dossier. Follow AGENTS.md and MIGRATION_PLAYBOOK.md, keep the source read-only, write the agent-native output outside the source tree, and record verification evidence before calling the migration complete.
```

When `@agent-native/migrate` helpers are installed, `--emit` uses them for Next.js assessment and IR. If they are not available, the CLI falls back to a safe local inventory pass. URL-only and description-only dossiers still include the playbook and assessment, but they do not claim file-level IR until an agent inspects source.

## Instruction Packs

The `/migrate` goal is driven by instruction packs instead of one source-specific path.

| Pack             | What it tells the agent to do                                       |
| ---------------- | ------------------------------------------------------------------- |
| Source intake    | Normalize path, URL, or prose input into an assessment              |
| Agent-native map | Convert operations to actions, SQL, app state, sharing, and SSR     |
| Output safety    | Keep generated code outside sourceRoot and require approval gates   |
| Verification     | Use deterministic checks and record manual gaps                     |
| Platform exits   | Add source-specific guidance for systems such as AEM or CMS exports |

Builder.io, AEM, crawls, package exports, and CMS APIs are optional instruction-pack concerns, not top-level assumptions. Builder Publish can be a target for marketing, docs, landing, and content surfaces. Transactional SaaS state, dashboards, app-owned data, and workflows stay in agent-native SQL/actions.

## Agent-Native Mapping

The recipes are named after the framework contracts they enforce:

| Source pattern              | Agent-native target                                               |
| --------------------------- | ----------------------------------------------------------------- |
| API routes / server actions | `actions/`, except uploads, webhooks, OAuth, and streaming routes |
| app-owned data              | Drizzle SQL tables plus actions                                   |
| direct LLM calls            | agent chat delegation                                             |
| important client state      | `application_state` navigation and selection                      |
| UI mutations                | optimistic action mutations                                       |
| shared resources            | ownership, sharing, and access helpers                            |
| public pages                | server rendering                                                  |
| logged-in workflows         | persistent client app shell                                       |

This is the difference between porting React code and actually migrating to agent-native.

## Package Exports

`@agent-native/migrate` exposes a reusable engine for adapters and custom workflows:

```ts
import {
  createMigrationRun,
  discoverMigration,
  planMigration,
  selectSourceAdapter,
  createSkeletonProjectIR,
  createBrowserVerifier,
  nextjsSourceAdapter,
  agentNativeTargetAdapter,
} from "@agent-native/migrate";
```

Subpath exports are available for first-party V1 adapters:

```ts
import { nextjsSourceAdapter } from "@agent-native/migrate/source-nextjs";
import { agentNativeTargetAdapter } from "@agent-native/migrate/target-agent-native";
```

The intermediate representation is split into four graphs: site, components, content, and behavior. Verification starts with deterministic checks and can grow to Playwright, visual, accessibility, Lighthouse, SEO, and redirect checks.
