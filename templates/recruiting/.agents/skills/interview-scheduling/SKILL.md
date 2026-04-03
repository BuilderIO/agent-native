---
name: interview-scheduling
description: >-
  Working with scheduled interviews in Greenhouse. Use when listing interviews,
  checking upcoming schedules, or understanding interview data.
---

# Interview Scheduling

## Listing Interviews

```bash
pnpm action list-interviews [--compact]
```

Returns upcoming scheduled interviews with:
- Application ID and candidate info
- Start/end times
- Location
- Status (scheduled, awaiting_feedback, complete)
- Interviewer list with names and emails
- Scorecard submission status

## Interview Data Model

| Field            | Type     | Description                          |
| ---------------- | -------- | ------------------------------------ |
| `id`             | number   | Interview ID                         |
| `application_id` | number   | Associated application               |
| `start`          | object   | `{ date_time: "ISO string" }`        |
| `end`            | object   | `{ date_time: "ISO string" }`        |
| `location`       | string   | Interview location                   |
| `status`         | string   | scheduled, awaiting_feedback, etc.   |
| `organizer`      | object   | `{ id, name, email }`                |
| `interviewers`   | array    | `{ id, name, email, scorecard_id }`  |

## Interview Prep

When a user asks you to help prepare for an interview:

1. `list-interviews` to find the upcoming interview
2. Use the `application_id` to find the candidate
3. `get-candidate --id <candidateId>` for the full profile
4. `get-job --id <jobId>` for role requirements
5. Generate prep notes (questions, talking points)
6. Save with `manage-notes --action=create --candidateId=<id> --type=interview_prep --content="..."`
7. `refresh-data` to update the UI

## Related Skills

- **candidate-management** — Getting candidate details for interview prep
- **pipeline-workflow** — Understanding where candidates are in the process
