# Agent-Native Brain

Brain is a whole-company institutional memory template. It turns raw captures
(Slack channel messages, Clips recordings, Granola notes, transcripts,
documents, and generic text) into reviewed, searchable knowledge with source
quotes preserved as evidence.

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
| `sync-source`                                                                       | Run a configured source connector, including Slack channel backfill and Granola polling |
| `import-capture`                                                                    | Import arbitrary raw text                                                              |
| `import-transcript`                                                                 | Import meeting transcripts                                                             |
| `get-capture`                                                                       | Read a raw capture if its source is accessible                                         |
| `enqueue-distillation`                                                              | Queue capture distillation                                                             |
| `mark-capture-distilled`                                                            | Mark a capture distilled or ignored                                                    |
| `write-knowledge`                                                                   | Create/update knowledge with quote validation, redaction, tiers, and proposal behavior |
| `get-knowledge` / `list-knowledge` / `search-knowledge`                             | Read and search knowledge                                                              |
| `list-proposals` / `approve-proposal` / `reject-proposal`                           | Review company-tier or forced proposals                                                |
| `get-settings` / `set-settings`                                                     | Read/update Brain settings                                                             |
| `navigate` / `view-screen`                                                          | Keep agent and UI context in sync                                                      |

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

Granola sources use the scoped `GRANOLA_API_KEY` credential and poll Granola's
public API for accessible Team-space notes, then fetch each note with its
transcript. Keep the Granola cursor and sync window in the source cursor/config
JSON instead of process memory.

Manual, generic, and Clips sources can still import fixture/exported items
through `config.transcripts`, `config.sampleTranscripts`, or `config.messages`.
Each item can be a string or an object with `title`, `content` or `text`, `kind`,
`capturedAt`, and `metadata`.
