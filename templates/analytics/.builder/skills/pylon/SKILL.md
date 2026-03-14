---
name: pylon
description: >
  Look up customer support tickets and account history via Pylon.
  Use this skill when the user asks about support tickets, customer issues, or support history.
---

# Pylon Integration (Support)

## Connection

- **Base URL**: `https://api.usepylon.com`
- **Auth**: `Authorization: Bearer $PYLON_API_KEY`
- **Env vars**: `PYLON_API_KEY`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib & API Routes

- **File**: `server/lib/pylon.ts`

### Exported Functions

| Function              | Description                          |
| --------------------- | ------------------------------------ |
| `getAccounts(query?)` | List/search accounts                 |
| `getAccount(id)`      | Get single account                   |
| `getIssues(params?)`  | List issues (30-day window enforced) |
| `getContacts(query?)` | Search contacts                      |

### API Routes

| Route                     | Description          |
| ------------------------- | -------------------- |
| `GET /api/pylon/issues`   | List support tickets |
| `GET /api/pylon/accounts` | List accounts        |

## Script Usage

```bash
# Open support tickets for a customer
pnpm script pylon-issues --account="Macy's" --state=open

# All issues
pnpm script pylon-issues --query=search_term

# List accounts
pnpm script pylon-issues --accounts
```

## Key Patterns & Gotchas

- `getIssues` enforces a max 30-day window via `start_time` and `end_time` query params (API requirement)
- API returns `{ data: ... }` wrappers or raw arrays — code handles both defensively
- Pylon API exists in this analytics app (`code/`) but the secrets `pylon.api_key` and `pylon.api_secret` referenced elsewhere are in secrets manager, not env vars
- No Pylon data in BigQuery — must query the API directly
