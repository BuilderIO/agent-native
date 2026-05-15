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

| Action                                                                              | Purpose                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `create-source` / `update-source` / `delete-source` / `get-source` / `list-sources` | Manage source configuration                                                            |
| `sync-source` / `sync-due-sources`                                                  | Run one source immediately or run due auto-sync sources                                |
| `test-slack-connection`                                                             | Test Slack credentials/channel allow-lists without reading message history             |
| `run-slack-pilot`                                                                   | Produce a guarded Slack pilot report; reads no history unless `readHistory: true`      |
| `import-capture`                                                                    | Import arbitrary raw text                                                              |
| `import-transcript`                                                                 | Import meeting transcripts                                                             |
| `get-capture`                                                                       | Read a raw capture if its source is accessible                                         |
| `enqueue-distillation`                                                              | Queue capture distillation                                                             |
| `mark-capture-distilled`                                                            | Mark a capture distilled or ignored                                                    |
| `write-knowledge`                                                                   | Create/update knowledge with quote validation, redaction, tiers, and proposal behavior |
| `get-knowledge` / `list-knowledge` / `search-knowledge`                             | Read and search distilled knowledge                                                    |
| `search-everything`                                                                 | V1.5 search across knowledge, raw captures, and source records                         |
| `list-proposals` / `approve-proposal` / `reject-proposal`                           | Review company-tier or forced proposals                                                |
| `seed-demo-data` / `run-demo-eval`                                                  | Seed and evaluate the product-decision demo corpus                                     |
| `get-settings` / `set-settings`                                                     | Read/update Brain settings                                                             |
| `navigate` / `view-screen`                                                          | Keep agent and UI context in sync                                                      |

## Retrieval Rules

When answering company-memory questions:

1. Start with `search-everything` when it is available. It is the V1.5 universal
   search surface and should return candidate knowledge entries, raw captures,
   and sources the current user can access.
2. Drill into promising results with `get-knowledge` for durable facts and
   `get-capture` for source context or exact quotes. Use `search-knowledge`
   when only V1 distilled knowledge search is available.
3. Cite source links from knowledge evidence or raw capture metadata. Prefer
   direct source URLs/permalinks over generic source names.
4. Distinguish reviewed knowledge from raw captures. Raw captures can provide
   context, but do not present them as approved company memory unless they have
   been distilled and reviewed.
5. If search does not find support, say so plainly. Do not invent an answer or
   imply Brain contains information it did not return.

## Knowledge Rules

- `write-knowledge.evidence[].quote` must be an exact substring of the referenced capture.
- `publishTier: "private"` writes draft/private knowledge.
- `publishTier: "team"` and `"company"` use org visibility.
- Company-tier writes create a proposal by default when `requireApprovalForCompanyKnowledge` is true.
- Use `proposalMode: "never"` only when the user explicitly wants to bypass review.
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

Granola sources use the scoped `GRANOLA_API_KEY` credential and poll Granola's
public API for accessible Team-space notes, then fetch each note with its
transcript. Keep the Granola cursor and sync window in the source cursor/config
JSON instead of process memory.

GitHub sources are the first reusable connector proof for Brain. They use the
scoped `GITHUB_TOKEN` credential and fetch bounded issue/PR context from
configured repositories through GitHub's REST API. Configure `repositories` or
`repos` as `["owner/repo"]`, with optional `state`, `limit`, `includeIssues`,
and `includePullRequests`. Treat imported GitHub captures as ingestable company
context, not full GitHub analytics. This connector can later move to Workspace
Connections once that reusable connection layer is available.

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
