---
title: "Brain"
description: "A public first-party template for cited Company Brain memory and the foundation for universal workspace search."
---

# Brain

Brain is a first-party template for Company Brain: whole-company institutional memory that agents and humans can search. V1 ingests approved Slack channels, Clips recordings, Granola meeting notes, and generic transcript/webhook payloads, then turns that material into cited, reviewable knowledge an agent can search.

Use Brain when your team wants agents to answer questions like “why did we make this product decision?”, “how does this in-development feature work?”, or “what changed in this process?” with links back to the source conversation or meeting.

Brain is intentionally on an open-source, Glean-shaped path, but it is not a
complete Glean replacement today. V1 focuses on distilled company memory. V1.5
adds a universal search surface for Brain's own knowledge, captures, and
sources. V2 points toward reusable workspace connections, federated app/source
search, permission-aware results, and an expertise graph as a future platform
layer.

## What It Includes

- **Approved sources.** Configure manual, generic webhook, Clips, Slack, Granola, and GitHub source records. Slack is channel-oriented by design; DMs and MPIMs are not a scan target.
- **Raw captures.** Store transcripts, channel exports, notes, and webhook imports in portable SQL with dedupe keys and source metadata.
- **Distilled knowledge.** Write atomic entries with kind, topic, entities, confidence, exact evidence quotes, and supersede links.
- **Review gating.** High-confidence non-sensitive entries can publish immediately; company-tier or sensitive entries can queue as proposals for approval.
- **Cited retrieval.** V1 exposes `search-knowledge` and `get-knowledge` for distilled company memory. The V1.5 expansion adds a Search route and `search-everything` action for searching knowledge, raw captures, and source records together, then drilling into `get-knowledge` / `get-capture`.
- **Ambient context.** Canonical approved entries can mirror into workspace resources under `context/company-brain/...` for cross-app context.

Brain intentionally uses SQL text search and agentic query expansion for v1. There is no vector database requirement, so the template stays portable across SQLite, Postgres, Neon, D1, Turso, and similar hosts.

## Search Model

Brain search has three layers:

- **V1 Company Brain search:** answer from reviewed, distilled knowledge first.
  This is the trustworthy memory layer for decisions, policies, product facts,
  processes, and durable summaries.
- **V1.5 universal Brain search:** use `search-everything` as the broad first
  pass across knowledge, raw captures, and sources. Then call `get-knowledge`
  for reviewed entries or `get-capture` for exact source context and links.
- **V2 federated workspace search:** reuse workspace connections and search
  across apps/sources with permission-aware result filtering and ranking. The
  expertise graph belongs to this future/platform layer.

Agents should cite evidence links or source URLs whenever available. If Brain
does not return support for a question, the agent should report that honestly
instead of implying the company memory contains an answer.

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

Use `run-slack-pilot` for a safer first-pass rollout report. The default action
validates the Slack credential and allow-listed channels, reports guardrails,
privacy exclusions, current knowledge/proposal counts, and next steps, and does
not call `conversations.history`. Only pass `readHistory: true` when the user
explicitly wants a tiny sample sync; the pilot caps the read to two validated
channels, one page per channel, ten messages per page, ten permalinks,
`autoSync: false`, and a recent default history window.

After a sample sync succeeds, list the imported inventory before opening raw
message bodies:

```bash
pnpm --filter brain action list-captures \
  --sourceId <source-id> \
  --status queued
```

The listing omits raw capture content by default and includes each capture's
latest distillation queue state. Use `get-capture` for one specific record when
a reviewer or agent needs exact source context, then write only durable, cited
knowledge. Keep `autoSync` disabled until the channel allow-list, review gate,
and first distilled entries are validated.

The Sources UI has the same flow: open **Captures** on a source card to review
queued records, opt into short previews only when needed, queue distillation,
see whether a capture is waiting on the distillation worker, or mark non-company
material ignored.

When a Brain tab is open, queued distillation requests are delegated to the app
agent in the background. Re-running `enqueue-distillation` for an active queue
item refreshes that handoff instead of duplicating queue rows. The agent reads
the capture, writes cited knowledge or review proposals, then calls
`mark-capture-distilled`, which marks the active queue row done.

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

## GitHub Connector

GitHub is Brain's first reusable connector proof. It uses the scoped
`GITHUB_TOKEN` credential and imports bounded issue and pull request context
from approved repositories:

```bash
pnpm --filter brain action create-source \
  --title "GitHub product repos" \
  --provider github \
  --visibility org \
  --config '{"repositories":["owner/repo"],"state":"all","limit":25}'
```

The connector accepts `repositories` or `repos`, optional `state`, `limit`,
`includeIssues`, and `includePullRequests`. Imported items become raw captures
with stable source URLs and can be distilled like Slack or meeting context. This
is intentionally Brain context ingestion, not a replacement for Analytics-style
GitHub reporting.

## Scheduled Sync

The Sources page includes a setup sheet for Slack, Granola, GitHub, Clips,
generic webhooks, and manual imports. Slack, Granola, and GitHub sources can
opt into `autoSync` with a `pollMinutes` cadence. Use `sync-source` for a
single source, `sync-due-sources` for all due accessible sources, or enable
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
