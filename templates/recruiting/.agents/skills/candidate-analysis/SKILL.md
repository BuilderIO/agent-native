---
name: candidate-analysis
description: >-
  AI analysis workflow for candidates. Use when analyzing resumes, comparing
  candidates, generating interview questions, or managing analysis notes.
---

# Candidate Analysis

## Analysis Workflow

When the user asks you to analyze a candidate:

1. **Get the candidate**: `pnpm script get-candidate --id <candidateId>`
2. **Get the job context**: `pnpm script get-job --id <jobId>` (from the candidate's application)
3. **Perform your analysis** — evaluate fit, identify strengths/weaknesses, note concerns
4. **Save the result**: `pnpm script manage-notes --action=create --candidateId=<id> --type=resume_analysis --content="..."`
5. **Refresh the UI**: `pnpm script refresh-data`

## Note Types

| Type               | When to use                                    |
| ------------------ | ---------------------------------------------- |
| `resume_analysis`  | Resume/profile evaluation against job criteria  |
| `comparison`       | Comparing multiple candidates for the same role |
| `interview_prep`   | Interview questions and talking points          |
| `general`          | Any other notes or observations                 |

## Managing Notes

```bash
# Create a note
pnpm script manage-notes --action=create --candidateId=123 --type=resume_analysis --content="Strong frontend skills..."

# List notes for a candidate
pnpm script manage-notes --action=list --candidateId=123

# Delete a note
pnpm script manage-notes --action=delete --id=note-abc123
```

## Comparison Workflow

When comparing candidates:

1. `get-candidate` for each candidate
2. `get-job` for the role requirements
3. Compare across key dimensions (skills, experience, culture fit)
4. Save comparison as a `comparison` note on each candidate
5. `refresh-data`

## Tips

- Always get both the candidate profile AND the job details before analyzing
- Be specific and actionable in your analysis — vague "good fit" notes aren't useful
- When comparing, use a consistent framework across all candidates
- Note any gaps or concerns, not just strengths

## Related Skills

- **candidate-management** — Getting the candidate data
- **pipeline-workflow** — Understanding where candidates are in the process
- **interview-scheduling** — Preparing for upcoming interviews
