# Agent-Native Brain

Brain is a Company Brain template: whole-company institutional memory for
agents and humans. V1 turns raw captures (Slack channel messages, Clips
recordings, Granola notes, transcripts, documents, and generic text) into
reviewed, searchable, SQL-backed knowledge with source quotes preserved as
evidence.

Brain is not a full Glean replacement today. Position it honestly as an
open-source, Glean-shaped foundation: durable company memory first, then a
broader permission-aware workspace search layer over time.

## Product Direction

- **V1 Company Brain:** search over distilled knowledge. Agents should answer
  from reviewed, cited entries whenever possible.
- **V1.5 universal search:** add a Search route and `search-everything` action
  that search knowledge, raw captures, and source records together, then let
  agents drill into specific knowledge/capture records for citations.
- **V2 platform layer:** reusable workspace connections, federated app/source
  search, permission-aware results, and an expertise graph. Treat the expertise
  graph as future platform direction, not a shipped V1 claim.
- **Portability:** V1 uses portable SQL text search and agentic query expansion.
  There is no vector database requirement in V1.

## Data Model

- `brain_sources` — shareable source configuration (`brain-source`)
- `brain_raw_captures` — raw imported text tied to a source
- `brain_knowledge` — shareable durable knowledge (`brain-knowledge`)
- `brain_proposals` — shareable review queue (`brain-proposal`)
- `brain_sync_runs` — connector run history
- `brain_ingest_queue` — queued distillation work

JSON is stored in text columns. There is no vector database.

## Actions

| Action                                                                              | Purpose                                                                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `create-source` / `update-source` / `delete-source` / `get-source` / `list-sources` | Manage source configuration                                                                                                            |
| `sync-source` / `sync-due-sources`                                                  | Run one source immediately or run due auto-sync sources                                                                                |
| `list-connection-providers`                                                         | List Brain-relevant reusable provider metadata, workspace connection grants for `appId=brain`, credential key names, and source status |
| `test-slack-connection`                                                             | Test Slack credentials/channel allow-lists without reading message history                                                             |
| `run-slack-pilot`                                                                   | Produce a guarded Slack pilot report; reads no history unless `readHistory: true`                                                      |
| `get-pilot-report`                                                                  | Summarize one source's sync health, queue state, privacy notes, and rollout next steps                                                 |
| `import-capture`                                                                    | Import arbitrary raw text                                                                                                              |
| `import-transcript`                                                                 | Import meeting transcripts                                                                                                             |
| `list-captures` / `get-capture`                                                     | Review raw captures by source/status, including distillation queue state                                                               |
| `enqueue-distillation` / `enqueue-captures-distillation`                            | Idempotently queue one capture or a selected batch for distillation                                                                    |
| `claim-distillation`                                                                | Claim one queued distillation item before a browser or worker hands it to the agent                                                    |
| `list-distillation-queue` / `retry-distillation`                                    | Inspect failed/stale distillation work and safely retry accessible items                                                               |
| `mark-capture-distilled`                                                            | Mark a capture distilled or ignored                                                                                                    |
| `write-knowledge`                                                                   | Create/update knowledge with quote validation, redaction, tiers, and proposal behavior                                                 |
| `get-knowledge` / `list-knowledge` / `search-knowledge`                             | Read and search distilled knowledge                                                                                                    |
| `search-everything`                                                                 | V1.5 search across knowledge, raw captures, and source records                                                                         |
| `list-proposals` / `update-proposal` / `approve-proposal` / `reject-proposal`       | Review, edit, approve, or reject company-tier or forced proposals                                                                      |
| `seed-demo-data` / `run-demo-eval`                                                  | Seed and evaluate the product-decision demo corpus                                                                                     |
| `get-settings` / `set-settings`                                                     | Read/update Brain settings                                                                                                             |
| `navigate` / `view-screen`                                                          | Keep agent and UI context in sync                                                                                                      |

## Retrieval Rules

When answering company-memory questions:

1. Call `get-brain-settings` first when current settings are not already in
   context, and apply its effective guidance. The settings control assistant
   name, company name, tone, citation requirements, source policy, default
   publish tier, redaction, and distillation instructions.
2. Start with `search-everything` when it is available. It is the V1.5 universal
   search surface and should return candidate knowledge entries, raw captures,
   and sources the current user can access.
3. Drill into promising results with `get-knowledge` for durable facts and
   `get-capture` for source context. `get-capture` is redacted by default; use
   `includeRawContent: true` only for editor-authorized distillation or exact
   quote validation. Use `search-knowledge` when only V1 distilled knowledge
   search is available.
4. Follow `sourcePolicy`: `strict` means answer from reviewed Brain knowledge
   only; `balanced` means use raw captures only when reviewed knowledge is
   missing or thin and label them clearly; `exploratory` means raw captures and
   source records can be included as clearly labeled leads, never as approved
   company memory.
5. Cite source links from knowledge evidence or raw capture metadata. Prefer
   direct source URLs/permalinks over generic source names.
6. Distinguish reviewed knowledge from raw captures. Raw captures can provide
   context, but do not present them as approved company memory unless they have
   been distilled and reviewed.
7. If search does not find support, say so plainly. Do not invent an answer or
   imply Brain contains information it did not return.

## Knowledge Rules

- `write-knowledge.evidence[].quote` must be an exact substring of the referenced capture.
- `publishTier: "private"` writes draft/private knowledge.
- `publishTier: "team"` and `"company"` use org visibility.
- Company-tier writes create a proposal by default when `requireApprovalForCompanyKnowledge` is true.
- Use `proposalMode: "never"` only when the user explicitly wants to bypass review.
- Pending proposals may be edited with `update-proposal` before approval; keep reviewer notes on the approve/reject action.
- Redactions are applied before storage. Explicit `redactions` replace matching text with `[redacted]`; settings can also auto-redact email addresses.

## Connector Notes

Slack sources use the scoped `SLACK_BOT_TOKEN` credential and only scan
explicitly configured public or private channels. Configure `channelIds`,
`channels`, or `allowedChannels` in the source config. The connector must reject
DMs and MPIMs structurally; do not broaden it to enumerate private direct
conversations.

Use `test-slack-connection` before production backfills. It calls Slack
`auth.test` and optional channel metadata checks only; it never calls
`conversations.history`.

Use `run-slack-pilot` for first-time Slack rollout checks. By default it returns
a report with credential status, allow-list validation, guardrails, privacy
exclusions, current knowledge/proposal counts, and next steps without reading
history. Only pass `readHistory: true` when the user explicitly asks for a tiny
pilot sync; the action caps the read to at most two validated channels, one
history page per channel, ten messages per page, ten permalinks, `autoSync:
false`, and a recent default history window.

After a successful pilot sync, use `list-captures` first to review capture
inventory without raw bodies. The listing includes each capture's latest
distillation queue state, so repeated `enqueue-distillation` calls should reuse
an active queue item instead of creating duplicates. Only open individual items
with `get-capture` when you need source context. Pass `includeRawContent: true`
only while performing distillation or exact quote validation; default reads are
redacted for safer review surfaces. Use `get-pilot-report` after sample syncs
to summarize sync health, queue state, privacy guardrails, proposals, and next
steps. Keep `autoSync: false` until the channel allow-list, review policy, and
first distilled/proposed entries look right.

Distillation has two worker paths. When a Brain tab is open, the app shell uses
`claim-distillation` to claim a queued item and bridges it to the agent chat in
the background. When no tab is open, the server `brain-distillation` sweep runs
under `RUN_BACKGROUND_JOBS`, reclaims stale `processing` rows, and invokes the
same agent loop headlessly. Re-running `enqueue-distillation` for an active
queue item refreshes the handoff instead of duplicating queue rows. Use
`enqueue-captures-distillation` when a user selects multiple raw captures; it
applies the same access checks and active-queue reuse per capture, returns
`queued`, `existing`, and `errors` counts plus per-capture results, and does not
fail the whole batch for inaccessible, distilled, or ignored captures. The
agent should read each capture, apply the settings/extraction rules, write cited
knowledge or proposals with `write-knowledge`, and finish each capture by
calling `mark-capture-distilled`. That final action also marks active
distillation queue rows done.

Distillation must apply `get-brain-settings` guidance. Respect
`distillationInstructions`, `defaultPublishTier`, `requireCitations`,
`sourcePolicy`, `autoRedactEmails`, and
`requireApprovalForCompanyKnowledge` when deciding what to extract, how to cite
it, and whether a raw capture should become knowledge or be ignored.

Use `list-distillation-queue` to inspect queued, processing, failed, and stale
distillation handoffs. Use `retry-distillation` only for failed or stale
processing rows; it access-checks the capture source, requeues the item, and
refreshes the agent handoff. The Ops route exposes these same queue controls in
the UI.

Granola sources use the scoped `GRANOLA_API_KEY` credential and poll Granola's
public API for accessible Team-space notes, then fetch each note with its
transcript. Keep the Granola cursor and sync window in the source cursor/config
JSON instead of process memory.

GitHub sources are the first reusable connector proof for Brain. They resolve
credentials from granted workspace connections first, then fall back to the
scoped `GITHUB_TOKEN` credential, and fetch bounded issue/PR context from
configured repositories through GitHub's REST API. Configure `repositories` or
`repos` as `["owner/repo"]`, with optional `state`, `limit`, `includeIssues`,
and `includePullRequests`. To enrich Slack pilots, configure
`linkedSlackSourceIds`, `slackSourceIds`, or `linkedSourceIds` so GitHub imports
PR and issue URLs found in accessible Slack Brain captures. Keep the bounded
limits small with `linkedCaptureLimit`, `linkedRefLimit`, `linkedDetailLimit`,
`commentLimit`, `reviewLimit`, and `repoDetailLimit`. Treat imported GitHub
captures as ingestable company context, not full GitHub analytics.

For new Brain source provider UI or agent guidance, prefer the shared provider
catalog from `@agent-native/core/connections` for provider ids, labels,
credential key names, capabilities, and recommended template uses. The catalog
is metadata only; Brain actions must still read secret values through the
existing credential vault and must never return them.

Before asking the user for a duplicate Slack, Granola, GitHub, Notion, Google
Drive, HubSpot, or other provider key, call `list-connection-providers` and
inspect each provider's `workspaceConnection` summary. A `grantState` of
`connected` means Brain already has a granted workspace connection for
`appId=brain`; prefer that shared connection path for new source work. A
`grantState` of `needs_grant` means a workspace connection exists but has not
been granted to Brain yet, so ask for the grant instead of a new secret when
that is the user's intent. Existing Brain connectors remain backward
compatible with scoped credentials such as `SLACK_BOT_TOKEN`, `GRANOLA_API_KEY`,
and `GITHUB_TOKEN`. Runtime connector sync resolves credentials in this order:
granted `workspace_connections` / `workspace_connection_grants` credential refs
for `appId=brain`, Brain-local credentials, then vault-backed registered
secrets. It does not fall back to deploy-level environment variables for source
credentials. Never include resolved credential values in action responses,
stats, errors, or logs.

Auto-sync is controlled per source with `config.autoSync` and
`config.pollMinutes`. The background job is gated by `RUN_BACKGROUND_JOBS`; use
`sync-due-sources` when the user wants to kick due Slack/Granola polling from
the agent or UI.

Manual, generic, and Clips sources can still import fixture/exported items
through `config.transcripts`, `config.sampleTranscripts`, or `config.messages`.
Each item can be a string or an object with `title`, `content` or `text`, `kind`,
`capturedAt`, and `metadata`.

## Demo/Eval

Use `seed-demo-data` to load the public product-decision demo corpus. It creates
Slack, Clips, Granola, and generic demo sources; seeds cited knowledge; creates
a pending retention proposal; archives a superseded freemium decision; and keeps
a personal aside as an ignored capture.

Use `run-demo-eval` to verify recall, citations, supersede links, proposal
gating, redaction, and personal-content exclusion. This is the fastest
repeatable check that Brain still feels like a trustworthy company memory app.

The Slack pilot regression corpus lives in
`templates/brain/evals/slack-pilot-corpus.ts`. It covers reasoning-effort
controls, Fusion PR #13340 missing-branch handling, Figma Plugin JSON uploader
feedback, non-English support, Slack history guardrails, citation requirements,
personal-content exclusion, and honest not-found behavior. Run it with
`pnpm --filter brain exec vitest --run --config vitest.config.ts evals/slack-pilot-corpus.test.ts`.
