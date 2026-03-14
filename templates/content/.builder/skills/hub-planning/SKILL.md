---
name: hub-planning
description: "This skill should be used when planning a content hub (topic cluster). It covers hub topic validation, cluster page discovery via Ahrefs API sequence, keyword partitioning, business potential scoring, link planning, publishing schedule generation, and hub.yaml schema output."
---

# Hub Planning

Plan a content hub from a broad topic. Discover cluster pages using Ahrefs, partition keywords to prevent cannibalization, score business potential, plan internal links, and output a `hub.yaml` blueprint that orchestrates the entire hub creation pipeline.

## When to Use This Skill

- A broad topic has been proposed for a content hub (not a single blog post)
- Planning a pillar page with 8-12 supporting cluster pages
- Evaluating whether a topic has enough subtopics and search demand for a hub

## Prerequisites

- Ahrefs MCP server available (check with `subscription-info-limits-and-usage` first)
- Familiarity with [ahrefs-tool-mapping.md](../keyword-research/references/ahrefs-tool-mapping.md) for API call patterns and cost-saving rules

## Process

### Step 0: Check Ahrefs API Budget

Call `subscription-info-limits-and-usage` to verify sufficient units remain. Hub planning consumes **2,000-3,300 units** for the planning phase alone. The full hub (planning + all pages) may consume up to **40,000 units**.

Display to the user: "Ahrefs API: X units remaining (resets YYYY-MM-DD). Hub planning will use ~3,000 units. Full hub creation may use up to 40,000 units total."

**Budget thresholds for hub planning:**

| Remaining Units | Action |
|----------------|--------|
| >= 50,000 | Proceed normally |
| 40,000 - 49,999 | Proceed with warning: "Budget tight for a full hub. Planning is safe." |
| < 40,000 | Warn user: "Insufficient budget for a full hub. Proceed with planning only?" |

### Step 1: Hub Topic Validation

Confirm the hub topic is viable before investing in cluster discovery.

**1a. Search demand check:**
Call `keywords-explorer-overview` with the broad hub topic. Check `volume` and `traffic_potential`. A viable pillar topic should have:
- Volume >= 1,000 (broad topics need high demand)
- Traffic potential >= 5,000 (the #1 page gets traffic from many related keywords)

**1b. Subtopic breadth check (Ahrefs pillar qualifying questions):**
- Does the topic have enough subtopics? Target 5-20 cluster pages. Too few = not worth a hub. Too many = topic is too broad, narrow it.
- Can we match search intent for the pillar query? Check top 10 results via `serp-overview` — are they comprehensive guides or narrow articles?

**1c. Existing hub check:**
Scan `output/hubs/*/hub.yaml` for an existing hub covering the same or overlapping topic. If found, recommend expanding the existing hub instead.

**1d. Content pillar alignment:**
Map the hub topic to one of the 4 content pillars:

| Pillar | Topics |
|--------|--------|
| **visual-development** | Visual CMS, design-to-code, component editing, Figma workflows |
| **dev-marketer-collab** | Content workflows, reducing Jira tickets, team handoffs |
| **framework-integration** | Next.js, React, Angular, Qwik, Nuxt, Vue, Svelte |
| **performance** | Core Web Vitals, image optimization, bundle size |

**1e. Hub opportunity score:**
Score = search_demand × strategic_fit × gap_size (each 1-5). Score >= 3.0 = proceed.

### Step 1.5: Accept User-Provided Cluster Ideas

Before running Ahrefs discovery, check whether the user has provided cluster page ideas. These become **seed clusters** that get validated alongside Ahrefs-discovered clusters.

**If user ideas are provided:**

1. Record each idea as a seed cluster with `source: user`
2. Extract or infer a primary keyword from each idea (the user may provide a topic phrase, a keyword, or both)
3. Pass seed clusters forward to Step 2 for Ahrefs validation

**If no user ideas provided:** Skip to Step 2. Ahrefs discovery runs on its own.

**Important:** User ideas are NOT free passes. They must undergo the same validation pipeline as Ahrefs-discovered clusters (Steps 2B and 2C). User ideas can fail validation — but unlike Ahrefs clusters, a failing user idea gets a **warning** instead of silent removal, because the user chose it deliberately.

### Step 2: Cluster Page Discovery (Ahrefs API Sequence)

Run three phases of Ahrefs research to build the keyword universe and identify cluster pages. If user-provided seed clusters exist from Step 1.5, include them in the validation pipeline.

**Phase A — Keyword Universe** (~1,000-1,500 units):

1. `keywords-explorer-matching-terms` with hub topic as seed keyword, mode: `phrase_match`. Limit: 500. Returns keywords containing the hub topic phrase.
2. `keywords-explorer-related-terms` with mode: `also_rank_for`. Limit: 200. Keywords that pages ranking for the hub topic also rank for.
3. `keywords-explorer-related-terms` with mode: `also_talk_about`. Limit: 200. Semantically related terms that top-ranking content discusses.
4. `keywords-explorer-search-suggestions` for autocomplete-style long-tail variations. Limit: 100.

**Phase B — Cluster Identification** (~500-1,000 units):

1. Group Phase A keywords by **Parent Topic** (from Ahrefs `keywords-explorer-overview`). Keywords sharing a Parent Topic target the same page. Label Ahrefs-discovered clusters with `source: ahrefs`.
2. For each potential cluster (Parent Topic group), call `keywords-explorer-overview` to get volume, KD, and traffic potential.
3. **Validate user seed clusters (if any):** For each user-provided idea from Step 1.5, call `keywords-explorer-overview` on the user's keyword to get volume, KD, and traffic potential. If a user idea's keyword matches an Ahrefs-discovered cluster's parent topic, **merge**: keep the user's angle/topic but enrich with Ahrefs data (volume, KD, traffic potential). Label merged clusters `source: user+ahrefs`. Unmatched user ideas remain standalone with `source: user`.
4. Extract question keywords (modifiers: how, what, why, when, which, can, does, is) for AEO heading coverage.
5. Call `serp-overview` on the pillar keyword to mine People Also Ask (PAA) questions.

**Phase C — Cannibalization Check** (~500-800 units):

1. For each planned cluster keyword (both Ahrefs-discovered and user-provided), call `serp-overview` and compare top-10 URLs across cluster pages.
2. If two cluster pages share > 3 URLs in their top-10 SERPs, they likely cannibalize — merge the clusters or differentiate the angle. If a user idea cannibalizes an Ahrefs cluster, flag and present options (merge, differentiate, or keep both with a warning).
3. Cross-check against existing content:
   - Glob `output/posts/*/metadata.yaml` for standalone posts with overlapping keywords
   - Glob `output/hubs/*/hub.yaml` for overlap with other hubs
   - If overlap found, present options: adopt existing post, refresh it, create new, or exclude the subtopic

### Step 3: Cluster Page Definition

Map each cluster (Ahrefs-discovered, user-provided, or merged) to a planned cluster page. Preserve the `source` label from Step 2.

**3a. Search intent assignment** using intent modifiers:

| Intent | Modifiers |
|--------|-----------|
| **informational** | how, what, why, guide, tutorial, tips, learn, examples |
| **commercial** | best, top, review, comparison, vs, pricing |
| **transactional** | buy, order, pricing, cheap, download |
| **navigational** | [brand name], [product name], login, docs |

A well-balanced hub should cover multiple intent types.

**3b. Business potential scoring** (0-3, from Ahrefs product-led content methodology):

| Score | Meaning | Example |
|-------|---------|---------|
| **3** | Builder.io is irreplaceable for solving the problem | "Visual CMS setup with Next.js" |
| **2** | Builder.io helps but is not essential | "Component-driven development" |
| **1** | Builder.io can only be mentioned briefly | "React vs Vue comparison" |
| **0** | No business connection — remove from hub plan | "Rust async patterns" |

For Ahrefs-discovered clusters (`source: ahrefs`), remove any scoring 0 — it dilutes the hub. For user-provided clusters (`source: user` or `source: user+ahrefs`), a score of 0 triggers a **warning** instead: "Your idea [X] has no clear Builder.io connection. Keep it?" The user decides whether to keep or remove their own ideas.

**3c. Priority assignment:**
Sort clusters by: `business_potential DESC`, then `search_volume DESC`. Assign `priority: 1` to the first cluster page to create, `priority: 2` to the second, and so on.

**3d. Target count:** 8-12 cluster pages per hub. If fewer than 8 viable clusters exist, the topic may be too narrow for a hub. If more than 15, consider splitting into two hubs.

### Step 4: Pillar Page Scoping

Define the pillar page structure at overview depth.

**4a. Section mapping:** One H2 section per cluster page topic. Each section provides a brief summary (100-200 words) that gives the reader context, then links to the cluster page for the deep dive.

**4b. Word count target:** 3,000-4,000 words. Long enough for comprehensive coverage, short enough for readability. Do NOT exceed 5,000 words — the clusters carry the depth.

**4c. FAQ section:** Include a FAQ section for question keywords not assigned to any cluster page. Catches AEO coverage gaps.

**4d. Keyword partitioning:** The pillar page targets the broad head term. Each cluster owns its specific long-tail. No overlap. Clear keyword ownership prevents cannibalization AND improves keyword density scores per page.

**4e. Schema type:** Pillar pages use `Article` schema with `hasPart` array listing cluster page URLs. Cluster pages use standard `BlogPosting` with `isPartOf` pointing to the pillar.

### Step 5: Link Planning

Design the internal linking structure and write it into `hub.yaml`.

**5a. Mandatory links:**
- Pillar → every cluster: contextual link in the relevant body section, descriptive anchor text
- Cluster → pillar: within the first 2-3 paragraphs of every cluster page, using pillar's primary keyword as anchor

**5b. Sibling links (strategic, not exhaustive):**
- Link clusters with related search intents (e.g., "beginner guide" → "vs comparison")
- Target 2-3 sibling links per cluster page
- Avoid a complete mesh — not every cluster needs to link to every other

**5c. Anchor text distribution:**
- 50% primary keyword of the target page
- 30% semantic variations and long-tail forms
- 20% natural phrases (e.g., "learn more about X")
- Never use the same anchor text for two different target pages
- Never use bare "click here" or "read more"

**5d. Max links per page:**
- Pillar: 15-20 internal links (one per cluster + a few cross-references)
- Cluster: 5-8 internal links (1 pillar + 2-3 siblings + 2-3 external)

**5e. Write all planned links into the `hub.yaml` `links:` section with `status: planned`.** Link implementation happens later during SEO optimization (hub-linking skill).

### Step 6: Publishing Schedule

Recommend the creation order and estimate timeline.

**6a. Publishing strategy:** Pillar-first (hardcoded for v1). The pillar page is created and published before any cluster pages. This establishes the hub anchor.

**6b. Creation order:** Cluster pages are created sequentially in priority order (from Step 3c). No waves or batches for v1.

**6c. Timeline estimate:**
- Hub planning: 15-30 minutes
- Pillar page (lfg mode): 45-90 minutes
- Each cluster page (lfg mode): 30-60 minutes
- Total for a 10-page hub: 9-15 hours (not including human review time)

### Step 7: Output hub.yaml

Write the hub blueprint to `output/hubs/<hub-slug>/hub.yaml`.

**hub.yaml schema:**

```yaml
schema_version: 1
hub_name: "Hub Display Name"
hub_slug: hub-slug
content_pillar: framework-integration
content_goal: hybrid  # default for all pages unless overridden per-page
created_date: YYYY-MM-DD
status: planning
ahrefs_units_consumed: 0  # increment after each Ahrefs call

pillar:
  topic: "The Complete Guide to [Topic]"
  primary_keyword: "[broad keyword]"
  search_volume: 12000
  target_word_count: 3500  # 3,000-4,000 range
  business_potential: 3  # 0-3
  status: planned
  output_path: pillar/

clusters:
  - slug: cluster-slug
    topic: "Cluster Page Title"
    primary_keyword: "cluster keyword"
    search_volume: 2400
    search_intent: commercial
    business_potential: 3
    content_goal: acquisition  # override hub default if needed
    target_word_count: 2200
    status: planned
    output_path: clusters/cluster-slug/
    priority: 1
    source: ahrefs  # ahrefs | user | user+ahrefs

  # ... 8-12 cluster entries total

links:
  last_updated: YYYY-MM-DD

  # Pillar → Cluster
  - from: pillar
    to: cluster-slug
    anchor_text: "descriptive anchor"
    placement: body
    status: planned

  # Cluster → Pillar (mandatory for every cluster)
  - from: cluster-slug
    to: pillar
    anchor_text: "pillar primary keyword"
    placement: intro
    status: planned

  # Cluster ↔ Cluster (strategic, not exhaustive)
  - from: cluster-slug-a
    to: cluster-slug-b
    anchor_text: "related anchor"
    placement: body
    status: planned

publishing_strategy: pillar-first
current_page_index: 0  # for resume support
```

**Page status transitions:**

```
planned → in-progress → researched → drafted → published
                     → failed (pipeline error)
                     → skipped (user chose to skip)
```

**Hub status transitions:**

```
planning → scaffolded → in-progress → published (all non-skipped pages done)
                                     → partial (some pages done, user stopped)
```

## Existing Post Overlap

If hub planning discovers existing standalone posts in `output/posts/` that cover a planned cluster topic, present these options:

| Option | Action |
|--------|--------|
| **Adopt** | Move the existing post into the hub as a cluster page |
| **Refresh** | Run `/content-refresh` on the existing post with hub context |
| **Create new** | Create a fresh cluster page (old post remains standalone) |
| **Exclude** | Remove that subtopic from the hub plan |

## Examples

### Example 1: Strong Hub Topic

**Input:** "Claude Code"

**Evaluation:**
- Search volume: 12,000+, traffic potential: 28,000+
- Subtopics: 15+ (setup, vs Cursor, CLAUDE.md, MCP, hooks, IDE integration, testing, debugging, etc.)
- Content pillar: `framework-integration`
- Hub opportunity score: 4.5
- Cluster pages discovered: 12 (trimmed from 15 to avoid dilution)
- Business potential: 8 of 12 clusters score 2+

**Output:** `hub.yaml` with pillar ("The Complete Guide to Claude Code") + 12 clusters, 36 planned links, pillar-first schedule.

### Example 2: Too-Narrow Topic

**Input:** "CSS Grid"

**Evaluation:**
- Search volume: 8,000, traffic potential: 15,000
- Subtopics: 4-5 (not enough for a hub)
- Recommendation: Create a standalone comprehensive post instead. Or broaden to "CSS Layout" hub (grid, flexbox, container queries, subgrid, etc.)

### Example 3: Hub with Existing Posts

**Input:** "Visual CMS"

**Evaluation:**
- Discovered 3 existing posts in `output/posts/` that cover planned cluster topics
- Presented adopt/refresh/create/exclude options for each
- After user decisions: 2 adopted, 1 excluded, 7 new cluster pages planned
- Total hub: 1 pillar + 9 cluster pages (2 adopted + 7 new)

## Guidelines

- Hubs are **evergreen only** for v1. Trending topics lack the Ahrefs keyword data needed for cluster discovery.
- Target 8-12 cluster pages. Fewer than 8 suggests the topic is too narrow. More than 15 suggests it is too broad.
- The pillar page targets the broad head term. Each cluster owns specific long-tails. Clear keyword ownership is non-negotiable.
- Business potential 0 pages should be removed, not just deprioritized. They dilute the hub.
- Keyword partitioning between pillar and clusters is critical. If the pillar "owns" the broad keyword and clusters own specific long-tails, keyword density scores improve because focus is cleaner.
- The pillar page is the "source of truth" for key claims about the hub topic. Cluster pages should reference pillar claims, not reinvent them, to avoid factual inconsistency across the hub.
- After hub planning, recommend a manual style audit across all hub pages after finalization. Voice drift increases with each page in lfg mode.
- Hub planning should take 15-30 minutes. Do not over-optimize the plan — the pipeline will refine each page individually.
