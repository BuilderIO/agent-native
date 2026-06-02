---
title: "Migration Workbench"
description: "Use the open-source Agent-Native Code workspace for coding sessions, including the built-in /migrate capability."
---

# Agent-Native Code Workspace and /migrate

Start from **Agent-Native Code**:

```bash
npx @agent-native/core@latest
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code
npx @agent-native/core@latest code "fix the failing auth tests"
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
```

**Agent-Native Code** is the open-source Claude Code/Codex-like workspace for coding work in Agent-Native. `agent-native` or `agent-native code` launches it with no prompt required, and a bare prompt starts a generic coding task directly. `/migrate` is one built-in capability for moving an existing app, URL, or described product into agent-native. It uses the same session store, transcript, and desktop hub as the CLI `code` command, so migration behaves like a goal you can resume, attach to, inspect, and stop rather than a separate one-off product.

See [Agent-Native Code UI](/docs/code-agents-ui) for the shared CLI run controls (`list`/`attach`/`logs`/`resume`/`status`/`stop`/`ui`) and the file-backed, long-running background-run model that `/migrate` sessions use.

By default `/migrate` creates a generic Agent-Native Code session plus a portable migration dossier. Migration is a slash command in the Code workspace, not a normal template to scaffold. The hidden `migration` app is now a legacy/internal detail surface, available with `--app-surface` when a run needs a richer assessment/approval/task/verifier dashboard.

The direct `migrate` command remains a shortcut into the same goal:

```bash
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app
```

Both forms print the same handoff: run id, source, output, dossier directory,
important artifact files, and the exact Agent-Native Code commands to inspect or
resume the session (see [Agent-Native Code UI](/docs/code-agents-ui) for the
full run-control command set).

## Code Workspace

`agent-native code` opens the interactive Agent-Native Code shell for coding-agent work. You do not need to pass an initial prompt:

```bash
npx @agent-native/core@latest code
```

Inside the shell, type a task or use slash goals as commands:

```text
code> fix the failing auth tests
code> /migrate ./my-next-app --out ../migrated-app
code> /audit --url https://example.com
```

Agent-Native Code uses the same minimal coding-tool profile (`bash`, `read`, `edit`, `write`) and shared composer as the rest of the framework; see [Agent-Native Code UI](/docs/code-agents-ui) for details.

The same goals can run directly from the command line:

```bash
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code "fix the failing auth tests"
npx @agent-native/core@latest code exec "fix the failing auth tests"
npx @agent-native/core@latest code -p "fix the failing auth tests"
npx @agent-native/core@latest code --plan "explain the failing auth tests"
npx @agent-native/core@latest code --auto "fix the failing auth tests"
npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app
npx @agent-native/core@latest code /audit --url https://example.com
```

Run `agent-native code goals` to see the goals registered in your checkout. A bare prompt starts a local coding-agent session for open-ended code work, streams the run, records transcript/status/tool events, and accepts follow-up prompts through the same run record.

Installed `agent-native` with no arguments launches the Agent-Native Code workspace, and `agent-native "prompt"` starts a generic Agent-Native Code task directly. Use `agent-native create` when you want to scaffold apps or workspaces.

## Sessions and Modes

Agent-Native Code makes migration feel like a local Codex/Claude Code session instead of a one-shot command. The CLI and Desktop hub share the same run store, so you can start a `/migrate` run in one place and continue it in the other with the standard `list`/`attach`/`logs`/`resume`/`approve`/`stop` controls. See [Agent-Native Code UI](/docs/code-agents-ui) for those run controls, the mixed background-run source model, two-way follow-up semantics, and the Plan/Auto run modes that also govern `/migrate` sessions. Auto mode is the default; use Plan mode for migration assessment, architecture, or review where you want a proposal before edits.

## Project Slash Commands

Built-in slash goals such as `/migrate` and `/audit` are framework commands. Projects can also define migration variants as custom commands in `.agents/commands/*.md` (see [Agent-Native Code UI](/docs/code-agents-ui) for how project commands and skills are discovered and inserted):

```bash
npx @agent-native/core@latest code /migrate-storefront ./legacy-shop --out ../agent-shop
```

Versioning migration variants this way keeps source-specific handoffs close to the repository. Source-specific systems such as AEM or Builder.io should stay as optional instruction-pack examples inside those commands, not top-level migration assumptions.

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

The normal command creates a generic Agent-Native Code session and writes artifacts under the Agent-Native Code run store. It does **not** scaffold an app/template.

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

Drive this surface with the standard run controls (`status`/`list`/`attach`/`logs`/`approve`/`resume`/`ui`/`stop`, plus `--continue "prompt"` to record and run a follow-up). See [Agent-Native Code UI](/docs/code-agents-ui) for what each control does and how stop/approve behave.

## Long-Running Goals

The `/migrate` goal has an action named `run-migration-goal`. It advances a run in bounded iterations:

- before approval, it can assess and plan but cannot write generated output
- after approval, it scaffolds once, advances pending tasks, verifies, and records verifier results
- if verification fails, the critic policy returns `retry-with-more-context`, `tune-recipe`, `manual-decision-needed`, `rollback-generated-output`, or `accept`

That gives the flow Claude Code `/goal`-style semantics without making migration a one-shot rewrite. The app state and disk artifacts let you resume after restarts, long pauses, or manual decisions.

## Credentials

The `/migrate` goal reuses the same credentials system as agent-native. There is no migration-specific key store and no `MIGRATION_*` secret namespace.

In Agent-Native Code, Desktop, or the internal run surface, connect providers through the normal settings and onboarding surfaces. For headless CLI use, existing provider environment variables are detected, including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and other provider env vars supported by the framework. Secret values are never copied into migration artifacts.

## Desktop Deep Links

`/migrate` runs appear in the Desktop Agent-Native Code hub alongside any other Code session and use the same hub run controls and approval gate ([Agent-Native Code UI](/docs/code-agents-ui) covers the Desktop host and run controls). Browser/Desktop approval remains the trust gate for generated output writes.

The hub handles a `/migrate` goal deep link:

```text
agentnative://open?goal=migrate&run=<runId>
```

The legacy app-style deep link still works and opens the internal run detail surface:

```text
agentnative://open?app=migration&run=<runId>
```

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
