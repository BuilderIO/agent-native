# Agent-Native Brain

Brain is a public first-party template for whole-company institutional memory.
It ingests approved Slack channels, Clips recordings, Granola meeting exports,
and generic transcript/webhook payloads, then distills them into cited,
reviewable SQL-backed knowledge.

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
2. Import a transcript with `import-transcript`, import raw text with
   `import-capture`, or POST a signed `RawCapturePayload` to
   `/api/_agent-native/brain/ingest`.
3. Ask the agent to distill the capture with `write-knowledge`.
4. Review queued proposals in the Review route or with `approve-proposal`.
5. Ask Brain or another workspace agent to call `search-knowledge` and
   `get-knowledge` for cited answers.

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
