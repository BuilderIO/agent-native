---
name: jira
description: >
  Search and analyze Jira tickets, sprints, and project analytics.
  Use this skill when the user asks about tickets, bugs, sprint tracking, or engineering work.
---

# Jira Integration

## Connection

- **Base URL**: `$JIRA_BASE_URL` (e.g. `https://yourorg.atlassian.net`)
- **Auth**: Basic auth — `Base64($JIRA_USER_EMAIL:$JIRA_API_TOKEN)`
- **Env vars**: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`
- **Caching**: 10-minute in-memory cache, max 100 entries
- **API versions**: REST API v3 (`/rest/api/3`), Agile API (`/rest/agile/1.0`)

## Server Lib & API Routes

- **File**: `server/lib/jira.ts`

### Exported Functions

| Function                                  | Description                           |
| ----------------------------------------- | ------------------------------------- |
| `searchIssues(jql, fields?, maxResults?)` | Search via JQL                        |
| `getIssue(issueKey)`                      | Get single issue detail               |
| `getProjects()`                           | List all projects                     |
| `getStatuses(projectKey?)`                | List statuses (optionally by project) |
| `getBoards()`                             | List agile boards                     |
| `getSprints(boardId)`                     | List sprints for a board              |
| `getAnalytics(projects, days)`            | Aggregate ticket analytics            |

### API Routes

| Route                     | Description            |
| ------------------------- | ---------------------- |
| `GET /api/jira/search`    | Search tickets via JQL |
| `GET /api/jira/issue`     | Get issue detail       |
| `GET /api/jira/projects`  | List projects          |
| `GET /api/jira/statuses`  | List statuses          |
| `GET /api/jira/boards`    | List boards            |
| `GET /api/jira/sprints`   | List sprints           |
| `GET /api/jira/analytics` | Ticket analytics       |

### Dashboard

- `/adhoc/jira` — Jira Tickets dashboard with Overview, Search, and Sprints tabs

## Script Usage

```bash
# Search tickets
pnpm script jira-search --jql="summary ~ SSO ORDER BY created DESC" --fields=key,summary,status,assignee

# Ticket analytics
pnpm script jira-analytics --days=30
pnpm script jira-analytics --projects=ENG,PROD --days=30
```

## Key Patterns & Gotchas

- **IMPORTANT**: The old `/rest/api/3/search` endpoint was removed by Atlassian (returns 410). Must use `/rest/api/3/search/jql` instead.
- JQL for duplicate detection: `project = X AND summary ~ "keyword" ORDER BY created DESC`
- Always use markdown links for tickets: `[ENG-1234](https://yourorg.atlassian.net/browse/ENG-1234)`
- `getStatuses` with a projectKey returns an array of issue type entries; the code flattens nested statuses
- `getAnalytics` runs multiple search queries and aggregates client-side
