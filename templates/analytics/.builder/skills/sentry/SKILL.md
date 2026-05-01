---
name: sentry
description: >
  Track errors and issues across your projects via Sentry.
  Use this skill when the user asks about errors, exceptions, error trends, or application health.
---

# Sentry Integration

## Connection

- **Base URL**: `https://sentry.io/api/0`
- **Org slug**: defaults to `bridge-tm` for existing dashboards; pass `orgSlug` to the `sentry` action when a user needs a different Sentry organization
- **Auth**: `Authorization: Bearer $SENTRY_SERVER_TOKEN` (internal integration token, NOT user auth token or DSN)
- **Env vars**: `SENTRY_SERVER_TOKEN` (falls back to `SENTRY_AUTH_TOKEN`)
- **Caching**: 5-minute in-memory cache, max 100 entries
- **Scopes needed**: `alerts:read`, `event:read`, `org:read`, `project:distribution`, `project:read`, `team:read`

## Server Lib & API Routes

- **File**: `server/lib/sentry.ts`

### Exported Functions

| Function                                         | Description                              |
| ------------------------------------------------ | ---------------------------------------- |
| `listProjects()`                                 | List all projects in the org             |
| `listIssues(projectSlug?, query?, statsPeriod?)` | List issues (project-scoped or org-wide) |
| `getIssueEvents(issueId)`                        | Events for a specific issue              |
| `getOrganizationStats(statsPeriod?, category?)`  | Org-level error stats over time          |

### Agent Action

Use `sentry` for all agent-facing Sentry work. Do not call `/api/sentry/*`
directly from the agent.

| Mode | Args | Description |
| --- | --- | --- |
| `issues` | `statsPeriod`, `project`, `query`, `orgSlug` | Frequent issues, sorted by frequency |
| `projects` | `orgSlug` | List projects |
| `issue-events` | `issueId`, `orgSlug` | Events for a specific issue |
| `stats` | `statsPeriod`, `category`, `orgSlug` | Org-level stats |

### API Routes

| Route                          | Description         |
| ------------------------------ | ------------------- |
| `GET /api/sentry/projects`     | List projects       |
| `GET /api/sentry/issues`       | List issues         |
| `GET /api/sentry/issue-events` | Events for an issue |
| `GET /api/sentry/stats`        | Org error stats     |

### Dashboard

- `/adhoc/sentry` — Sentry Error Health dashboard

## Key Patterns & Gotchas

- Token type: This is a **custom/internal integration** token from Sentry's integration settings TOKEN table (not the Client Secret)
- `getOrganizationStats` uses `stats_v2` endpoint with `field=sum(quantity)`, `groupBy=outcome`, default category `error`
- If the default org is wrong, pass `orgSlug` explicitly in the action call.
