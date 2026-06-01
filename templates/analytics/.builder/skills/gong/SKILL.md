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

### Exported Functions

| Function                    | Description                               |
| --------------------------- | ----------------------------------------- |
| `getCalls(filters?)`        | List calls (cursor-paginated)             |
| `getCall(callId)`           | Get single call detail                    |
| `getCallTranscript(callId)` | Get call transcript                       |
| `getUsers()`                | List Gong users                           |
| `searchCalls(query, days)`  | List + client-side filter by company/domain/person/email |

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

# Get call transcript
pnpm action gong-calls --transcript=<callId>

# List Gong users
pnpm action gong-calls --users
```

## Key Patterns & Gotchas

- **IMPORTANT API endpoints**:
  - `GET /v2/calls` — lists calls (with `fromDateTime`, `toDateTime`, `cursor` params)
  - `POST /v2/calls` — **uploading/creating** calls (NOT listing). Using this for listing returns 400 errors about missing fields.
  - `POST /v2/calls/extensive` — detailed call data with party info
  - `POST /v2/calls/transcript` — get transcripts
- **Search pattern**: List calls via `GET /v2/calls?fromDateTime=...`, then filter client-side by company name, domain, person, or email against call title and parties. No server-side company name search.
- **Transcripts**: Have `speakerId` (numeric), `topic` (string or null), `sentences` array with `start`/`end` (ms) and `text`. Speaker IDs need cross-referencing with call parties.
- For deal/customer deep dives, set `includeTranscripts=true`; call metadata alone is not enough for objections, risks, sentiment, or next-step claims.
- Region/hostname is configurable with `GONG_API_BASE`; omit it for the global endpoint.
