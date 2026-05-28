# Agent-Native Brain

Brain is a Company Brain template: clean company chat backed by cited
institutional knowledge. The Ask route is the primary product surface for humans
and agents; Sources, Review, Knowledge, Ops, and Settings are support/admin
surfaces for ingestion, trust, and operations. V1 turns imported captures
(Slack channel messages, Clips recordings, Granola notes, transcripts,
documents, and generic text) into reviewed, searchable, SQL-backed knowledge
with source quotes preserved as evidence. Transcript-style sources are
sanitized before storage by default so Brain stores the company-relevant
capture, not the full raw call transcript or provider payload.

Brain is not a full Glean replacement today. Position it honestly as an
open-source, Glean-shaped foundation: durable company knowledge first, then a
broader permission-aware workspace search layer over time.

## Product Direction

- **V1 Company Brain:** company chat over distilled knowledge. Agents should
  answer from reviewed, cited entries whenever possible.
- **V1.5 Brain-wide search:** add a Search route and `search-everything` action
  that search knowledge, raw captures, and source records together, then let
  agents drill into specific knowledge/capture records for citations.
- **V2 platform layer:** federated app/source search, permission-aware results,
  and an expertise graph. Treat the expertise graph as future platform
  direction, not a shipped V1 claim.
- **Reusable integrations:** workspace integrations are a framework primitive
  for provider identity, safe credential refs, and per-app grants. Brain still
  owns source config such as channel allow-lists, repositories, cursors, review
  posture, and distillation state. The provider-reader runtime adds a
  conservative shared contract for provider search/get/listRecent operations;
  live provider API readers remain template-owned until explicitly marked
  shared.
- **Federated answers:** Brain should answer from Brain knowledge when it has
  cited support. When a question needs live app-owned data, delegate to the
  specialized app agent or action instead of expanding Brain into every
  provider reader.
- **Portability:** V1 uses portable SQL text search and agentic query expansion.
  There is no vector database requirement in V1.

## Data Model

- `brain_sources` — shareable source configuration (`brain-source`)
- `brain_raw_captures` — imported capture text tied to a source; transcript
  bodies are pre-sanitized before storage by default
- `brain_knowledge` — shareable durable knowledge (`brain-knowledge`)
- `brain_proposals` — shareable review queue (`brain-proposal`)
- `brain_sync_runs` — connector run history
- `brain_ingest_queue` — queued distillation work

JSON is stored in text columns. There is no vector database.

## Ask Chat UX

Fresh loads of the Ask route intentionally start a new empty chat instead of
restoring the previous active thread. Past chats stay available from the left
sidebar, sorted with pinned chats first and then most-recently-updated chats.
Archived chats are hidden from the sidebar. Users can rename visible chats from
the sidebar chat menu, and agents can do the same with `chat-history` action
`rename` after finding the thread ID by searching prior conversations.

## Actions

| Action                                                                              | Purpose                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create-source` / `update-source` / `delete-source` / `get-source` / `list-sources` | Manage source configuration                                                                                                                                                          |
| `sync-source` / `sync-due-sources`                                                  | Run one source immediately or run due auto-sync sources                                                                                                                              |
| `list-connection-providers`                                                         | List Brain-relevant reusable provider metadata, workspace connection grants for `appId=brain`, credential key names, and source status                                               |
| `get-brain-health`                                                                  | Summarize first-run setup, configured/connected sources, sync freshness, queue/proposal counts, and the latest eval score                                                            |
| `test-slack-connection`                                                             | Test Slack credentials/channel allow-lists without reading message history                                                                                                           |
| `run-slack-pilot`                                                                   | Produce a guarded Slack pilot report; reads no history unless `readHistory: true`                                                                                                    |
| `get-pilot-report`                                                                  | Summarize one source's sync health, queue state, privacy notes, rollout next steps, and the compact #dev-fusion trust lane                                                           |
| `import-capture`                                                                    | Import arbitrary raw text                                                                                                                                                            |
| `import-transcript`                                                                 | Import meeting transcripts                                                                                                                                                           |
| `list-captures` / `get-capture`                                                     | Review raw captures by source/status, including distillation queue state                                                                                                             |
| `resanitize-captures`                                                               | Re-run the pre-storage transcript sanitizer over existing captures; use dryRun first because non-dry-run skips captures with derived citations unless allowCitationDrift is explicit |
| `enqueue-distillation` / `enqueue-captures-distillation`                            | Idempotently queue one capture or a selected batch for distillation                                                                                                                  |
| `claim-distillation`                                                                | Claim one queued distillation item before a browser or worker hands it to the agent                                                                                                  |
| `list-distillation-queue` / `retry-distillation`                                    | Inspect queue counts, failed/stale/retryable work, failure reasons, and safely retry one, selected, or all accessible items                                                          |
| `mark-capture-distilled`                                                            | Mark a capture distilled or ignored                                                                                                                                                  |
| `write-knowledge`                                                                   | Create/update knowledge with quote validation, redaction, tiers, and proposal behavior                                                                                               |
| `preview-canonical-resource`                                                        | Preview the exact Markdown Brain will mirror under `context/company-brain/...` before approval or publish/unpublish                                                                  |
| `set-knowledge-canonical`                                                           | Publish or unpublish approved Brain knowledge as shared `context/company-brain/...` workspace context                                                                                |
| `get-knowledge` / `list-knowledge` / `search-knowledge`                             | Read and search distilled knowledge                                                                                                                                                  |
| `search-everything`                                                                 | V1.5 search across Brain-indexed knowledge, raw captures, and source records, plus federated coverage/delegation hints                                                               |
| `list-proposals` / `update-proposal` / `approve-proposal` / `reject-proposal`       | Review, edit, approve, or reject company-tier or forced proposals                                                                                                                    |
| `seed-demo-data` / `run-demo-eval` / `run-retrieval-eval`                           | Seed and evaluate product-decision demos and offline real-channel-style retrieval checks                                                                                             |
| `get-settings` / `set-settings`                                                     | Read/update Brain settings                                                                                                                                                           |
| `navigate` / `view-screen`                                                          | Keep agent and UI context in sync                                                                                                                                                    |

## Retrieval Rules

When answering company-knowledge questions:

1. Call `get-brain-settings` first when current settings are not already in
   context, and apply its effective guidance. The settings control assistant
   name, company name, tone, citation requirements, source policy, default
   publish tier, pre-save capture sanitization, redaction, and distillation
   instructions.
2. Start with `search-everything` when it is available. It is the V1.5
   Brain-wide search surface and should return candidate knowledge entries, raw
   captures, and sources the current user can access. Its `federatedCoverage`
   section is metadata only: it lists Brain source/provider coverage, reusable
   workspace connection readiness, compact discovered agent metadata when
   available, and deterministic hints for where to delegate next. It does not
   search sibling app databases or call other agents.
3. Drill into promising results with `get-knowledge` for durable facts and
   `get-capture` for source context. `get-capture` is redacted by default; use
   `includeRawContent: true` only for editor-authorized distillation or exact
   quote validation. Use `search-knowledge` when only V1 distilled knowledge
   search is available.
4. Follow `sourcePolicy`: `strict` means answer from reviewed Brain knowledge
   only; `balanced` means use raw captures only when reviewed knowledge is
   missing or thin and label them clearly; `exploratory` means raw captures and
   source records can be included as clearly labeled leads, never as approved
   company knowledge.
5. Cite source links from knowledge evidence or raw capture metadata. Prefer
   direct source URLs/permalinks over generic source names.
6. Distinguish reviewed knowledge from raw captures. Raw captures can provide
   context, but do not present them as approved company knowledge unless they have
   been distilled and reviewed.
7. If search does not find support, say so plainly. Do not invent an answer or
   imply Brain contains information it did not return.
8. When `federatedCoverage.delegationHints` points at another app, delegate from
   the agent loop with `call-agent` rather than inside Brain actions. Examples:
   Analytics owns dashboards/metrics, Mail/Gmail owns mailbox-native search,
   and Dispatch owns workspace resources, provider grants, approvals, secrets,
   recurring jobs, and cross-app routing.

Use the `ask-across-everything` skill for prompts that mix Brain knowledge with
live/app-owned data. It encodes the Brain-first, inspect coverage, delegate,
then synthesize-with-boundaries loop.

## Knowledge Rules

- `write-knowledge.evidence[].quote` must be an exact substring of the referenced capture.
- `publishTier: "private"` writes draft/private knowledge.
- `publishTier: "team"` and `"company"` use org visibility.
- New shared/company knowledge should default to org-shared visibility only after
  source allow-lists, exclusions, redaction, and review gates have been applied.
- Company-tier writes create a proposal by default when `requireApprovalForCompanyKnowledge` is true.
- Use `proposalMode: "never"` only when the user explicitly wants to bypass review.
- Pending proposals may be edited with `update-proposal` before approval; keep reviewer notes on the approve/reject action.
- Call `preview-canonical-resource` before approving a proposal with `publishCanonical: true` or publishing/unpublishing a knowledge item with `set-knowledge-canonical`; show the Markdown to the user when they ask what will become ambient context.
- Use `approve-proposal --publishCanonical=true` when a reviewed item should become ambient company context for Dispatch and other apps. Otherwise leave canonical publishing off and use `set-knowledge-canonical` later for an intentional publish/unpublish decision.
- Redactions are applied before storage. Explicit `redactions` replace matching text with `[redacted]`; settings can also auto-redact email addresses.

## Capture Sanitization Rules

Brain passes this `AGENTS.md` content into the model-based pre-storage
sanitizer. Keep durable company/product/customer/GTM/technical/process
information, but strip content that should not be saved in `brain_raw_captures`.

- Recruiting is always sensitive. Remove hiring, candidate evaluation,
  interview feedback, compensation, references, recruiting pipeline, search
  firm, offer, and personnel-assessment content even when it mentions product,
  GTM, strategy, or company context.
- Remove personal life details, casual small talk, private contact details,
  secrets, credentials, raw speaker names, and third-party biographical details.
- Preserve only the company-relevant capture that is safe to review and distill.
  Do not preserve raw transcript bodies as a fallback.
- If a capture is mostly recruiting or personal context, keep the sanitized body
  as `No company-relevant content retained from this capture.`

## Connector Notes

Slack sources use the scoped `SLACK_BOT_TOKEN` credential and only scan
explicitly configured public or private channels. Configure `channelIds`,
`channels`, or `allowedChannels` in the source config. The connector must reject
DMs and MPIMs structurally; do not broaden it to enumerate private direct
conversations.

Slack, Granola, and GitHub sources may include a non-secret
`workspaceConnectionId` in source config. Treat that as an exact binding to a
shared workspace connection granted to `appId=brain`: credential resolution must
use that connection only and fail clearly if it is missing, not granted,
unhealthy, or missing the required credential ref. Do not silently fall back to a
different shared connection, Brain-local credential, or registered vault secret
for a bound source. Leave `workspaceConnectionId` unset when the legacy fallback
order is desired.

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

For the real `#dev-fusion` Slack pilot, keep the loop concrete and narrow:
validate the source, run one safe sample, review captures, distill/propose only
durable company knowledge, approve proposal-gated items, then call
`get-pilot-report`. Its `pilotTrustLane` field summarizes whether the source is
blocked, ready to sample, waiting on distillation, waiting on review, waiting on
retrieval eval, or ready for a narrow expansion. Use the returned
`nextActions` and `evalQuestions` before enabling broader sync.

Slack pilot actions should remain progressively disclosed. Keep the main
Sources UI focused on configured sources, sync, captures, and tuning; expose
connection tests, safe samples, and pilot reports through advanced flows or
agent actions rather than always-visible source-card controls. Do not make broad
sync the primary first-run action.

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
distillation handoffs. It returns all-accessible queue counts in `summary`, the
current filtered list counts in `visibleSummary`, per-item failure or state
reasons, and `retryable` flags for failed or stale processing rows. Use
`issue: "failed"`, `issue: "stale"`, or `issue: "retryable"` when triaging
operator work.

Use `retry-distillation` only for failed or stale processing rows; it
access-checks the capture source, requeues the item, refreshes the agent
handoff, and includes the current Brain distillation guidance in the handoff.
Pass `queueId` or `captureId` for one item, `queueIds` for selected Ops rows, or
`retryAllRetryable: true` with an optional `sourceId`/`limit` for a batch. Batch
retries return per-item `results` so inaccessible or no-longer-stale rows do
not hide the rest of the retry outcome. The Ops route exposes these same queue
filters, counts, failure reasons, selected retry, and retry-all controls in the
UI, and `view-screen` includes the current Ops queue snapshot when the user is
on that route.

Granola sources use the scoped `GRANOLA_API_KEY` credential and poll Granola's
public API for accessible Team-space notes, then fetch each note with its
transcript. Keep the Granola cursor and sync window in the source cursor/config
JSON instead of process memory. Granola transcript text, attendees, calendar
objects, and transcript segments pass through the pre-storage sanitizer before
`brain_raw_captures` is written; source metadata keeps safe linkage such as
`sourceUrl`, connector, and sync run ids.

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

Use `summarizeWorkspaceConnectionProviderForApp()` from
`@agent-native/core/workspace-connections` for Brain-facing app grant summaries.
It returns the shared `grantState`, `grantAvailability`, safe credential ref
names, explicit grant metadata, and connection counts used by Dispatch and
Analytics, so Brain should not reimplement `allowedApps` or explicit grant
checks locally.

The ownership boundary is strict: reusable workspace integrations own provider
identity, credential ref names, account metadata, and app grants; Dispatch is
the usual admin control plane for connecting, repairing, and granting them; the
vault owns the secret values; Brain owns source-specific configuration and the
ingestion/distillation/review/search/citation pipeline.
Credential resolution, grants, provider readiness, safe metadata, and
provider-reader contracts are shared today. The provider-reader runtime can call
registered handlers through granted workspace connections, but initial live
handlers are still template-owned. OAuth flows, provider-specific API readers,
ingestion cursors, source filters, and review semantics remain Brain-local
unless a reader is explicitly promoted to shared.

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

For "ask across everything" requests, do not treat Brain as the owner of every
workspace system. Use Brain search for reviewed knowledge and accessible captures.
If the user asks for live metrics, dashboard numbers, CRM pipeline analysis,
mailbox state, calendar availability, Dispatch policy, or another app-owned
surface, call the specialized app agent/action through A2A when available and
ground the answer in that result. Brain may summarize and cite the handoff, but
it should not fabricate live data or bypass the owning app's permissions and
domain rules.

## A2A Retrieval

Brain's public A2A capability is read-only, citation-backed retrieval for
company-knowledge questions. Treat the public agent card as discovery metadata, not
anonymous data access. Actual retrieval still runs through the authenticated
A2A/action context and must obey access filters, source policy, redaction,
review gates, and citation requirements. If a request asks Brain to mutate
state, sync a source, approve/reject review items, or write knowledge, it should
go through authenticated app actions instead of the public retrieval fallback.

`ask-brain` is the external-facing public-agent company lookup. It is GET +
read-only + `publicAgent: { expose: true, readOnly: true, requiresAuth: true }`,
so an external coding agent or A2A peer can ask a company-knowledge question over
MCP and get a cited answer back. Every citation now carries a `deepLink`:
knowledge citations link to `view: "knowledge"` + `knowledgeId`, capture
citations to `view: "capture"` + `captureId` (resolved to the Search surface,
which is where raw captures live). The result also exposes a top-level
`deepLink` pointing at the primary citation and surfaces an
"Open knowledge/capture in Brain" deep link so the calling agent can drop the
user straight into the focused Brain record. `search-everything` is the same
shape for the broader Brain-wide search: every result gets a per-record
`deepLink` and the response carries a top-level "Open search in Brain" list
link. These links are pure pointers — the record-focusing `navigate` write is
always scoped to the browser session via `/_agent-native/open`, never the
external agent's token, and retrieval still obeys access filters, source policy,
redaction, and citation requirements.

Auto-sync is controlled per source with `config.autoSync` and
`config.pollMinutes`. The background job is gated by `RUN_BACKGROUND_JOBS`; use
`sync-due-sources` when the user wants to kick due Slack/Granola polling from
the agent or UI.

Manual, generic, and Clips sources can still import fixture/exported items
through `config.transcripts`, `config.sampleTranscripts`, or `config.messages`.
Each item can be a string or an object with `title`, `content` or `text`, `kind`,
`capturedAt`, and `metadata`. Transcript imports from these paths share the
same pre-storage sanitization boundary. Set source config
`sanitizeBeforeStorage: false` only when the user explicitly wants raw transcript
retention for that source.

## Demo/Eval

Use `seed-demo-data` to load the public product-decision demo corpus. It creates
Slack, Clips, Granola, and generic demo sources; seeds cited knowledge; creates
a pending retention proposal; archives a superseded freemium decision; and keeps
a personal aside as an ignored capture.

Use `run-demo-eval` to verify recall, citations, supersede links, proposal
gating, redaction, and personal-content exclusion. This is the fastest
repeatable check that Brain still feels like a trustworthy company knowledge app.

Use `run-retrieval-eval` for the offline real-channel-style retrieval checks.
It first evaluates existing workspace Brain data; when the #dev-fusion/stale
Fusion branch answer cases lack citation-backed support and `seedIfMissing` is
true, it seeds a small Slack-style #dev-fusion fallback corpus and re-runs the
same checks. The eval requires Slack-style citation links, verifies branch-safety
terms, and includes an unsupported cleanup-cron not-found check. You can also run
the same mode through `run-demo-eval` with `mode: "retrieval"`.

CI/prep run both deterministic action evals through `pnpm test:brain-evals`
at the repository root, which delegates to `pnpm --filter brain eval:ci`. The
Brain CI script pins `DATABASE_URL` to a disposable local SQLite file
(`./data/brain-evals-ci.db`) and sets a fixed `AGENT_USER_EMAIL`, so it never
requires production Slack, Granola, external services, or a pre-populated local
workspace. Keep new CI eval cases offline and seeded.

The Slack pilot regression corpus lives in
`templates/brain/evals/slack-pilot-corpus.ts`. It covers reasoning-effort
controls, Fusion PR #13340 missing-branch handling, Figma Plugin JSON uploader
feedback, non-English support, Slack history guardrails, citation requirements,
personal-content exclusion, and honest not-found behavior. Run it with
`pnpm --filter brain exec vitest --run --config vitest.config.ts evals/slack-pilot-corpus.test.ts`.
