---
name: candidate-management
description: >-
  Search, view, and create candidates in Greenhouse. Use when working with
  candidate data, searching for candidates, or creating new candidates.
---

# Candidate Management

## Searching Candidates

```bash
pnpm action list-candidates --search "John" --jobId 123
```

| Arg        | Description                      |
| ---------- | -------------------------------- |
| `--search` | Text search across name/email    |
| `--jobId`  | Filter by job                    |

## Viewing a Candidate

```bash
pnpm action get-candidate --id 456
```

Returns full profile: name, emails, phone, company, title, tags, applications (with stages), social links, recruiter, coordinator.

## Creating a Candidate

```bash
pnpm action create-candidate --firstName John --lastName Doe --email john@example.com --jobId 123
```

| Arg           | Required | Description                |
| ------------- | -------- | -------------------------- |
| `--firstName` | Yes      | First name                 |
| `--lastName`  | Yes      | Last name                  |
| `--email`     | No       | Email address              |
| `--jobId`     | No       | Job to apply candidate to  |

## Candidate Data Model

Candidates come from the Greenhouse Harvest API. Key fields:

| Field          | Type       | Description                         |
| -------------- | ---------- | ----------------------------------- |
| `id`           | number     | Unique Greenhouse candidate ID      |
| `first_name`   | string     | First name                          |
| `last_name`    | string     | Last name                           |
| `company`      | string     | Current company                     |
| `title`        | string     | Current title                       |
| `emails`       | array      | Email addresses (value + type)      |
| `applications` | array      | Applications with stage info        |
| `tags`         | string[]   | Tags                                |
| `recruiter`    | object     | Assigned recruiter                  |
| `last_activity`| string     | Last activity timestamp             |

## Related Skills

- **pipeline-workflow** — Moving candidates through stages
- **candidate-analysis** — AI analysis of candidate profiles
- **interview-scheduling** — Working with interviews
