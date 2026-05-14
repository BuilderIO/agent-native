---
title: "Migration Workbench"
description: "Use a local agent-native Workbench to migrate existing apps into agent-native with assessment, approval, generated output, and verification."
---

# Migration Workbench

Migration Workbench is a local agent-native app for moving existing applications into the agent-native framework. It is designed for migrations where an agent can do useful work, but every important step should be auditable and verified.

The product promise is: **let the agent run, but prove it**.

V1 focuses on **Next.js to standalone agent-native**. Builder.io Publish and AEM exits are designed into the adapter interfaces, but are intended as follow-on enterprise adapters rather than the first shipped path.

## How It Works

Run:

```bash
agent-native migrate ./my-next-app --out ../migrated-app
```

The command scaffolds the hidden `migration` template and writes a seed file with the source and output paths. The Workbench UI then guides the run:

1. **Discover** reads the source project and creates `01-assessment.md`.
2. **Plan** creates recipe tasks and writes `02-plan.md` plus `03-tasks.md`.
3. **Approve** unlocks generated output writes.
4. **Sweep** runs migration tasks against the generated output project.
5. **Verify** runs deterministic checks and writes `04-report.md`.

The source project is read-only. Generated output is written to a separate `outputRoot`.

## Agent-Native Mapping

The V1 recipes are named after the framework contracts they enforce:

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

## Adapter Model

`@agent-native/migrate` exposes a reusable engine:

- `SourceAdapter` detects and inventories existing projects.
- `TargetAdapter` scaffolds and verifies output.
- `MigrationRecipe` turns IR graph inventory into tasks.
- `Verifier` returns structured migration evidence.

The intermediate representation is split into four graphs:

- `SiteGraph`: routes, redirects, public/private classification, metadata.
- `ComponentGraph`: reusable UI components and design tokens.
- `ContentGraph`: CMS models, static content, and assets.
- `BehaviorGraph`: API endpoints, data stores, auth, jobs, client state, and LLM calls.

## Builder.io And AEM

Builder.io is a target decision, not a source assumption. Builder Publish should be used for marketing, docs, landing, and content surfaces. Transactional SaaS state, dashboards, app-owned data, and workflows stay in agent-native SQL/actions.

AEM support should be implemented as a source adapter family:

- `crawl`: URLs, sitemap, screenshots, SEO, redirects.
- `api`: AEM GraphQL Content Fragments and DAM metadata.
- `package`: Vault/JCR package parsing.
- `code`: HTL components, dialogs, templates, and policies.
- `enterprise`: combines available modes and emits confidence/gap reports.

AEM output is two-pipeline: content extraction into Builder or SQL, plus frontend regeneration and component mapping into agent-native UI.

## Verification

The default verifier path is deterministic:

- output file smoke checks
- route inventory parity artifacts
- agent-native conformance checks
- future Playwright smoke tests
- future visual, a11y, Lighthouse, SEO, and redirect checks

AI browser tools can help generate or repair flows, but deterministic Playwright-style checks should remain the truth oracle.

## Package Exports

Use the engine directly when building adapters or custom migration workflows:

```ts
import {
  createMigrationRun,
  discoverMigration,
  planMigration,
  nextjsSourceAdapter,
  agentNativeTargetAdapter,
} from "@agent-native/migrate";
```

Subpath exports are available for first-party V1 adapters:

```ts
import { nextjsSourceAdapter } from "@agent-native/migrate/source-nextjs";
import { agentNativeTargetAdapter } from "@agent-native/migrate/target-agent-native";
```
