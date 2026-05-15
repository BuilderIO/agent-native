---
title: "Migration Workbench"
description: "Migrate existing apps, URLs, or described products into agent-native with a local Workbench or an own-agent dossier."
---

# Migration Workbench

Start with the npx command:

```bash
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
```

Migration Workbench is the first app-backed **Code Agents** goal. It uses the same long-running harness as the desktop Code Agents hub and the CLI `code` command, so migration behaves like a slash command rather than a separate one-off tool. The input can be a local codebase, a URL, or a prose description. The first output is not blind generated code; it is an auditable migration surface with assessment, planning, approval, generated output, and verification.

The product promise is: **let the agent run, but prove it**.

The direct `migrate` command remains a shortcut:

```bash
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app
```

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

## Workbench Flow

The normal command scaffolds the hidden `migration` template and writes `data/migration-source.json` with source metadata. Then run the Workbench:

```bash
cd migration
pnpm install
pnpm dev
```

The Workbench URL is the local dev URL printed by Vite. In first-party dev setups it is usually:

```text
http://localhost:8101/
```

Inside the app, the flow is:

1. **Discover** reads the source and creates `01-assessment.md`.
2. **Plan** creates recipe tasks and writes `02-plan.md` plus `03-tasks.md`.
3. **Approve** unlocks generated output writes.
4. **Sweep** runs migration tasks against the generated output project.
5. **Verify** runs deterministic checks and writes `04-report.md`.

Useful CLI helpers:

```bash
npx @agent-native/core@latest code status --last
npx @agent-native/core@latest code resume --last
npx @agent-native/core@latest code ui --last
npx @agent-native/core@latest code stop --last
```

`stop` does not kill an unknown background process. It reminds you to stop the terminal or Desktop/dev-all process that owns the Workbench server.

## Long-Running Goals

The Workbench has a goal action named `run-migration-goal`. It advances a run in bounded iterations:

- before approval, it can assess and plan but cannot write generated output
- after approval, it scaffolds once, advances pending tasks, verifies, and records verifier results
- if verification fails, the critic policy returns `retry-with-more-context`, `tune-recipe`, `manual-decision-needed`, `rollback-generated-output`, or `accept`

That gives the flow Claude Code `/goal`-style semantics without making migration a one-shot rewrite. The app state and disk artifacts let you resume after restarts, long pauses, or manual decisions.

## Credentials

Migration reuses the same credentials system as agent-native. There is no migration-specific key store and no `MIGRATION_*` secret namespace.

In the Workbench or Desktop, connect providers through the normal settings and onboarding surfaces. For headless CLI use, existing provider environment variables are detected, including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and other provider env vars supported by the framework. Secret values are never copied into migration artifacts.

## Code Agents

Agent-Native Desktop includes a **Code Agents** hub for long-running coding-agent sessions. Migration is the first app-backed goal there, registered as `/migrate`: the hub can show runs, filter by active, approval, issues, or complete status, open the goal surface for a selected run, and handle links like:

```text
agentnative://open?goal=migrate&run=<runId>
```

The legacy app-style deep link still works:

```text
agentnative://open?app=migration&run=<runId>
```

The hub also includes `/audit`, a lightweight native goal backed by `agent-native audit-agent-web`, to keep the shell honest about non-migration goals:

```bash
npx @agent-native/core@latest code /audit --url https://example.com
```

The hub exposes the same generic run controls the CLI does: resume opens the goal surface, status refreshes the run list, and stop reports how to stop the owning terminal or `dev-all` process for goals that are not daemonized yet. Browser/Desktop approval remains the trust gate for generated output writes. Future coding goals can reuse the same CLI and desktop shell by registering another slash goal.

## Emit Mode

Use `--emit` when you want Codex, Claude Code, another code agent, or Agent-Native Desktop to do the next phase without first running the Workbench UI:

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

Migration is driven by instruction packs instead of one source-specific path.

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
