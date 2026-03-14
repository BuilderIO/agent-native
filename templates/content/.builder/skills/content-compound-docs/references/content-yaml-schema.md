# Content YAML Frontmatter Schema

Schema for categorizing content pipeline learnings in `docs/solutions/`. All enum fields are validated as a blocking gate before documentation is created.

## Required Fields

- **post_slug** (string): The blog post slug (e.g., "react-server-components-guide") or "general" for cross-post or pipeline-level learnings
- **date** (string): ISO 8601 date (YYYY-MM-DD) when the learning was captured
- **problem_type** (enum): One of the values below
- **component** (enum): One of the values below
- **symptoms** (array): 1-5 specific observable symptoms during content generation
- **root_cause** (enum): One of the values below
- **resolution_type** (enum): One of the values below
- **severity** (enum): One of [critical, high, medium, low]

## Optional Fields

- **content_goal** (enum): One of [awareness, acquisition, hybrid]
- **content_timing** (enum): One of [evergreen, trending]
- **tags** (array): Searchable keywords (lowercase, hyphen-separated)

## Enum Values

### problem_type

| Value                 | Use When                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `topic_miss`          | Topic evaluation was off -- wrong content goal, missed audience fit, or poor timing assessment                |
| `keyword_miss`        | Targeted wrong keyword during research -- volume, difficulty, or intent mismatch discovered during generation |
| `serp_misjudgment`    | Misjudged search intent or competitive landscape during SERP analysis phase                                   |
| `research_gap`        | Missing key information discovered during drafting or editing that weakened the post                          |
| `outline_issue`       | Outline structure didn't work -- required multiple revisions, wrong post type, poor section flow              |
| `drafting_issue`      | Voice problems, hook type mismatch, weak examples, or content goal misalignment during drafting               |
| `editing_miss`        | AI voice leaked through editing, clarity issues not caught, or editing pass missed a pattern                  |
| `seo_issue`           | Schema errors, meta description problems, or linking failures discovered during SEO optimization              |
| `aeo_issue`           | Heading compliance failures, weak answer-first blocks, or quote-ready block issues during AEO pass            |
| `style_violation`     | Recurring voice/tone issues not caught by style guide rules                                                   |
| `cta_failure`         | CTA placement or tone was wrong for the content goal during drafting or editing                               |
| `pipeline_win`        | Pipeline approach produced notably strong results during generation (capture what worked)                     |
| `process_improvement` | Workflow or process insight discovered during content generation                                              |

### component

| Value                    | Maps To Phase                                |
| ------------------------ | -------------------------------------------- |
| `topic_discovery`        | Phase 1                                      |
| `keyword_research`       | Phase 2                                      |
| `serp_analysis`          | Phase 3                                      |
| `content_research`       | Phase 4                                      |
| `outline_creation`       | Phase 5                                      |
| `blog_drafting`          | Phase 6                                      |
| `content_editing`        | Phase 7                                      |
| `seo_optimization`       | Phase 8                                      |
| `aeo_optimization`       | Phase 9                                      |
| `style_guide`            | Phase 6-7 (used during drafting and editing) |
| `post_publish_checklist` | Phase 10                                     |
| `pipeline`               | Cross-phase or pipeline-level issue          |

### root_cause

| Value                       | Use When                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `wrong_keyword_target`      | Keyword selection was off (volume, difficulty, intent) -- discovered during generation |
| `audience_mismatch`         | Content didn't match target audience -- noticed during drafting or editing             |
| `competitive_underestimate` | Underestimated competitor content quality or DR during SERP analysis                   |
| `missing_source`            | Key source not consulted during research phase                                         |
| `structure_mismatch`        | Wrong post type or framework for the topic -- required outline revision                |
| `voice_drift`               | Draft drifted from target voice (too formal, casual, or AI-like)                       |
| `weak_hook`                 | Opening hook type was wrong for the post type or topic                                 |
| `insufficient_examples`     | Not enough concrete code or real-world examples during drafting                        |
| `over_optimization`         | SEO or AEO changes hurt readability during optimization passes                         |
| `under_optimization`        | Missed SEO/AEO opportunities that should have been caught                              |
| `timing_error`              | Content timing classification (evergreen/trending) was wrong for the topic             |
| `goal_misalignment`         | Content goal (awareness/acquisition/hybrid) was wrong for the topic                    |
| `effective_pattern`         | Root cause for pipeline_win -- a pipeline approach worked well                         |
| `process_gap`               | Missing step or check in the pipeline                                                  |
| `ahrefs_budget`             | Ahrefs unit usage was too high or inefficient for this topic                           |

### resolution_type

| Value                | Use When                                                    |
| -------------------- | ----------------------------------------------------------- |
| `skill_update`       | Updated a SKILL.md with new guidance                        |
| `style_guide_update` | Added or modified a style guide rule                        |
| `reference_update`   | Updated a reference file                                    |
| `process_change`     | Changed the pipeline workflow                               |
| `keyword_pivot`      | Changed target keyword during the pipeline                  |
| `content_rewrite`    | Significant section or post rewrite during editing          |
| `no_action`          | Learning recorded for future reference, no immediate change |

## Validation Rules

1. All required fields must be present
2. Enum fields must match allowed values exactly (case-sensitive)
3. `symptoms` must be a YAML array with 1-5 items
4. `date` must match YYYY-MM-DD format
5. `tags` should be lowercase, hyphen-separated

## Category Mapping

Based on `problem_type`, documentation is filed in:

| problem_type          | Directory                              |
| --------------------- | -------------------------------------- |
| `topic_miss`          | `docs/solutions/topic-misses/`         |
| `keyword_miss`        | `docs/solutions/keyword-misses/`       |
| `serp_misjudgment`    | `docs/solutions/serp-misjudgments/`    |
| `research_gap`        | `docs/solutions/research-gaps/`        |
| `outline_issue`       | `docs/solutions/outline-issues/`       |
| `drafting_issue`      | `docs/solutions/drafting-issues/`      |
| `editing_miss`        | `docs/solutions/editing-misses/`       |
| `seo_issue`           | `docs/solutions/seo-issues/`           |
| `aeo_issue`           | `docs/solutions/aeo-issues/`           |
| `style_violation`     | `docs/solutions/style-violations/`     |
| `cta_failure`         | `docs/solutions/cta-failures/`         |
| `pipeline_win`        | `docs/solutions/pipeline-wins/`        |
| `process_improvement` | `docs/solutions/process-improvements/` |

## Example: Pipeline Process Learning

```yaml
---
post_slug: react-server-components-guide
date: 2026-02-15
problem_type: outline_issue
component: outline_creation
symptoms:
  - "Outline required 3 revision cycles at Gate 2"
  - "Bold Claim hook was wrong fit for tutorial post type"
  - "Section flow improved after switching to Problem hook"
root_cause: weak_hook
content_goal: awareness
content_timing: evergreen
resolution_type: skill_update
severity: medium
tags: [hook-selection, tutorial, outline-revision]
---
```

## Example: Pipeline Win

```yaml
---
post_slug: react-server-components-guide
date: 2026-02-15
problem_type: pipeline_win
component: blog_drafting
symptoms:
  - "AI-voice Pass 3 found 0 violations in first draft"
  - "Draft passed Gate 3 on first attempt"
  - "Word count hit 2,180 -- within target range with buffer for AEO"
root_cause: effective_pattern
content_goal: awareness
content_timing: evergreen
resolution_type: no_action
severity: low
tags: [clean-draft, ai-voice, word-count-discipline]
---
```

## Example: Process Improvement

```yaml
---
post_slug: general
date: 2026-02-20
problem_type: process_improvement
component: keyword_research
symptoms:
  - "Keyword research used 800 Ahrefs units for a narrow topic"
  - "Most units spent on broad explorers that returned irrelevant results"
root_cause: ahrefs_budget
resolution_type: skill_update
severity: medium
tags: [ahrefs-budget, keyword-research, unit-efficiency]
---
```
