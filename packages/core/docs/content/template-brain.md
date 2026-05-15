---
title: "Brain"
description: "A public first-party template for cited whole-company institutional memory."
---

# Brain

Brain is a first-party template for whole-company institutional memory. It ingests approved Slack channels, Clips recordings, Granola meeting notes, and generic transcript/webhook payloads, then turns that material into cited, reviewable knowledge an agent can search.

Use Brain when your team wants agents to answer questions like “why did we make this product decision?”, “how does this in-development feature work?”, or “what changed in this process?” with links back to the source conversation or meeting.

## What It Includes

- **Approved sources.** Configure manual, generic webhook, Clips, Slack, and Granola source records. Slack is channel-oriented by design; DMs and MPIMs are not a scan target.
- **Raw captures.** Store transcripts, channel exports, notes, and webhook imports in portable SQL with dedupe keys and source metadata.
- **Distilled knowledge.** Write atomic entries with kind, topic, entities, confidence, exact evidence quotes, and supersede links.
- **Review gating.** High-confidence non-sensitive entries can publish immediately; company-tier or sensitive entries can queue as proposals for approval.
- **Cited retrieval.** `search-knowledge` and `get-knowledge` are exposed as public-agent-safe read actions so Dispatch and other apps can delegate company-memory questions.
- **Ambient context.** Canonical approved entries can mirror into workspace resources under `context/company-brain/...` for cross-app context.

Brain intentionally uses SQL text search and agentic query expansion for v1. There is no vector database requirement, so the template stays portable across SQLite, Postgres, Neon, D1, Turso, and similar hosts.

## Scaffolding

```bash
pnpm dlx @agent-native/core create my-brain --template brain --standalone
```

Then open the app, add sources, import a transcript, and ask the agent to distill cited memories from the raw capture.

## Generic Ingest

Brain exposes a signed webhook at:

```txt
/api/_agent-native/brain/ingest
```

Create a source with a `sourceKey` to receive a bearer token, then send a `RawCapturePayload`:

```json
{
  "sourceKey": "clips",
  "externalId": "meeting-123",
  "title": "Pricing decision review",
  "participants": ["Ada", "Grace"],
  "occurredAt": "2026-05-15T15:00:00.000Z",
  "transcript": "We decided to keep annual pricing because...",
  "sourceUrl": "https://example.com/share/meeting-123",
  "tags": ["pricing", "product"],
  "raw": {}
}
```

Set `Authorization: Bearer <ingestToken>` on the request. Clips can export to that endpoint without Brain reading the Clips database directly.

## Slack Backfill

Brain uses the scoped `SLACK_BOT_TOKEN` credential and scans only channels that
an admin configures on the source:

```bash
pnpm --filter brain action create-source \
  --title "Slack product channels" \
  --provider slack \
  --visibility org \
  --config '{"channelIds":["C0123456789"],"historyLimit":15}'
```

The connector verifies each configured conversation before reading history and
rejects DMs and MPIMs. Cursor state is stored on the source so each sync can pick
up where the last one stopped, including after Slack rate limiting.

Use `test-slack-connection` before a production backfill. It validates the
Slack bot token with `auth.test` and, when channel refs are provided, checks
channel metadata without reading message history.

## Granola Polling

Brain uses the scoped `GRANOLA_API_KEY` credential and polls Granola's public API
for notes, then fetches each note with its transcript:

```bash
pnpm --filter brain action create-source \
  --title "Granola team notes" \
  --provider granola \
  --visibility org \
  --config '{"pageSize":10,"updatedAfter":"2026-05-01T00:00:00.000Z"}'
```

Granola Enterprise API keys expose Team-space notes, not private notes or
private folders. Brain stores the note summary, transcript, attendees, calendar
metadata, and source URL as a raw capture before distillation.

## Scheduled Sync

The Sources page includes a setup sheet for Slack, Granola, Clips, generic
webhooks, and manual imports. Slack and Granola sources can opt into
`autoSync` with a `pollMinutes` cadence. Use `sync-source` for a single source,
`sync-due-sources` for all due accessible sources, or enable
`RUN_BACKGROUND_JOBS=1` locally to let the Brain background job poll due sources
from the Nitro process.

## Demo and Eval

Brain ships with a repeatable product-decision demo corpus. `seed-demo-data`
loads Slack, Clips, Granola, and webhook-style captures; creates cited knowledge
about retiring freemium, how Decision Digest works, and why product decisions
are the lead demo; queues a policy-sensitive proposal; redacts an email; and
keeps a personal aside out of queryable knowledge.

`run-demo-eval` checks the behavior that matters most for trust: recall,
citations, supersede links, proposal gating, redaction, and personal-content
exclusion. The Ask page includes **Load demo** and **Run eval** controls so a
new workspace can show Brain's strongest use case immediately.

## Developer Notes

The template follows the agent-native four-area contract:

- **UI:** Ask, Knowledge, Review, Sources, and Settings routes.
- **Actions:** imports, source management, distillation queueing, proposal review, cited search, and navigation/context actions.
- **Skills/instructions:** Brain-specific guidance for distillation and retrieval.
- **Application state:** route, filters, and selected IDs mirror into `application_state` for agent context.

See [Dispatch](/docs/templates/dispatch) for the workspace control plane, [Workspace](/docs/workspace) for shared resources, and [A2A Protocol](/docs/a2a-protocol) for cross-app delegation.
