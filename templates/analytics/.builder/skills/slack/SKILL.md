---
name: slack
description: >
  Search Slack messages and read channel history across Builder.io workspaces.
  Use this skill when the user asks about Slack conversations, channel messages, or internal communications.
---

# Slack Integration

## Connection

- **Base URL**: `https://slack.com/api/`
- **Auth**: `Authorization: Bearer $SLACK_BOT_TOKEN` (or `$SLACK_BOT_TOKEN_2` for secondary workspace)
- **Env vars**: `SLACK_BOT_TOKEN` (primary), `SLACK_BOT_TOKEN_2` (secondary workspace)
- **Caching**: 2-minute in-memory cache, max 200 entries; separate user/bot caches

## Server Lib

- **File**: `server/lib/slack.ts`

### Exported Functions

| Function | Description |
|---|---|
| `getTeamInfo(workspace)` | Get workspace info |
| `listChannels(workspace)` | List channels (paginated, first page cached) |
| `getChannelHistory(workspace, channelId, limit?, cursor?)` | Channel message history |
| `searchMessages(workspace, query, count?)` | Search messages |
| `getUserInfo(workspace, userId)` | Get user info (cached per user) |
| `getBotInfo(workspace, botId)` | Get bot info (cached) |
| `resolveUsers(workspace, userIds, messages?)` | Batch resolve user names |

## Key Patterns & Gotchas

- Two workspaces supported via workspace parameter ("primary" / "secondary")
- `getChannelHistory` auto-joins channels on "not_in_channel" error, then retries — requires `channels:join` scope
- If auto-join fails, throws a detailed message explaining how to invite the bot
- `searchMessages` may require user token; bot token tried first
- `listChannels` paginates via cursor; only first page is cached
- `getUserInfo` resolves bots via `getBotInfo` when needed
