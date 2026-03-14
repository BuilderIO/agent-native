---
name: commonroom
description: >
  Look up community member engagement and signals via Common Room.
  Use this skill when the user asks about community activity, member engagement, or community signals.
---

# Common Room Integration (Community)

## Connection

- **Base URL**: `https://api.commonroom.io/community/v1`
- **Auth**: `Authorization: Bearer $COMMONROOM_API_TOKEN`
- **Env vars**: `COMMONROOM_API_TOKEN`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib & API Routes

- **File**: `server/lib/commonroom.ts`

### Exported Functions

| Function | Description |
|---|---|
| `getTokenStatus()` | Check API token validity |
| `getMemberByEmail(email)` | Look up a member by email (returns null on failure) |
| `getMembers(params?)` | Search members (POST with query, cursor, limit) |
| `getActivityForMember(memberId)` | Get activity feed for a member |
| `getSegments()` | List community segments |

### API Routes

| Route | Description |
|---|---|
| `GET /api/commonroom/members` | Search community members |

## Script Usage

```bash
# Search by email
pnpm script commonroom-members --email=user@example.com

# Search by query
pnpm script commonroom-members --query=search_term

# List segments
pnpm script commonroom-members --segments
```

## Key Patterns & Gotchas

- `getMemberByEmail` uses POST `/members/search` and returns single `CommunityMember` or null on error
- API returns `{ items: ... }` wrappers or raw arrays — code handles both
- Use for finding community engagement signals to enrich customer profiles
