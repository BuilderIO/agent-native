# Hub Page Outlines

Templates and rules for structuring pillar and cluster pages within a content hub. Load this reference when `page_type` is `pillar` or `cluster` in `phases/01-topic-validation.yaml`.

## Page Type Comparison

| Aspect          | Standalone Blog Post    | Pillar Page                               | Cluster Page                                  |
| --------------- | ----------------------- | ----------------------------------------- | --------------------------------------------- |
| Word count      | 1,500-2,500             | 3,000-4,000                               | 1,500-2,500                                   |
| Depth           | Deep on one subtopic    | Broad overview of many subtopics          | Deep on one subtopic                          |
| Sections        | 5-8 H2s on the topic    | 8-12+ H2s, one per cluster topic          | 5-8 H2s (focused)                             |
| Internal links  | 2-3 to existing posts   | One to every cluster page (8-12+)         | 1 to pillar (intro) + 1-2 to sibling clusters |
| Format          | Long-form narrative     | ToC + section summaries + deep-dive links | Long-form narrative                           |
| Schema          | BlogPosting             | Article + `hasPart` for cluster links     | BlogPosting                                   |
| AEO blocks      | 3-5 answer-first blocks | One answer-first block per section        | 3-5 answer-first blocks                       |
| Pillar backlink | N/A                     | N/A                                       | Mandatory in first 2-3 paragraphs             |

## Pillar Page Templates

### Template 1: "What Is X?" Explainer Hub

Best for conceptual topics where the reader needs a comprehensive introduction.

```markdown
# What Is [Topic]? The Complete Guide

**Page type:** pillar
**Post type:** explainer
**Copywriting framework:** PAS (recommended) or Before-After-Bridge
**Hook types that work well:** Bold Claim, Problem, Statistic
**Target word count:** 3,000-4,000

## Introduction (~250 words)

- Hook: why this topic matters NOW
- Context: scope of the guide, what the reader will learn
- Table of contents overview (pillar pages MUST include a ToC)

## What Is [Topic]? (~300 words)

- Core definition + answer-first block
- Featured snippet target: definition
- Brief, accessible — the cluster page goes deep

## How [Topic] Works (~300 words)

- High-level mechanics — overview only
- Mermaid diagram: yes (architecture or process flow)
- Link to cluster: "For a deep dive, see [cluster page title]"

## [Topic] vs [Alternative] (~250 words)

- Brief comparison — surface-level differences
- Link to cluster: "See our full comparison: [cluster page title]"

## Getting Started with [Topic] (~250 words)

- Quickstart overview — not a full tutorial
- Link to cluster: "Follow our step-by-step guide: [cluster page title]"

## Advanced [Topic] Techniques (~250 words)

- Overview of advanced patterns
- Link to cluster: "Master advanced techniques: [cluster page title]"

## [Topic] Best Practices (~250 words)

- Summary of top practices
- Link to cluster: "See all best practices: [cluster page title]"

## [Additional Cluster Topic Sections as needed] (~250 words each)

- One section per remaining cluster page topic
- Overview depth — the cluster carries the detail

## FAQ (~300 words)

- Questions NOT assigned to any cluster page
- 4-6 questions with direct 40-60 word answers

## Conclusion (~200 words)

- Key takeaway in 2-3 sentences
- CTA appropriate to content goal
```

### Template 2: "Complete Guide" Tutorial Hub

Best for practical topics where the reader wants a learning path.

```markdown
# The Complete Guide to [Topic]

**Page type:** pillar
**Post type:** tutorial
**Copywriting framework:** Before-After-Bridge (recommended) or AIDA
**Hook types that work well:** Problem, Story Start, Statistic
**Target word count:** 3,000-4,000

## Introduction (~250 words)

- Hook: what the reader will be able to do after reading
- Context: who this guide is for and what it covers
- Table of contents overview (pillar pages MUST include a ToC)

## Why [Topic] Matters (~300 words)

- Motivation, stats, real-world impact
- Answer-first block: why this matters in 40-60 words
- Featured snippet target: definition or list

## [Cluster 1 Topic] Overview (~250 words)

- Summary of the subtopic at overview depth
- Key insight or takeaway
- Link to cluster: "Read the full guide: [cluster page title]"

## [Cluster 2 Topic] Overview (~250 words)

- Same structure as above

## [Cluster N Topic] Overview (~250 words each)

- One section per cluster page topic
- Keep each section at overview depth — 250 words maximum

## Choosing the Right [Topic] Approach (~300 words)

- Decision framework across all cluster topics
- When to use which approach — practical guidance
- Table or flowchart if helpful

## FAQ (~300 words)

- Questions not assigned to any cluster page
- 4-6 questions with direct 40-60 word answers

## Conclusion (~200 words)

- Learning path recommendation (which cluster to read first)
- CTA appropriate to content goal
```

## Cluster Page Intro Requirements

Every cluster page within a hub MUST include a pillar backlink in the introduction:

1. Place a contextual link to the pillar page within the first 2-3 paragraphs of the introduction.
2. Use the pillar page's primary keyword as anchor text (e.g., "complete guide to Claude Code").
3. Frame it naturally: "This post is part of our [complete guide to Claude Code]. Here we focus specifically on..."
4. The link serves both readers (navigation context) and SEO (authority flow to pillar).

Cluster page introductions follow the standard template for their `post_type` (tutorial, comparison, etc.) with this additional linking requirement.

## Pillar Page Rules

### Section depth

Each pillar H2 section covers one cluster topic at overview depth. Write 200-300 words per section — enough to orient the reader, not enough to replace the cluster page. End each section with a contextual link to the corresponding cluster page.

### Table of contents

Pillar pages MUST include a table of contents after the introduction. Use a bulleted list of H2 headings as jump links. This helps readers navigate to the section (and cluster topic) they care about.

### Heading differentiation

Use distinct heading phrasing from cluster pages. If the cluster page heading is "How to Use Claude Code," the pillar section heading should be "Getting Started with Claude Code" or "Claude Code Overview." Identical headings between pillar and cluster pages create confusion for both readers and search engines.

### Keyword ownership

The pillar page targets the broad head term (e.g., "Claude Code"). Each cluster page owns its specific long-tail (e.g., "Claude Code vs Cursor," "how to use Claude Code"). Do not optimize pillar sections for cluster keywords — each page has its own keyword territory.

### Factual consistency

The pillar page is the source of truth for key claims shared across the hub. When a fact appears in both pillar and cluster pages (e.g., performance benchmarks, pricing, feature availability), the cluster page should align with the pillar's version. Note shared facts in the outline for cross-referencing during drafting.

## Pillar Page Anti-Patterns

1. **Going too deep on any single subtopic.** That is the cluster page's job. If a pillar section exceeds 400 words, it is too deep.
2. **No table of contents.** Pillar pages MUST have a ToC for navigation. Readers scan, not read linearly.
3. **Using the exact same heading as a cluster page.** Differentiate with "Overview of X" vs the cluster's "How to X."
4. **Missing the FAQ section.** The pillar FAQ catches questions not assigned to any cluster page. Omitting it wastes AEO opportunities.
5. **Exceeding 5,000 words.** Diminishing returns — the clusters carry the depth. Target 3,000-4,000.
6. **Orphan sections.** Every body H2 section should link to a cluster page. A section with no corresponding cluster is either a candidate for a new cluster or should be folded into an existing section.
7. **No contextual links to clusters.** Linking only in a "Related Posts" footer wastes link equity. Each section should link inline to its cluster page.
