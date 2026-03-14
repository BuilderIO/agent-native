# Word Count Guidance

Single source of truth for word count targets across all pipeline phases. Every skill that references word count links here instead of maintaining its own table.

## Primary Signal: Competitive SERP Data

Use the **median** word count of the top 5 ranking articles from `phases/03-serp-analysis.yaml` as the target. Add 10-20% for depth advantage.

**Example:** If the top 5 competitors average 3,700 words, target 4,100-4,400 words.

## SERP Quality Gate

If the top 5 word counts have high variance (standard deviation > 50% of the median), the SERP signal is unreliable. Fall back to the guidance table below and note: "SERP word counts vary widely ({min}-{max}). Using guidance range as primary signal."

## Fallback Guidance (No SERP Data or Trending)

When SERP data is unavailable (trending topics) or unreliable (high variance), use these ranges as **guidance, not limits**:

| Post Type | Guidance Range | Soft Max |
|-----------|---------------|----------|
| Tutorial / Guide | 2,000-4,000 | 6,000 |
| Comparison | 2,500-5,000 | 6,000 |
| Explainer | 1,500-3,000 | 5,000 |
| How-to | 1,200-2,500 | 4,000 |
| Quick Reference | 600-1,200 | 2,000 |
| Thought Leadership | 1,200-2,500 | 4,000 |

## Core Principle

Write until the topic is covered, then stop. The SERP competitive range informs how much depth is needed, not a fixed table. A tight 1,800-word post that covers the topic beats a padded 3,000-word one.

## Overage Warning

Warn if the draft exceeds the competitive median by 50%. If no SERP data exists, warn if exceeding the guidance soft max.

**Example:** Competitive median is 3,000 words. Draft is at 4,600 words (53% over). Warn: "Draft is 53% above the competitive median. This may indicate scope creep or sections that should be separate posts."

## User Override

An optional `max_word_count` field in `phases/01-topic-validation.yaml` allows the user (or the strategist agent) to set a topic-specific limit that overrides SERP data.

## SurferSEO Keyword Density Interaction

When `seed/keywords.txt` exists AND competitive word count data is available, bias toward the **upper end** of the competitive range. Keyword density targets are absolute counts -- a longer post distributes keywords more naturally without stuffing.

## Phase 8-9 Buffer

SEO and AEO optimization (Phases 8-9) may add words (internal links, answer-first block refinements, quote-ready blocks). Leave room: **3-5% of target word count** (not a fixed 200 words). A 6,000-word post needs more buffer than a 2,000-word post.

If AEO pushes slightly past the target, that is acceptable. Well-structured quote-ready blocks are worth more than hitting the number exactly.

Last updated: 2026-02-10 (v0.32.0)
