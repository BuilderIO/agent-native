# Agent-Native Brain

Brain is a whole-company institutional memory template. It turns raw captures
(transcripts, notes, Slack/Granola exports, documents, and generic text) into
reviewed, searchable knowledge with source quotes preserved as evidence.

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
| `sync-source`                                                                       | Run the configured Slack, Granola, generic, or manual connector skeleton               |
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

Slack and Granola support a practical v1 import skeleton through `sync-source`.
Put exported items in source `config.transcripts`, `config.sampleTranscripts`, or
`config.messages`. Each item can be a string or an object with `title`, `content`
or `text`, `kind`, `capturedAt`, and `metadata`.
