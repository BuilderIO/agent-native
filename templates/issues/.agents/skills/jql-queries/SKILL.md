---
name: jql-queries
description: >-
  How to construct JQL (Jira Query Language) queries. Use when searching
  for issues with complex filters, or when the user asks for issues by
  type, status, assignee, sprint, label, or date ranges.
---

# JQL Queries

JQL (Jira Query Language) is how you search for issues in Jira. Use it with the `search-issues` script:

```bash
pnpm action search-issues --jql "issuetype = Bug AND status != Done"
```

## Common Patterns

### By Type
```
issuetype = Bug
issuetype = Story
issuetype in (Bug, Task)
issuetype != Epic
```

### By Status
```
status = "In Progress"
status != Done
status in ("To Do", "In Progress")
status was "In Progress"
statusCategory = "In Progress"
statusCategory != Done
```

### By Assignee
```
assignee = currentUser()
assignee = "john.doe"
assignee is EMPTY
assignee is not EMPTY
```

### By Project
```
project = PROJ
project in (PROJ, ENG, DESIGN)
```

### By Sprint
```
sprint in openSprints()
sprint in futureSprints()
sprint in closedSprints()
sprint = "Sprint 42"
```

### By Label
```
labels = "frontend"
labels in ("frontend", "backend")
labels is EMPTY
```

### By Date
```
created >= -7d
updated >= -1d
created >= "2024-01-01" AND created <= "2024-03-31"
resolutiondate >= startOfMonth()
duedate <= endOfWeek()
```

### By Priority
```
priority = High
priority in (High, Highest)
priority >= Medium
```

### By Text
```
summary ~ "login bug"
text ~ "authentication"
description ~ "API endpoint"
```

## Combining Filters

Use `AND`, `OR`, and parentheses:

```
project = PROJ AND issuetype = Bug AND status != Done
(assignee = currentUser() OR reporter = currentUser()) AND status = "In Progress"
project = PROJ AND sprint in openSprints() AND statusCategory != Done
```

## Ordering

```
ORDER BY created DESC
ORDER BY priority DESC, created ASC
ORDER BY updated DESC
```

## Useful Composite Queries

**My open bugs:**
```
assignee = currentUser() AND issuetype = Bug AND resolution = Unresolved
```

**Unresolved issues in current sprint:**
```
sprint in openSprints() AND resolution = Unresolved ORDER BY priority DESC
```

**Issues created this week:**
```
project = PROJ AND created >= startOfWeek() ORDER BY created DESC
```

**High-priority unassigned:**
```
priority in (High, Highest) AND assignee is EMPTY AND resolution = Unresolved
```

**Recently updated bugs:**
```
issuetype = Bug AND updated >= -3d ORDER BY updated DESC
```

## Tips

- String values with spaces must be quoted: `status = "In Progress"`
- Use `currentUser()` for the logged-in user
- Date functions: `startOfDay()`, `endOfDay()`, `startOfWeek()`, `startOfMonth()`, `-7d` (relative)
- `~` is the "contains" operator for text fields
- `resolution = Unresolved` means the issue is still open

## Related Skills

- **issue-management** — Using search results to act on issues
- **sprint-workflow** — Sprint-scoped queries
