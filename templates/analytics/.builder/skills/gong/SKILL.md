---
name: gong
description: >
  Search sales call recordings, transcripts, and participants via Gong.
  Use this skill when the user asks about sales calls, customer conversations, or call transcripts.
---

# Gong Integration (Sales Calls)

## Connection

- **Base URL**: `https://us-65885.api.gong.io/v2` (region-specific)
- **Auth**: HTTP Basic — `Base64($GONG_ACCESS_KEY:$GONG_ACCESS_SECRET)`
- **Env vars**: `GONG_ACCESS_KEY`, `GONG_ACCESS_SECRET`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib & API Routes

- **File**: `server/lib/gong.ts`

### Exported Functions

| Function | Description |
|---|---|
| `getCalls(filters?)` | List calls (cursor-paginated) |
| `getCall(callId)` | Get single call detail |
| `getCallTranscript(callId)` | Get call transcript |
| `getUsers()` | List Gong users |
| `searchCalls(query, days)` | List + client-side filter by company name |

### API Routes

| Route | Description |
|---|---|
| `GET /api/gong/calls` | List/search calls |
| `GET /api/gong/users` | List users |

## Script Usage

```bash
# Recent calls with a customer
pnpm script gong-calls --company=Deloitte --days=30

# Get call transcript
pnpm script gong-calls --transcript=<callId>

# List Gong users
pnpm script gong-calls --users
```

## Key Patterns & Gotchas

- **IMPORTANT API endpoints**:
  - `GET /v2/calls` — lists calls (with `fromDateTime`, `toDateTime`, `cursor` params)
  - `POST /v2/calls` — **uploading/creating** calls (NOT listing). Using this for listing returns 400 errors about missing fields.
  - `POST /v2/calls/extensive` — detailed call data with party info
  - `POST /v2/calls/transcript` — get transcripts
- **Search pattern**: List calls via `GET /v2/calls?fromDateTime=...`, then filter client-side by company name matching against call title. No server-side company name search.
- **Transcripts**: Have `speakerId` (numeric), `topic` (string or null), `sentences` array with `start`/`end` (ms) and `text`. Speaker IDs need cross-referencing with call parties.
- Region/hostname is hard-coded — different Gong regions need code update
