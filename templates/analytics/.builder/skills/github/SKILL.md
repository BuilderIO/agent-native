---
name: github
description: >
  Search and read GitHub PRs, issues, and code across the BuilderIO org.
  Use this skill when the user asks about pull requests, code reviews, or GitHub issues.
---

# GitHub Integration

## Connection

- **Base URL**: `https://api.github.com` (REST v3), `https://api.github.com/graphql` (GraphQL v4)
- **Auth**: `Authorization: Bearer $GITHUB_TOKEN` (personal access token)
- **Env vars**: `GITHUB_TOKEN`
- **Caching**: 5-minute in-memory cache, max 200 entries

## Server Lib & API Routes

- **Server lib**: `server/lib/github.ts`
- **Route handler**: `server/routes/github.ts`

### Exported Functions

| Function                        | Description                                                     |
| ------------------------------- | --------------------------------------------------------------- |
| `searchPRs(opts)`               | Search PRs using GitHub search syntax                           |
| `searchIssues(opts)`            | Search issues using GitHub search syntax                        |
| `getPR(owner, repo, number)`    | Full PR detail — commits, reviews, files (4 parallel API calls) |
| `getIssue(owner, repo, number)` | Issue detail with labels, assignees                             |
| `listPRs(owner, repo, opts)`    | List repo PRs by state (open/closed/all)                        |
| `searchOrgPRs(opts)`            | Convenience wrapper — prepends `org:BuilderIO is:pr`            |
| `runGraphQL(query, variables?)` | Raw GraphQL query                                               |

### API Routes

| Route                                                                    | Description                            |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `GET /api/github/search?q=...&type=pr\|issue&limit=30`                   | Full GitHub search syntax              |
| `GET /api/github/pr?owner=...&repo=...&number=...`                       | PR detail with commits, reviews, files |
| `GET /api/github/issue?owner=...&repo=...&number=...`                    | Issue detail                           |
| `GET /api/github/prs?owner=...&repo=...&state=open\|closed\|all`         | List repo PRs                          |
| `GET /api/github/org-prs?org=BuilderIO&q=...&state=OPEN\|CLOSED\|MERGED` | Org-wide PR search                     |
| `POST /api/github/graphql` body: `{ query, variables? }`                 | Raw GraphQL                            |

## Script Usage

```bash
# Search open PRs in BuilderIO org
pnpm script github-prs
pnpm script github-prs --org=BuilderIO --query="is:open label:bug"

# List PRs for a specific repo
pnpm script github-prs --repo=BuilderIO/qwik --state=open

# Get full PR detail (commits, reviews, files)
pnpm script github-prs --pr=BuilderIO/qwik/1234

# Get issue detail
pnpm script github-prs --issue=BuilderIO/qwik/567

# Full GitHub search syntax (works across all orgs/repos)
pnpm script github-prs --search="fix authentication is:pr is:merged"
pnpm script github-prs --search="memory leak" --type=issue

# Raw GraphQL
pnpm script github-prs --graphql='{ viewer { login } }'

# Filtering with built-in helpers
pnpm script github-prs --org=BuilderIO --grep="auth" --fields=number,title,state,url
```

## Key Patterns & Gotchas

### GitHub search qualifiers (useful for --search and --query)

- `org:BuilderIO` — all repos in org
- `repo:BuilderIO/qwik` — specific repo
- `is:pr is:open` / `is:pr is:merged` / `is:pr is:closed`
- `is:issue is:open` / `is:issue is:closed`
- `author:username` — PRs/issues by author
- `assignee:username` — assigned to user
- `label:bug` — by label
- `in:title keyword` — keyword in title
- `created:>2025-01-01` — date range
- `review:approved` — approved PRs
- `review:changes_requested`

### Implementation Notes

- `searchOrgPRs()` is a convenience wrapper that prepends `org:BuilderIO is:pr` — use `searchPRs()` / `searchIssues()` directly for full control
- The REST search API returns up to 100 results per call; paginated list endpoints use `restGetPaginated()` with Link header traversal
- `getPR()` makes 4 parallel API calls: PR data, commits, reviews, files — provides a complete picture in one shot
- 5-minute in-memory cache on all requests
