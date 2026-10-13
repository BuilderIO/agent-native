# Agent-Native Plan — Agent Guide

Agent-Native Plan is a local-first structured visual plan mode for coding
agents: it turns agent plans into editable rich blocks, diagrams, wireframes,
prototype options, annotations, and comments a person reviews before code
changes happen.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/visual-plan/SKILL.md` — for rich plan generation or edits.
- `.agents/skills/visual-recap/SKILL.md` — for visual PR/code recaps.
- `.agents/skills/plan-authoring-flow/SKILL.md` — for action routing and fidelity.
- `.agents/skills/plan-hosted-writes/SKILL.md` — for hosted write safety.
- `.agents/skills/plan-comments-and-feedback/SKILL.md` — for plan comments and feedback.
- `.agents/skills/plan-browser-editing/SKILL.md` — for browser edits.
- `.agents/skills/plan-source-sync/SKILL.md` — for MDX/local plan sync.
- `.agents/skills/plan-version-history/SKILL.md` — for snapshots and restore.
- `.agents/skills/plan-local-codebase-chat/SKILL.md` — for linked codebase questions.
- `.agents/skills/plan-review-recaps/SKILL.md` — for recap blocks and CI.
- `.agents/skills/plan-events/SKILL.md` — for lifecycle events.
- `.agents/skills/plan-editions/SKILL.md` — for the scheduled PR recap digest.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the framework contract: SQL data, action-first writes, application state for selection, and shared agent chat for AI work.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use `view-screen` or application state when the active page/selection is unclear. Prefer structured visual artifacts over long Markdown.
- Read pending feedback with `get-plan-feedback` before editing. For hosted writes, read `plan-hosted-writes`: use a real session, fresh `expectedUpdatedAt` for destructive writes, and verify by re-read.
- Runtime plans are normalized JSON in SQL; MDX files are source control, via `plan-source-sync`. New canvas wireframes use semantic `<Screen html={...} />`; nested kit trees are legacy. See `plan-authoring-flow`.

## Application State

- `navigation.view`: `chat`, `plans`, `plan`, `editions`, `edition`, `extensions`, or `team`; `editionId` / `planId` identify the open item.
- `local-codebase` holds the linked folder and index/tree/snapshot resources; see `plan-local-codebase-chat`.
- `navigate` opens the plan list or a specific plan.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen`, `navigate` | Read the screen; move the UI |
| `list-visual-plans`, `get-visual-plan`, `show-visual-plan` | List, read, render plans |
| `create-visual-plan`, `create-ui-plan`, `create-prototype-plan`, `create-plan-design`, `create-visual-questions` | Create a plan per mode; one call per plan |
| `create-visual-recap`, `search-pr-recaps` | Create and find recaps |
| `list-edition-candidates`, `create-edition`, `get-edition`, `list-editions` | Engineering-newspaper editions: select recaps, publish, read, archive |
| `visualize-plan`, `convert-visual-plan-to-prototype` | Convert pasted plans; legacy mock→prototype |
| `update-visual-plan` | Patch blocks, screens, fidelity, comments, status |
| `get-plan-blocks`, `list-plan-components`, `visual-answer` | Block schemas, components, visual answers |
| `publish-visual-plan`, `export-visual-plan` | Share hosted; export HTML/MD/JSON/MDX |
| `get-plan-access-status`, `request-plan-access` | Check or request access |
| `get-plan-feedback`, `consume-plan-feedback`, `resolve-plan-comment`, `reply-to-plan-comment`, `delete-plan-comment` | Read, consume, resolve, reply, delete feedback |
| `list-plan-versions`, `get-plan-version`, `restore-plan-version` | List, inspect, restore snapshots |
| `read-visual-plan-source`, `import-visual-plan-source`, `patch-visual-plan-source` | Read, replace, patch MDX source |
| `get-local-plan-folder`, `update-local-plan-folder`, `update-local-plan-comments`, `promote-local-plan-folder`, `validate-local-plan-source` | DB-free local plan folders |
| `delete-visual-plan`, `report-visual-plan` | Delete/restore; report abuse |

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
