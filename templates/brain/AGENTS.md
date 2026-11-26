# Brain — Agent Guide

Brain ingests sources, answers with evidence, and captures durable knowledge.

## Skills

Read `.agents/skills/brain/SKILL.md` for retrieval, evidence, intelligence,
personal context and recipes; `.agents/skills/ingestion-and-connectors/SKILL.md`
for sources; `.agents/skills/ask-across-everything/SKILL.md` for live app-owned
data. Internal operations: `.agents/skills/brain/RUNBOOK.md`. Shared guides live
in the root `.agents/skills/`; search with `rg --hidden --follow` and read the
matching guide before changing actions, UI, data, integrations or instructions.

Local docs only: `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`. Source examples: `pnpm action source-search --query "<pattern>"` or `pnpm action source-search --path <path>`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Hosted agents use typed Brain actions; raw database tools are disabled because ownership alone does not enforce evidence audiences. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Call `get-brain-settings` before answering, broad searches, or distilling unless settings are already in context; it defines retrieval and distillation policy.
- Cite source evidence and separate facts from inference. Copy exact quotes from `get-capture`. Disclose incomplete transcripts from any source (`withheldPassages > 0`, null/unknown, or passage-quarantine metadata); never reconstruct omitted text. See the ingestion skill.
- Capture durable, useful knowledge only; do not save secrets, transient noise, or unsupported personal data.
- Supported source providers are `manual`, `generic`, `clips`, `slack`, `granola`, `github`, `zoom`, `gmail`, `google_calendar`, and `google_drive`; `create-source` rejects others. Use `generic` for approved FAQs/docs/handbooks; see `ingestion-and-connectors` for policy and deletion semantics.
- Gong is queried on demand through provider API actions using organization-scoped credentials; it is not an indexed Brain source, and callers do not need personal Gong seats when the shared keys are configured.
- Reuse workspace integration grants (`list-connection-providers`) instead of copying provider tokens. Sync actions are convenience readers; use `provider-api-catalog`, `provider-api-docs`, and `provider-api-request` for unmodeled endpoints or filters.

## Application state

- `navigation` tracks ask/search, sources, review, memory, connectors, and selection. `navigate` takes `view`: `home`, `ask`, `search`, `sources`, `source`, `capture`, `knowledge`, `review`, `proposals`, `extensions`, `ops`, `intelligence`, or `settings`, plus `intelligenceTab`, `intelligenceId`, `period`, `owner`, `sourceId`, `captureId`, `knowledgeId`, `proposalId`, `extensionId`, `query`, `provider`, `status`, `issue`, or `settingsSection`.
- Use retrieval actions for full source context, not ambient screen text.

## Actions

Use `tool-search` for the full action catalog.

| Action | Purpose |
| --- | --- |
| `get-brain-settings` | Identity, tone, policy, citation, distillation settings |
| `search-everything` / `search-knowledge` / `ask-brain` | Search sources/knowledge or give a cited answer; broad search reports `federatedCoverage` |
| `get-knowledge` / `list-knowledge` / `get-capture` / `list-captures` | Read distilled knowledge or captures |
| `import-capture` / `import-transcript` / `import-markdown-files` | Ingest captures or bounded Markdown/plain-text batches |
| `ensure-company-context-source` | Admin-only: get or create the shared org-visible Company Context source; pass its id to `import-markdown-files` for every recurring upload |
| `get-brain-admin-status` | Whether the current user is a Brain admin (org owner/admin) |
| `enqueue-distillation` / `mark-capture-distilled` / `write-knowledge` | Queue, finish, or publish knowledge |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Legacy proposal records; new writes create none |
| `set-knowledge-canonical` | Mirror published knowledge to workspace resources |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source` | Source lifecycle |
| `set-resource-visibility` / `share-resource` | Change visibility or grant access |
| `sync-source` / `sync-due-sources` / `get-brain-health` | Run sync or inspect source/queue health |
| `list-connection-providers` / `test-slack-connection` / `run-slack-pilot` | Provider readiness and Slack validation |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Raw provider HTTP |
| `write-intelligence` / `list-intelligence` | Evidence-backed decisions, action items and customer requests; read before changing status |
| `read-priorities` / `get-entity-graph` | Cited priorities and evidence-backed entity relationships |
| `verify-knowledge` | Explicit user verification, deprecation or removal of verification |
| `list-personal-memory` / `manage-personal-memory` | Private saved work preferences; view, edit and delete |
| `list-recipes` / `manage-recipe` / `prepare-recipe` | Save a workflow, recheck its scope, then run in agent chat or an automation |
| `run-demo-eval` / `run-retrieval-eval` / `seed-demo-data` | Demo corpus and eval checks |

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
