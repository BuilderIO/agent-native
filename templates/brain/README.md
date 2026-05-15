# Agent-Native Brain

Brain is a public first-party template for Company Brain: whole-company
institutional memory for agents and humans. V1 ingests approved Slack channels,
Clips recordings, Granola meeting notes, and generic transcript/webhook
payloads, then distills them into cited, reviewable SQL-backed knowledge.

The product direction is intentionally Glean-shaped, but the shipped V1 is not a
full enterprise search replacement. Brain starts with open-source company memory
over distilled knowledge, then expands toward universal, permission-aware
workspace search.

## Version Direction

- **V1 Company Brain:** SQL-backed search over reviewed, distilled knowledge
  with exact evidence quotes and source links.
- **V1.5 Search:** a Search route and `search-everything` action for searching
  distilled knowledge, raw captures, and source records together. Agents should
  use it as the broad first pass, then open records with `get-knowledge` or
  `get-capture`.
- **V2 platform direction:** reusable workspace connections, federated search
  across apps and sources, permission-aware result ranking, and an expertise
  graph as a future/platform layer.
- **Portability:** V1 uses portable SQL text search and agentic query expansion.
  There is no vector database requirement.

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
2. Run `sync-source` for Slack/Granola sources, import a transcript with
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
   reject it with `reject-proposal`.
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

## Slack Source Config

Slack uses the scoped `SLACK_BOT_TOKEN` credential. It only scans configured
channels and rejects DMs/MPIMs.

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

Granola uses the scoped `GRANOLA_API_KEY` credential and polls
`https://public-api.granola.ai/v1/notes`. Enterprise API keys expose Team-space
notes; private notes are not included by Granola's API.

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

GitHub is Brain's first reusable connector proof. It uses the scoped
`GITHUB_TOKEN` credential and imports bounded issue/PR context from configured
repositories through GitHub's REST API. This is company context for Brain
ingestion, not full GitHub analytics, and can later consume Workspace
Connections when that platform layer is available.

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

## Scheduled Sync

Use `sync-source` to run one source immediately, or `sync-due-sources` to run
accessible Slack/Granola sources whose `autoSync` cadence is due. The Nitro
plugin in `server/plugins/brain-jobs.ts` registers the same due-source sweep for
long-lived deployments.

## Generic Webhook

Create a source with `sourceKey` to receive a one-time ingest token:

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
