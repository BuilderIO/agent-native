# Agent-Native Brain

Brain is a public first-party template for Company Brain: cited institutional
memory for agents and humans. It ingests approved Slack channels, Clips
recordings, Granola Team-space notes, GitHub issues/PRs, and generic
transcript/webhook payloads, then distills them into reviewable SQL-backed
knowledge with source links.

The product direction is intentionally Glean-shaped, but the shipped V1 is not a
full enterprise search replacement. Brain starts with open-source company memory
over reviewed knowledge, then expands toward universal, permission-aware
workspace search.

## Version Direction

- **V1 Company Brain:** SQL-backed search over reviewed, distilled knowledge
  with exact evidence quotes and source links.
- **V1.5 Search:** a Search route and `search-everything` action for searching
  distilled knowledge, raw captures, and source records together. Agents should
  use it as the broad first pass, then open records with `get-knowledge` or
  `get-capture`.
- **V1.5 shared credentials:** reusable workspace connections let Brain source
  sync use provider credentials granted from Dispatch or the workspace layer.
- **V2 platform direction:** federated search across apps and sources,
  permission-aware result ranking, and an expertise graph as a future/platform
  layer.
- **Portability:** V1 uses portable SQL text search and agentic query expansion.
  There is no vector database requirement.

## Product Shape

- **Full-page company chat:** the Ask route is the main surface. It runs
  `AgentChatSurface` in page mode, shows source health and review count, and
  includes Load demo / Run eval controls for first-run demos. Keep this route
  on `AgentChatSurface` so Brain uses the same composer UX as the agent sidebar
  and Agent-Native Code.
- **Repeatable first-run demo:** seed product-decision sources, run the trust
  eval, and ask a cited question before connecting a real workspace.
- **Search and drill-in:** the Search route uses `search-everything` across
  knowledge, raw captures, and source records, then agents can open exact
  records with `get-knowledge` or `get-capture`.
- **Review queue:** the Review route lists pending/approved/rejected proposals,
  lets reviewers edit proposed memory text, inspect evidence/source links, and
  approve or reject. Reviewers can publish approved proposals as shared
  `context/company-brain/...` workspace context when the memory should be
  ambient for Dispatch and other apps.
- **Source setup:** the Sources route configures Slack, Clips, Granola, GitHub,
  generic webhook, and manual sources; reviews captures; queues distillation;
  and shows reusable workspace connection grants/readiness beside Brain source
  records.
- **Ops and settings:** Ops tracks queued, processing, stale, failed, and done
  distillation work. Settings controls assistant identity, source posture,
  default publish tier, company-memory approval, citations, redaction, and
  connector notifications.

## Brain vs Dispatch

Brain is the company-memory specialist. It ingests approved sources, reviews
captures, distills durable facts and decisions, and answers from citations.

Dispatch is the workspace control plane. It owns central messaging, the shared
secrets vault, cross-app A2A routing, recurring jobs, approvals, and
workspace-wide resources. In a workspace, Dispatch can route questions to Brain
and grant Brain shared provider credentials, but Brain remains the place where
company memory is ingested, reviewed, searched, and cited.

## Start

```bash
pnpm install
pnpm --filter brain dev
```

Useful checks:

```bash
pnpm --filter brain typecheck
pnpm --filter brain build
```

## Core Flow

1. Create a source with `create-source`.
2. Run `sync-source` for Slack/Granola/GitHub sources, import a transcript with
   `import-transcript`, import raw text with `import-capture`, or POST a signed
   `RawCapturePayload` to `/api/_agent-native/brain/ingest`.
3. Review the raw capture inventory with `list-captures` or the Sources page,
   then queue durable-company-context captures with `enqueue-distillation`.
4. Distillation runs through the app agent: the open-tab bridge claims queued
   work immediately, and the `brain-distillation` background sweep handles
   queued or stale work when `RUN_BACKGROUND_JOBS` is enabled. The agent reads
   the capture, writes cited knowledge or proposals with `write-knowledge`, and
   closes the queue with `mark-capture-distilled`.
5. Monitor failed or stale handoffs in the Ops route, or with
   `list-distillation-queue` and `retry-distillation`.
6. Review queued proposals in the Review route. Reviewers can edit a pending
   proposal with `update-proposal`, then approve it with `approve-proposal` or
   reject it with `reject-proposal`. Use `--publishCanonical true` only for
   approved memories that should also be mirrored into workspace context. Brain
   previews the exact Markdown first with `preview-canonical-resource`; the
   Knowledge route and `set-knowledge-canonical` action can publish or unpublish
   canonical context later without deleting the Brain knowledge row.
7. Ask Brain or another workspace agent to search broadly with
   `search-everything` when the V1.5 search surface is available, then drill
   into `get-knowledge` / `get-capture` for cited answers. In V1-only
   workspaces, use `search-knowledge` and `get-knowledge`.

## Agent Retrieval Pattern

Agents should treat Brain as cited company memory, not a guess engine:

- Start with `search-everything` for broad questions so knowledge, raw captures,
  and sources can all be considered.
- Use `get-knowledge` for reviewed facts, decisions, policies, and durable
  summaries.
- Use `get-capture` when the answer needs source context, exact quote checking,
  or a direct link back to a meeting/transcript/message. Capture content is
  redacted by default; pass `includeRawContent: true` only for
  editor-authorized distillation or exact quote validation.
- Cite links from evidence or capture metadata whenever available.
- If Brain does not contain supporting results, say that the answer was not
  found instead of filling in from general knowledge.

## Privacy And Gating

Brain is scoped to company memory, not personal surveillance:

- Slack sync reads only configured channels and rejects DMs/MPIMs.
- Granola sync reads Team-space notes exposed by Granola's API, not private
  notes or private folders.
- Raw capture bodies are omitted from list/search responses by default. Use
  previews for intentional human review and `includeRawContent` only for
  distillation or exact quote validation.
- Source configs default to review-required, and Settings can require approval
  for company-tier knowledge before publishing.
- Settings can require citations, auto-redact emails, and notify reviewers when
  connectors degrade.
- `run-demo-eval` covers proposal gating, PII redaction, personal-content
  exclusion, citation presence, and honest not-found behavior.
- `run-retrieval-eval` covers offline real-channel-style retrieval, using
  existing workspace data when #dev-fusion/stale Fusion branch support is
  already present and seeding fallback Slack-style data when absent.

## Slack Source Config

Slack resolves `SLACK_BOT_TOKEN` from a granted workspace connection first,
then from backward-compatible Brain-local or registered vault credentials. It
only scans configured channels and rejects DMs/MPIMs.

```bash
pnpm --filter brain action create-source \
  --title "Slack product channels" \
  --provider slack \
  --visibility org \
  --config '{"channelIds":["C0123456789"],"historyLimit":15}'
```

Useful config keys:

- `channelIds`, `channels`, or `allowedChannels`: Slack channel IDs or names to
  scan.
- `historyLimit`: page size per channel. Keep this small for non-Marketplace
  Slack apps because `conversations.history` can be heavily rate limited.
- `oldest` / `updatedAfter`: optional timestamp boundary for initial backfill.
- `autoSync` and `pollMinutes`: opt the source into background polling and set
  the cadence. Background polling runs when `RUN_BACKGROUND_JOBS=1` in dev, and
  by default in production unless `RUN_BACKGROUND_JOBS=0`.

Slack scopes for the bot token should be the smallest set that supports the
configured source:

- `auth.test`: validate the token before any history read.
- `conversations.info`: verify allow-listed conversations and reject DMs/MPIMs.
- `conversations.history`: read message history from allow-listed channels.
- `chat.getPermalink`: store durable citation links for each capture.
- `conversations.list`: optional, only when a setup flow resolves channel names
  instead of using channel IDs.

Private channels require inviting the bot to the channel. Public channels may
also require an explicit join/invite depending on the Slack app posture.

For CLI/action-runner tests, store `SLACK_BOT_TOKEN` through a workspace
connection or Brain/app credential first. The source credential resolver does
not read process environment variables directly; a token in `.env.local` alone
is only useful after it has been copied into the local credential store for the
test user.

Before reading real Slack history, run a credential/channel smoke test:

```bash
pnpm --filter brain action test-slack-connection \
  --channelRefs '["C0123456789"]'
```

This calls Slack `auth.test` and optional channel metadata checks only. It never
calls `conversations.history`.

For a fuller rollout report, use the Slack pilot workflow:

```bash
pnpm --filter brain action run-slack-pilot \
  --sourceId <source-id>
```

The default pilot validates credentials and allow-listed channels, summarizes
guardrails, privacy exclusions, current knowledge/proposal counts, and next
steps, and still reads no history. Only run a tiny sample sync when explicitly
requested:

```bash
pnpm --filter brain action run-slack-pilot \
  --sourceId <source-id> \
  --readHistory true
```

Pilot sync caps reads to two validated channels, one history page per channel,
ten messages per page, ten permalinks, `autoSync: false`, and a recent default
history window.

For a production rollout, keep the first pass deliberately narrow:

1. Create one Slack source for one or two high-signal channels, using channel
   IDs where possible.
2. Keep `autoSync: false` while testing and reviewing the first imported
   captures.
3. Run `test-slack-connection`, then `run-slack-pilot` without `readHistory`.
4. If the report is clean, run one tiny `run-slack-pilot --readHistory true`
   sample.
5. Review imported captures with previews only when needed; mark social,
   personal, or thin messages ignored.
6. Distill only durable company context, approve proposal-gated memories, and
   confirm `ask-brain` cites the expected Slack permalinks.
7. Expand the page/window manually with bounded `sync-source` runs before
   turning on `autoSync`.

After the first sample succeeds, review capture inventory before distillation:

```bash
pnpm --filter brain action list-captures \
  --sourceId <source-id> \
  --status queued
```

`list-captures` omits raw message bodies by default and includes the latest
distillation queue state for each capture. Pass `--includePreview true` only
when a human is intentionally reviewing snippets. Open individual records with
`get-capture`; use `--includeRawContent true` only for distillation or exact
quote validation. Distill durable company context into `write-knowledge`, and
keep `autoSync` disabled until the source rules and review behavior look right.

After any pilot sync, generate the source-level quality report:

```bash
pnpm --filter brain action get-pilot-report \
  --sourceId <source-id>
```

The report summarizes sync health, capture counts, distillation queue state,
published knowledge, pending proposals, privacy notes, and recommended next
steps without returning raw capture bodies.

The Sources page exposes the same review inventory from each source card. Open
**Captures** to inspect queued records, enable short previews only when needed,
queue distillation for durable context, see whether a capture is waiting on the
distillation worker, or mark non-company material ignored.

For Slack sources, the source card presents the recommended pilot path as a
minimal four-step flow: **Test** validates credentials and the allow-list
without history reads, **Safe pilot** imports a tiny capped sample,
**Review captures** opens the raw inventory, and **Review queue** takes
reviewers to proposal approval before memories become durable company
knowledge.

Distillation has two worker paths. When a Brain tab is open, the app shell
claims queued items with `claim-distillation` and hands them to the app agent in
the background. When no tab is open, the `brain-distillation` server sweep runs
with `RUN_BACKGROUND_JOBS`, claims due queued rows, reclaims stale `processing`
rows, and invokes the same agent loop headlessly. Re-running
`enqueue-distillation` for an active queue item refreshes the handoff instead
of duplicating queue rows. The agent reads the capture, writes cited knowledge
or review proposals, then calls `mark-capture-distilled`, which marks the
active queue row done. If the agent does not close the queue, the worker requeues
the item with a short delay and eventually fails it after repeated attempts.

The Ops route is the operator surface for that pipeline. It shows queued,
processing, failed, done, stale, and retryable distillation work. The matching
actions are `list-distillation-queue` and `retry-distillation`; retries are
allowed only for failed or stale processing items the current user can edit.

## Granola Source Config

Granola resolves `GRANOLA_API_KEY` from a granted workspace connection first,
then from backward-compatible Brain-local or registered vault credentials, and
polls `https://public-api.granola.ai/v1/notes`. Enterprise API keys expose
Team-space notes; private notes are not included by Granola's API.

```bash
pnpm --filter brain action create-source \
  --title "Granola team notes" \
  --provider granola \
  --visibility org \
  --config '{"pageSize":10,"updatedAfter":"2026-05-01T00:00:00.000Z"}'
```

Brain persists Granola cursors in the source cursor JSON and normalizes note
summary, transcript, attendees, calendar metadata, and `web_url` into raw
captures.

## GitHub Source Config

GitHub is Brain's first reusable connector proof. It resolves `GITHUB_TOKEN`
from a granted workspace connection first, then from backward-compatible
Brain-local or registered vault credentials, and imports bounded issue/PR
context from configured repositories through GitHub's REST API. This is company
context for Brain ingestion, not full GitHub analytics.

```bash
pnpm --filter brain action create-source \
  --title "GitHub product repos" \
  --provider github \
  --visibility org \
  --config '{"repositories":["owner/repo"],"state":"all","limit":25}'
```

Useful config keys:

- `repositories` or `repos`: repository slugs like `owner/repo`.
- `state`: `open`, `closed`, or `all`; defaults to `all`.
- `limit`: bounded page size per repository, capped by the connector.
- `includeIssues` / `includePullRequests`: disable either side when a source
  should capture only issues or only PRs.
- `linkedSlackSourceIds`, `slackSourceIds`, or `linkedSourceIds`: import GitHub
  issue and PR URLs found in accessible Slack Brain captures.
- `linkedCaptureLimit`, `linkedRefLimit`, `linkedDetailLimit`, `commentLimit`,
  `reviewLimit`, and `repoDetailLimit`: keep linked imports bounded.

## Workspace Connections

`list-connection-providers` returns the Brain provider catalog plus
`workspaceConnection`, `credentialHealth`, and `providerHealth` summaries for
`appId=brain`. Use those summaries before asking for duplicate provider
credentials:

- `grantState: "connected"` means Brain already has a granted workspace
  connection for that provider.
- `grantState: "granted"` means Brain has a grant, but the connection is not
  currently active.
- `grantState: "needs_grant"` means a workspace connection exists but still
  needs a Brain grant.
- `grantState: "not_connected"` means there is no shared connection for Brain
  yet, though Brain-local or registered vault credentials may still exist.

Source sync resolves credentials in this order:

1. Granted `workspace_connections` / `workspace_connection_grants` credential
   refs for `appId=brain`.
2. Brain-local SQL credentials.
3. Registered vault secrets for the same user/org/workspace scope.

It does not fall back to deploy-level environment variables for source
credentials. Connection and grant refs point at vault secret names; they never
contain raw credential values.

The Sources route shows the same shared integration state in the provider
catalog, including readiness labels such as ready, grant needed, missing keys,
needs repair, or metadata only. Use Dispatch to connect or grant reusable
workspace credentials, then create Brain sources against those providers
without copying secret values into the Brain app.

The boundary is intentional:

- Dispatch or the workspace layer owns shared provider account metadata,
  credential ref names, and per-app grants.
- The vault owns the secret values.
- Brain owns source-specific choices: Slack channel IDs, GitHub repositories,
  Granola polling windows, sync cursors, review posture, and distillation state.
- Agents should inspect shared connection readiness first, then ask for a Brain
  grant or source config instead of asking for another raw provider token.

## Scheduled Sync

Use `sync-source` to run one source immediately, or `sync-due-sources` to run
accessible Slack/Granola sources whose `autoSync` cadence is due. The Nitro
plugin in `server/plugins/brain-jobs.ts` registers the same due-source sweep for
long-lived deployments.

## Clips And Generic Webhook

Create a Clips or generic source with `sourceKey` to receive a one-time ingest
token:

```bash
pnpm --filter brain action create-source \
  --title "Clips exports" \
  --provider clips \
  --sourceKey clips \
  --visibility org
```

Then send:

```json
{
  "sourceKey": "clips",
  "externalId": "meeting-123",
  "title": "Product decision review",
  "participants": ["Ada", "Grace"],
  "occurredAt": "2026-05-15T15:00:00.000Z",
  "transcript": "We decided to...",
  "sourceUrl": "https://example.com/share/meeting-123",
  "tags": ["product", "pricing"],
  "raw": {}
}
```

Use `Authorization: Bearer <ingestToken>`.

Clips exports use this endpoint without Brain reading the Clips database
directly. Generic sources use the same payload shape for transcripts, customer
research, meeting exports, or any bounded capture that should enter the review
and distillation pipeline.

## Data

Brain stores data in portable SQL through Drizzle:

- `brain_sources`
- `brain_raw_captures`
- `brain_knowledge`
- `brain_proposals`
- `brain_sync_runs`
- `brain_ingest_queue`

JSON stays in text columns. V1 does not require a vector database.

## Demo and Eval

Load the product-decision demo corpus:

```bash
pnpm --filter brain action seed-demo-data
```

Then run the repeatable quality check:

```bash
pnpm --filter brain action run-demo-eval
```

The eval checks product-decision recall, citation presence, supersede links,
proposal gating, PII redaction, and personal-content exclusion. The Ask page
also exposes **Load demo** and **Run eval** controls for template demos.

Run the real-channel-style retrieval eval:

```bash
pnpm --filter brain action run-retrieval-eval
```

This eval checks #dev-fusion stale Fusion branch retrieval, Slack-style citation
presence, branch-safety terms, and an unsupported cleanup-cron not-found case.
It evaluates existing workspace data first; if the answer cases do not have
citation-backed support and `seedIfMissing` is true, it seeds a tiny portable SQL
fallback corpus and re-runs the checks. The same eval is available through
`run-demo-eval` with `mode: "retrieval"`.

CI and `pnpm prep` run the deterministic action evals through the repository
script:

```bash
pnpm test:brain-evals
```

That command uses a disposable local SQLite database at
`templates/brain/data/brain-evals-ci.db`, seeds any missing demo/fallback
fixtures, and removes the database when it exits. It does not call Slack,
Granola, Clips, or any external service.

The Slack pilot regression set lives in
`templates/brain/evals/slack-pilot-corpus.ts`. It contains redacted pilot
questions for reasoning-effort controls, Fusion PR #13340 missing-branch
handling, Figma Plugin JSON uploader feedback, non-English support, Slack
history guardrails, citation requirements, personal-content exclusion, and
honest not-found behavior.

```bash
pnpm --filter brain exec vitest --run --config vitest.config.ts evals/slack-pilot-corpus.test.ts
```

The eval is offline and validates the real `searchEverythingRows` retrieval
path plus `ask-brain` cited-answer behavior.
