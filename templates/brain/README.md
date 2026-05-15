# Agent-Native Brain

Brain is a public first-party template for whole-company institutional memory.
It ingests approved Slack channels, Clips recordings, Granola meeting notes, and
generic transcript/webhook payloads, then distills them into cited, reviewable
SQL-backed knowledge.

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
3. Ask the agent to distill the capture with `write-knowledge`.
4. Review queued proposals in the Review route or with `approve-proposal`.
5. Ask Brain or another workspace agent to call `search-knowledge` and
   `get-knowledge` for cited answers.

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
