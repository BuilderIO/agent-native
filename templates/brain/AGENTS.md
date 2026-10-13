# Brain — Agent Guide

Brain ingests sources, answers with evidence, and captures durable knowledge.

## Skills

Search skills with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/brain/SKILL.md` (ingestion, retrieval, `sourcePolicy`, evidence, capture), `.agents/skills/ask-across-everything/SKILL.md`, `.agents/skills/ingestion-and-connectors/SKILL.md`. Ops reference: [brain RUNBOOK](.agents/skills/brain/RUNBOOK.md), not a skill slug. Shared: `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`. Source examples: `pnpm action source-search --query "<pattern>"` or `pnpm action source-search --path <path>`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use Brain actions for ingestion, search, retrieval, distillation, capture, review, and connectors; respect access scopes. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Call `get-brain-settings` before answering, broad searches, or distilling unless settings are already in context; it defines retrieval and distillation policy.
- Answers must cite or summarize source evidence and separate facts from inference. Never fabricate source content, dates, people, permissions, or connector health. Copy evidence quotes exactly from `get-capture`.
- Capture durable, useful knowledge only; do not save secrets, transient noise, or unsupported personal data.
- Supported source providers are exactly `manual`, `generic`, `clips`, `slack`, `granola`, `github`, and `zoom`; `create-source` rejects others. Use `generic` for approved FAQs/docs/handbooks; see `ingestion-and-connectors` for policy and deletion semantics.
- Reuse workspace integration grants (`list-connection-providers`) instead of copying provider tokens. Sync actions are convenience readers; use `provider-api-catalog`, `provider-api-docs`, and `provider-api-request` for unmodeled endpoints or filters.

## Application state

- `navigation` tracks ask/search, sources, review, memory, connectors, and selection. `navigate` takes `view`: `home`, `ask`, `search`, `sources`, `source`, `capture`, `knowledge`, `review`, `proposals`, `extensions`, `ops`, or `settings`, plus `sourceId`, `captureId`, `knowledgeId`, `proposalId`, `extensionId`, `query`, `provider`, `status`, `issue`, or `settingsSection`.
- Use retrieval actions for full source context, not ambient screen text.

## Actions

Use `tool-search` for the full action catalog.

| Action | Purpose |
| --- | --- |
| `get-brain-settings` | Identity, tone, policy, citation, distillation settings |
| `search-everything` / `search-knowledge` / `ask-brain` | Search sources/knowledge or give a cited answer; broad search reports `federatedCoverage` |
| `get-knowledge` / `list-knowledge` / `get-capture` / `list-captures` | Read distilled knowledge or captures |
| `import-capture` / `import-transcript` / `import-markdown-files` | Ingest captures or bounded Markdown batches |
| `enqueue-distillation` / `mark-capture-distilled` / `write-knowledge` | Queue, finish, or publish knowledge |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Legacy proposal records; new writes create none |
| `set-knowledge-canonical` | Mirror published knowledge to workspace resources |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source` | Source lifecycle |
| `set-resource-visibility` / `share-resource` | Change visibility or grant access |
| `sync-source` / `sync-due-sources` / `get-brain-health` | Run sync or inspect source/queue health |
| `list-connection-providers` / `test-slack-connection` / `run-slack-pilot` | Provider readiness and Slack validation |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Raw provider HTTP |
| `run-demo-eval` / `run-retrieval-eval` / `seed-demo-data` | Demo corpus and eval checks |

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
