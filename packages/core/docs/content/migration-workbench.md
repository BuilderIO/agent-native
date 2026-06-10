---
title: "Migrating to Agent-Native (/migrate)"
description: "Use the open-source Agent-Native Code workspace for coding sessions, including the built-in /migrate capability."
---

# Migrating to Agent-Native (/migrate)

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

By default `/migrate` creates a generic Agent-Native Code session plus a portable migration dossier. Migration is a slash command in the Code workspace, not a normal template to scaffold. The legacy hidden `migration` detail app has been removed; use the Code workspace, Desktop Code tab, or emitted dossier as the supported surfaces.

The direct `migrate` command remains a shortcut into the same goal:

```bash
npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app
```

Both forms print the same handoff: run id, source, output, dossier directory,
important artifact files, and the exact Agent-Native Code commands to inspect or
resume the session (see [Agent-Native Code UI](/docs/code-agents-ui) for the
full run-control command set).

## Code Workspace

`agent-native code` opens the interactive Agent-Native Code shell. Inside the shell, `/migrate` is a slash goal alongside `/audit` and other built-in commands. Projects can also define custom migration variants in `.agents/commands/*.md`. The CLI and Desktop hub share the same run store — start in one and continue in the other using the standard `list`/`attach`/`logs`/`resume`/`approve`/`stop` controls.

See [Agent-Native Code UI](/docs/code-agents-ui) for the full shell, run controls, Plan/Auto modes, slash-goal discovery, and Desktop hub integration.

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

## Internal Run Flow

The normal command creates a generic Agent-Native Code session and writes artifacts under the Agent-Native Code run store. It does **not** scaffold an app/template. The flow is:

1. **Discover** reads the source and creates `01-assessment.md`.
2. **Plan** creates recipe tasks and writes `02-plan.md` plus `03-tasks.md`.
3. **Approve** unlocks generated output writes.
4. **Sweep** runs migration tasks against the generated output project.
5. **Verify** runs deterministic checks and writes `04-report.md`.

Drive the session with the standard run controls (`status`/`list`/`attach`/`logs`/`approve`/`resume`/`ui`/`stop`, plus `--continue "prompt"` to record and run a follow-up). See [Agent-Native Code UI](/docs/code-agents-ui) for what each control does and how stop/approve behave.

## Long-Running Goals

The `/migrate` goal advances a run in bounded iterations:

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
