---
name: content-lfg
description: "Runs the full blog creation pipeline autonomously with zero approval gates. Use when the user wants maximum speed, says 'just do it', 'lfg', 'no gates', or wants a fully autonomous content run."
---

# LFG -- Autonomous Blog Creation

Run the full `/content-blog` pipeline from topic to publish-ready post with zero approval gates. All decisions are made autonomously using the rules below.

## Arguments

<args> $ARGUMENTS </args>

### Argument Disambiguation

```
IF args resolve to an existing directory on disk:
    IF directory contains hub-context.yaml:
        → Hub mode. Read hub context. Use existing folder.
    ELSE:
        → Pre-existing output folder
ELSE IF args are empty:
    → Ask the user for a topic
ELSE:
    → Standalone mode. Treat args as a topic string.
```

**Directory check:** Use filesystem existence check. Do NOT use a `/` heuristic.

**If args are empty, ask the user:** "What topic? Give me a subject and angle."

Do not proceed until you have a topic or a valid folder path from the user.

### Hub Mode

When a hub page folder is detected (contains `hub-context.yaml`):

1. Use the existing folder as the output folder
2. Read `hub-context.yaml` → extract `hub_slug`, `page_type`, `page_slug`, `topic`, `primary_keyword`, `content_goal`
3. Read `hub.yaml` from `output/hubs/<hub_slug>/hub.yaml` → extract sibling keywords and link graph
4. Write Phase 1 stub to `phases/01-topic-validation.yaml` with `hub_pre_populated: true`
5. Update hub.yaml -- set page status to `in-progress`
6. Content-strategist skips go/no-go and pivot (topic pinned from hub planning)

## Seed Detection

After folder setup, silently check for a `seed/` subfolder. If found, seed content is ingested during Phases 1, 2, and 4 per the Seed Research skill. No user prompt -- autonomous mode. If seed folder is empty, proceed with automated-only research.

## Execution

Run the full `/content-blog` pipeline with `--no-gates` behavior. Every phase runs identically to `/content-blog` -- the only difference is how gates are handled.

## Autonomous Decision Rules

### Gate 1: Topic Approval (after Phase 1)

**Standalone mode:**

| Recommendation | Action |
|---------------|--------|
| **Go** | Proceed automatically |
| **Pivot** | Auto-accept the pivot suggestion. Re-run Phase 1 with the pivoted topic. |
| **Reject** | Stop. Output the rejection reason. Do not force a bad topic. |

Content goal and timing classifications are accepted as-is. No override prompt.

**Hub mode:** Auto-proceed. The topic is pre-validated from hub planning -- no go/no-go, no pivot. Content goal and classifications are accepted from hub-context.yaml.

### Gate 2: Outline Approval (after Phase 5)

Auto-approve. Proceed to Phase 5.5 (spec analysis).

### Phase 5.5: Content Spec Analysis

| Confidence | Action |
|------------|--------|
| **Green** | Auto-proceed to Phase 6 |
| **Yellow** | Auto-proceed. Pass `verification_checklist` and `outline_adjustments` to Phase 6 as advisory context. Log yellow issues for compound docs. |
| **Red** | Auto-attempt ONE fix-loop: pass critical issues + `outline_adjustments` to Phase 5, re-run Gate 2 (auto-approve), re-run Phase 5.5. If still red after 1 attempt, stop pipeline. Set `pipeline_status: blocked-at-spec-analysis` in `metadata.yaml` for resume support. Report critical issues. |

### Gate 3: Draft Approval (after Phase 6)

Auto-proceed to editing.

## Word Count Overflow

If the post exceeds the competitive median by 50%+ (or the guidance soft max if no SERP data) after Phase 9 (AEO optimization):

1. Identify the longest non-essential sections (not the introduction, not code examples, not the conclusion)
2. Trim by removing redundant examples, shortening explanations, or condensing transitions
3. Target the competitive range from the outline
4. Note the trim in `phases/10-post-publish-checklist.yaml`

## Error Handling

### Phase Failure
If any phase fails:
1. Retry once
2. If retry fails, skip the phase with a stub (`skipped: true`)
3. Continue the pipeline
4. Note skipped phases in the final summary

### Ahrefs MCP Unavailable
Proceed with WebSearch fallbacks. Do not stop.

## Pipeline Complete

When done, output the same completion summary as `/content-blog`:

```
LFG complete!

Topic: [topic]
Title: [selected title]
Content Goal: [awareness/acquisition/hybrid]
Word Count: [final count]
Status: [publish-ready / needs-fixes]

Output: output/posts/YYYY-MM-DD-topic-slug/

Critical issues: [count]
Important issues: [count]
Minor issues: [count]

Gates skipped: 3 (autonomous mode)
Phases skipped: [count, if any]
```

Suggest running `/content-compound` afterward to capture learnings.

## Important Notes

- **Hub mode:** When pointed at a hub page folder, pre-populates Phase 1 from `hub-context.yaml` and auto-proceeds Gate 1 without go/no-go or pivot evaluation. All hub-aware downstream skills activate via `hub_slug` in `phases/01-topic-validation.yaml`. Standalone mode is completely unaffected.
- **Revise is excluded.** `/content-revise` is interactive by design (like polish). Run it separately after the autonomous pipeline completes.
