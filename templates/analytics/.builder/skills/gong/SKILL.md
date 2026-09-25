---
name: gong
description: >
  Search sales call recordings, transcripts, and participants via Gong.
  Use this skill when the user asks about sales calls, customer conversations, or call transcripts.
---

# Gong Integration (Sales Calls)

## Connection

- **Base URL**: `GONG_API_BASE` if configured, otherwise `https://api.gong.io/v2`
- **Auth**: HTTP Basic — `Base64($GONG_ACCESS_KEY:$GONG_ACCESS_SECRET)`
- **Env vars**: `GONG_ACCESS_KEY`, `GONG_ACCESS_SECRET`, optional `GONG_API_BASE`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib & Action

- **File**: `server/lib/gong.ts`
- **Action**: `gong-calls`
- **Bundled deep-dive action**: `account-deep-dive` for HubSpot + Gong account
  or deal investigations.

### Exported Functions

| Function                      | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `getCalls(filters?)`          | List calls (cursor-paginated)                               |
| `getCall(callId)`             | Get single call detail                                      |
| `getCallTranscript(callId)`   | Get one call transcript                                     |
| `getCallTranscripts(callIds)` | Batch-fetch call transcripts                                |
| `getUsers()`                  | List Gong users                                             |
| `searchCalls(query, days)`    | List + filter by title and external party name/email/domain |
| `getCallDetail(callId)`       | Get parties plus Gong brief/key points/outline              |
| `getEnrichedTranscript(id)`   | Transcript mapped to Gong parties and external speakers     |

### UI API Routes

| Route                 | Description       |
| --------------------- | ----------------- |
| `GET /api/gong/calls` | List/search calls |
| `GET /api/gong/users` | List users        |

Use `gong-calls` for agent-facing Gong work. Do not call `/api/gong/*`
directly from the agent.

## Script Usage

```bash
# Recent calls with a customer, including call-content evidence
pnpm action gong-calls --company="Example Inc" --days=180 --includeTranscripts=true --transcriptLimit=5

# HubSpot + Gong account/deal deep dive
pnpm action account-deep-dive --query="Example Inc" --days=180 --gongLimit=10 --transcriptLimit=5

# Get compact transcript text
pnpm action gong-calls --transcript=<callId>

# Get the raw transcript payload only for debugging/export
pnpm action gong-calls --transcript=<callId> --rawTranscript=true

# List Gong users
pnpm action gong-calls --users
```

## Key Patterns & Gotchas

- **IMPORTANT API endpoints**:
  - `GET /v2/calls` — lists calls (with `fromDateTime`, `toDateTime`, `cursor` params)
  - `POST /v2/calls` — **uploading/creating** calls (NOT listing). Using this for listing returns 400 errors about missing fields.
  - `POST /v2/calls/extensive` — detailed call data with party info
  - `POST /v2/calls/transcript` — get transcripts
- **Search pattern**: List calls via `GET /v2/calls?fromDateTime=...`, then filter client-side by company name, domain, person, or email against title and external parties. The search path batches `/v2/calls/extensive` for party matching when the lightweight list response is missing parties. No server-side company name search.
- **Transcripts**: `gong-calls --transcript=<callId>` returns compact extracted text by default. Set `rawTranscript=true` only for debugging/export; do not pass raw transcript payloads into `save-analysis`.
- Raw Gong transcript payloads have `speakerId` (numeric), `topic` (string or null), `sentences` array with `start`/`end` (ms) and `text`. Speaker IDs need cross-referencing with call parties.
- For deal/customer deep dives, call `account-deep-dive` first when HubSpot context matters. For Gong-only follow-up, set `includeTranscripts=true`; call metadata alone is not enough for objections, risks, sentiment, or next-step claims.
- Region/hostname is configurable with `GONG_API_BASE`; omit it for the global endpoint.

## Complete-Coverage Transcript Scan

When the question asks whether any call in a cohort mentions something, do not
answer from call metadata, titles, briefs, or sampled transcript excerpts. Use a
raw transcript corpus path:

1. Discover or stage the exact call IDs in scope with bounded filters and
   explicit coverage counts.
2. Prefer `provider-corpus-job` with `mode: "batch-search"` against
   `POST /calls/transcript`.
3. Use `batch.itemBodyPath: "filter.callIds"`, `batch.responseItemsPath:
"callTranscripts"`, `batch.batchSize: 20`, `search.textPaths:
["transcript"]`, and `search.idPaths: ["callId"]`.
4. Join the stored hits back to deals/accounts with `run-code` or staged-dataset
   queries, then report cohort size, call IDs discovered, transcript records
   scanned, hits, errors, and quota gaps.

Use `provider-api-catalog --provider=gong` to retrieve the reusable corpus
recipe. A metadata scan over `/calls` or `/calls/extensive` is useful for call
discovery, but it is not evidence that transcript text lacks a phrase.
