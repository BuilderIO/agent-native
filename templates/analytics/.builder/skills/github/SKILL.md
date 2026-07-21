---
name: github
description: >
  Search and read GitHub PRs, issues, and code across a configured GitHub org or repo.
  Use this skill when the user asks about pull requests, code reviews, or GitHub issues.
---

# GitHub Integration

GitHub access uses the shared provider API runtime and the Analytics GitHub
OAuth connection. Do not add a separate GitHub client or `/api/github/*`
pass-through routes.

## Access Paths

- Use `github-repo-files` for repository file discovery, bounded text search,
  and file reads. It is the stable, agent-friendly wrapper around the shared
  core implementation.
- Use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` with provider `github` for pull requests, issues,
  searches, and GraphQL operations not modeled by `github-repo-files`.
- For broad or paginated analysis, stage the provider response and reduce it
  with `query-staged-dataset` or `run-code` instead of returning a large corpus
  to chat.

Authentication remains owned by `server/lib/github-oauth.ts`; provider calls
must resolve the current viewer's OAuth grant or scoped credential through the
shared runtime.

## Key Patterns & Gotchas

### GitHub search qualifiers

- `org:<org>` — all repos in org
- `repo:<org>/<repo>` — specific repo
- `is:pr is:open` / `is:pr is:merged` / `is:pr is:closed`
- `is:issue is:open` / `is:issue is:closed`
- `author:username` — PRs/issues by author
- `assignee:username` — assigned to user
- `label:bug` — by label
- `in:title keyword` — keyword in title
- `created:>2025-01-01` — date range
- `review:approved` — approved PRs
- `review:changes_requested`

Use provider documentation to confirm endpoint, version, pagination, and search
behavior before making absence claims. Report the repository or organization,
filters, page coverage, and any truncation with the answer.
