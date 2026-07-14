# Brain — Agent Guide

Brain is an agent-native workspace knowledge system. The agent ingests sources,
distills memories, answers across connected knowledge, cites evidence, and
captures durable learnings through actions and shared state.

Detailed retrieval, capture, connector, and feature rules live in
`.agents/skills/`.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use Brain actions for ingestion, search, retrieval, distillation, capture,
  review, and connector work. Do not bypass access checks or ownable scopes.
- **Call `get-brain-settings` before answering, searching broadly, or
  distilling** if settings aren't already in context. The returned guidance
  encodes every retrieval and distillation rule below as concrete policy —
  read `brain` for how `sourcePolicy` and publish-tier gating actually work.
- Retrieval answers must be evidence-backed. Cite or summarize source context and
  clearly separate facts from inference.
- Do not fabricate source contents, dates, people, permissions, or connector
  health. Inspect sources when unsure.
- Capture only durable, useful knowledge. Avoid storing secrets, transient noise,
  or unsupported personal data.
- Use `view-screen` when the active source, review item, search, or collection is
  unclear.
- For connector work, use existing workspace integration grants when available;
  do not duplicate provider tokens into Brain. `list-connection-providers`
  shows readiness (`connected`, `granted`, `needs_grant`, `not_connected`) per
  provider before you ask the user for another credential.
- Source sync actions are convenience readers, not integration limits. For ad
  hoc provider analysis or questions that need an endpoint/filter/payload the
  source actions do not model, call `provider-api-catalog` /
  `provider-api-docs`, then `provider-api-request` against the provider's real
  HTTP API. Use `connectionId` for a specific shared grant and `accountId` for a
  specific OAuth account.
- Sources support exactly five providers: `manual`, `generic`, `clips`,
  `slack`, `granola`, `github` (`sourceProviderSchema` in `actions/_schemas.ts`).
  `create-source` rejects anything else.
- **Evidence quotes must be exact substrings.** `write-knowledge` calls
  `validateEvidence`, which throws if `evidence[].quote` is not found verbatim
  in the referenced capture's content. Copy the quote from `get-capture`
  output — do not paraphrase, trim mid-sentence in a way that changes the
  substring, or reconstruct it from memory.
- `review-proposal` and `approve-proposal`/`reject-proposal` overlap:
  `review-proposal` is the general one (`decision`: `approve` | `reject` |
  `needs_changes`); `approve-proposal` and `reject-proposal` are narrower
  single-purpose actions with the same underlying effect. Any of them is
  correct; don't call more than one for the same proposal.

## Action Map

| Action                                                                                            | Purpose                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `get-brain-settings`                                                                              | Identity, tone, `sourcePolicy`, citation, and distillation settings — read first.                       |
| `search-everything`                                                                               | Broad search across knowledge + captures + sources, plus `federatedCoverage`.                           |
| `search-knowledge`                                                                                | SQL text search over distilled knowledge only.                                                          |
| `ask-brain`                                                                                       | Cited-answer endpoint: reviewed knowledge, capped raw-capture fallback, citations, `federatedCoverage`. |
| `get-knowledge` / `list-knowledge`                                                                | Read one or list distilled knowledge records.                                                           |
| `get-capture` / `list-captures`                                                                   | Read one or list raw captures (redacted by default; `includeRawContent` for exact quotes).              |
| `import-capture` / `import-transcript`                                                            | Ingest a generic capture or a meeting transcript; auto-creates a `manual` source.                       |
| `enqueue-distillation` / `mark-capture-distilled`                                                 | Queue a capture for distillation; close out the queue row when done.                                    |
| `write-knowledge`                                                                                 | Write/update durable knowledge; may return a pending proposal — see Publish Tiers below.                |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Human-review workflow for gated writes.                                                                 |
| `set-knowledge-canonical`                                                                         | Mirror/unmirror approved knowledge into `context/company-brain/...` workspace resources.                |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source`               | Source lifecycle across the five providers.                                                             |
| `sync-source` / `sync-due-sources`                                                                | Run one connector now, or sweep all due sources.                                                        |
| `get-brain-health`                                                                                | Setup/source health, sync freshness, queue and proposal counts, next steps.                             |
| `list-connection-providers`                                                                       | Per-provider workspace-connection readiness and credential health.                                      |
| `test-slack-connection` / `run-slack-pilot`                                                       | Slack credential/channel validation and bounded first-sync report.                                      |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request`                             | Raw provider HTTP calls beyond the source actions.                                                      |
| `run-demo-eval` / `run-retrieval-eval` / `seed-demo-data`                                         | Demo corpus and offline eval checks (see `brain-runbook`).                                              |

## Application State

- `navigation` exposes ask/search, sources, review, memory, connector, and
  selected item context.
- `navigate` moves the UI to a typed `view`: `home`, `ask`, `search`,
  `sources`, `source`, `capture`, `knowledge`, `review`, `proposals`,
  `extensions`, `ops`, or `settings`, with matching `sourceId` / `captureId` /
  `knowledgeId` / `proposalId` / `extensionId` / `query` / `provider` /
  `status` / `issue` params.
- Use retrieval actions for full source context instead of ambient screen text.

## Retrieval Policy Is Configurable — Read It, Don't Assume

`sourcePolicy` (in Brain settings) changes what `ask-brain` and
`search-everything` are allowed to answer from, and it is enforced in code,
not just documented:

| `sourcePolicy`       | `rawCaptureFallback` | Behavior                                                                                                                                                                      |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict`             | `never-answer`       | Reviewed knowledge only. If knowledge is missing/thin, say so — never fall back to raw captures as answer support.                                                            |
| `balanced` (default) | `thin-results`       | Prefer reviewed knowledge; fall back to raw captures only when knowledge is missing or combined summary+body text is under ~260 chars, and label them as raw capture matches. |
| `exploratory`        | `allowed-leads`      | Always include accessible raw captures/sources alongside knowledge, clearly labeled as unreviewed leads.                                                                      |

`requireCitations` (default true) additionally blocks `ask-brain` from
returning an answer with no usable citation — it returns a policy-explanation
message instead of a bare summary when that happens.

## Publish Tiers And Proposal Gating

`write-knowledge` writes at a `publishTier`: `private` (draft, private
visibility), `team`, or `company` (published, org visibility) — default comes
from `settings.defaultPublishTier`. A `company`-tier write becomes a
**proposal** (`mode: "proposal"`, held for human review) instead of publishing
immediately when ALL of:

- `proposalMode !== "never"`, and
- `tier === "company"`, and
- `settings.requireApprovalForCompanyKnowledge` is true, and
- it is NOT a high-confidence auto-publish (`confidence >= 90` AND it's a new
  record, no `knowledgeId` AND nothing was redacted).

Setting `proposalMode: "always"` forces a proposal regardless of tier/settings;
`proposalMode: "never"` only works when the caller also has bypass access
(e.g. `approve-proposal`/`review-proposal` set it internally). If
`write-knowledge` returns `mode: "proposal"`, leave it in review unless the
user explicitly asks to approve it now.

## Skills

Read the relevant skill before deeper work:

- `brain` for core ingestion, distillation, retrieval, and review flows —
  including exact publish-tier/proposal mechanics and capture sanitization.
- `ask-across-everything` for cross-source answers and `federatedCoverage`
  delegation.
- `ingestion-and-connectors` for source lifecycle, health states, Slack
  backfill rollout, and provider credential resolution order.
- `brain/RUNBOOK.md` (the `brain-runbook` skill) for internal architecture,
  ops, and rollout detail: search layers, distillation worker internals,
  scheduled sync, demo/eval internals, and generic ingest payloads. Read it
  only when operating or debugging Brain internals.
- `adding-a-feature` for Brain feature changes.
- `actions`, `real-time-sync`, `security`, `frontend-design`, and `shadcn-ui`
  for framework work. The `actions` skill includes the shared provider API
  pattern for flexible integrations.
