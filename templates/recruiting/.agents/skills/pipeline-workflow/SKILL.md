---
name: pipeline-workflow
description: >-
  Pipeline stages and candidate progression in Greenhouse. Use when advancing,
  moving, or rejecting candidates. Critical: applicationId (not candidateId)
  is used for all pipeline moves.
---

# Pipeline Workflow

## Critical Concept: applicationId vs candidateId

**All pipeline moves use `applicationId`, NOT `candidateId`.** A candidate can have multiple applications (one per job). Each application tracks its own stage progression.

To find the applicationId:
1. `get-candidate --id <candidateId>` — returns `applications` array
2. Each application has: `id` (applicationId), `current_stage`, `jobs`, `status`

## Viewing the Pipeline

```bash
pnpm script get-pipeline --jobId 123 [--compact]
```

Returns candidates grouped by stage for a specific job. Each stage shows its applications with candidate names.

## Advancing a Candidate

```bash
pnpm script advance-candidate --applicationId 789 --fromStageId 100
```

Advances the application to the **next** stage in the pipeline. Requires the current `fromStageId` to prevent race conditions.

## Moving to a Specific Stage

```bash
pnpm script move-candidate --applicationId 789 --fromStageId 100 --toStageId 200
```

Moves the application to a specific stage (can skip stages or move backward).

## Rejecting a Candidate

```bash
pnpm script reject-candidate --applicationId 789 [--notes "Not a fit for this role"]
```

## Finding Stage IDs

1. `get-pipeline --jobId <id>` — shows all stages with IDs
2. `get-candidate --id <candidateId>` — shows `current_stage` for each application

## Common Workflow

```
1. User asks "advance Sarah to the next stage"
2. view-screen → get current context
3. get-candidate → find applicationId and current fromStageId
4. advance-candidate --applicationId=X --fromStageId=Y
5. refresh-data
```

## After Mutations

Always run `pnpm script refresh-data` after advancing, moving, or rejecting candidates.

## Related Skills

- **candidate-management** — Finding candidates and their applicationIds
- **interview-scheduling** — Scheduling interviews at specific stages
