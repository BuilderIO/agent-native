---
name: hub-linking
description: "This skill should be used when implementing or validating internal links between hub pages. It covers link direction rules (pillar-to-cluster, cluster-to-pillar, cluster-to-cluster), anchor text strategy, hub.yaml link section maintenance, reverse link patch generation for the pillar page, and the hub finalization link sweep. Consumed by seo-optimization and post-publish-checklist when hub_slug is present."
---

# Hub Linking

Define and enforce the internal linking rules that connect hub pages into a cohesive topic cluster. This skill is a cross-cutting reference -- it does not run as a standalone pipeline phase. Instead, `seo-optimization` (Phase 8) and `post-publish-checklist` (Phase 10) consult it when `hub_slug` is present.

**Separation of concerns:**

- **hub-planning** plans link _intentions_ (writes `status: planned` entries to `hub.yaml` links section)
- **hub-linking** (this skill) defines link _rules_ and manages link _implementation_ (turning planned links into `<a>` tags and tracking status)

## References

- [hub-finalization.md](./references/hub-finalization.md) -- Detailed finalization process (link injection, validation sweep, pillar re-check, status update). Consumed by `/content-hub --finalize`.

## When to Use This Skill

- During SEO optimization (Phase 8) of a hub page -- to implement hub-aware internal links
- During post-publish checklist (Phase 10) of a hub page -- to validate and verify hub links
- During hub finalization (`/content-hub --finalize`) -- to inject deferred cluster-to-cluster sibling links (see [hub-finalization.md](./references/hub-finalization.md))
- When manually auditing a hub's internal linking structure

## Prerequisites

- A valid `hub.yaml` exists at `output/hubs/<hub_slug>/hub.yaml` (created by the hub-planning skill)
- The current page's `hub_slug` and `page_slug` are known (from `phases/01-topic-validation.yaml`)
- For link implementation: an edited draft in `post.md` (from Phase 7+)
- For link verification: a published or near-published `post.md`

## Link Topology

```
         ┌──────────┐
    ┌────│  PILLAR  │────┐
    │    └──────────┘    │
    ↕         ↕          ↕
┌───────┐ ┌───────┐ ┌───────┐
│Cluster│↔│Cluster│↔│Cluster│
│   A   │ │   B   │ │   C   │
└───────┘ └───────┘ └───────┘
```

Every cluster has a bidirectional link with the pillar (mandatory). Clusters link to topically adjacent siblings (strategic, not exhaustive). Avoid a complete mesh -- each cluster has 2-3 sibling links maximum.

## Link Direction Rules

### Rule 1: Pillar → Cluster (Mandatory)

The pillar page links to every cluster page. Each link is contextual, placed within the relevant body section (the section that summarizes the cluster's topic).

| Aspect          | Requirement                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| **Count**       | One link per cluster page (8-12 links total)                                 |
| **Placement**   | In the body paragraph of the corresponding H2 section                        |
| **Anchor text** | Descriptive -- use the cluster page's primary keyword or a natural variation |
| **Format**      | Inline contextual link, not a "Related posts" list                           |

**Anti-pattern:** Do NOT dump all cluster links in a single "Related Articles" section at the bottom. Each link belongs in the section that discusses that cluster's topic.

### Rule 2: Cluster → Pillar (Mandatory)

Every cluster page links back to the pillar page within the first 2-3 paragraphs of the post body.

| Aspect          | Requirement                                                          |
| --------------- | -------------------------------------------------------------------- |
| **Count**       | Exactly 1 link to the pillar page                                    |
| **Placement**   | Within the first 2-3 paragraphs (introduction section)               |
| **Anchor text** | The pillar's primary keyword (e.g., "complete guide to Claude Code") |
| **Purpose**     | Establishes the cluster's relationship to the hub anchor             |

**Anti-pattern:** Do NOT place the pillar backlink in the conclusion. The introduction placement signals the relationship early for both readers and search engines.

### Rule 3: Cluster ↔ Cluster (Strategic)

Cluster pages link to topically adjacent siblings. These links create triangular connections that strengthen the hub's internal link equity.

| Aspect        | Requirement                                                                            |
| ------------- | -------------------------------------------------------------------------------------- |
| **Count**     | 2-3 sibling links per cluster page                                                     |
| **Selection** | Link to clusters with related search intents or complementary topics                   |
| **Placement** | In body paragraphs where the sibling topic is naturally relevant                       |
| **Timing**    | Deferred until hub finalization (see Step 5) to avoid re-triggering publish checklists |

**Selection heuristics:**

- A "beginner guide" cluster links to a "tips" or "best practices" cluster
- A "comparison" cluster links to clusters covering the compared tools individually
- An "advanced" cluster links back to the "beginner" cluster for onboarding
- A "setup" cluster links to a "troubleshooting" or "configuration" cluster

**Anti-pattern:** Do NOT create a complete mesh where every cluster links to every other. This dilutes link equity and clutters posts with irrelevant links.

## Link Budget Per Page Type

| Page Type   | Max Internal Links | Breakdown                                                                |
| ----------- | ------------------ | ------------------------------------------------------------------------ |
| **Pillar**  | 15-20              | 1 per cluster (8-12) + 3-5 cross-references to external Builder.io posts |
| **Cluster** | 5-8                | 1 pillar + 2-3 siblings + 2-3 external Builder.io posts or docs          |

These counts include hub links only. External links (non-Builder.io) are separate and governed by the seo-optimization skill's Step 8.

## Anchor Text Strategy

Distribute anchor text across three categories to avoid over-optimization penalties.

| Category               | Share | Description                                | Example (target: "Claude Code vs Cursor") |
| ---------------------- | ----- | ------------------------------------------ | ----------------------------------------- |
| **Primary keyword**    | 50%   | Target page's exact primary keyword        | "Claude Code vs Cursor"                   |
| **Semantic variation** | 30%   | Long-tail or rephrased form of the keyword | "comparing Claude Code and Cursor"        |
| **Natural phrase**     | 20%   | Contextual phrase that reads naturally     | "see how these AI coding tools compare"   |

**Hard rules:**

1. Never use the same anchor text for two different target pages within the hub
2. Never use bare "click here," "read more," or "this article" -- these waste link equity signal
3. Never use the target page's full title as anchor text -- too long, looks unnatural
4. Vary anchor text across pages: if Cluster A links to the pillar with "complete guide to Claude Code," Cluster B should use a variation like "Claude Code overview"

## Process: Link Implementation (During Page Creation)

This process runs as part of seo-optimization (Phase 8) when `hub_slug` is present.

### Step 1: Read Hub Context

Load `output/hubs/<hub_slug>/hub.yaml`. Extract:

- All entries from the `links:` section where `from == current_page_slug` or `to == current_page_slug`
- The current page's role (`pillar` or its cluster slug)
- Sibling page topics and primary keywords (needed for anchor text generation)

### Step 2: Implement Outbound Links

For each link in `hub.yaml` where `from == current_page_slug`:

1. Find the planned `anchor_text` and `placement` from `hub.yaml`
2. Locate the target placement zone in `post.md`:
   - `intro` = first 2-3 paragraphs
   - `body` = the H2 section most relevant to the target page's topic
   - `conclusion` = final section
3. Find or create a natural sentence that can carry the anchor text
4. Insert the link as a markdown inline link: `[anchor text](https://www.builder.io/blog/target-slug)`
5. If the anchor text doesn't fit naturally in any existing sentence, add a brief contextual sentence that includes the link (e.g., "For a deeper comparison, see [Claude Code vs Cursor](https://www.builder.io/blog/claude-code-vs-cursor).")

**URL format:** Use full absolute URLs (`https://www.builder.io/blog/<slug>`) for all Builder.io blog links. This ensures links work when content is syndicated (Dev.to, newsletters) and makes destinations clear in raw markdown.

### Step 3: Verify Inbound Links

For each link in `hub.yaml` where `to == current_page_slug`:

1. Check if the source page (`from`) already exists and is published
2. If the source is the pillar AND the pillar is already published, generate a reverse link patch (see Step 4)
3. If the source is a cluster page that is NOT yet published, skip -- it will implement its outbound link to this page when it goes through its own Phase 8
4. If the source is a cluster page that IS already published, defer -- cluster-to-cluster reverse links are handled during hub finalization (Step 5)

### Step 4: Reverse Link Patches (Pillar Only)

When a new cluster page is created, the pillar page needs a new outbound link pointing to it. Generate a text patch that can be applied to the pillar's `post.md`.

**Patch format** (written to `phases/08-seo-reverse-links.yaml`):

```yaml
reverse_links:
  - target_file: "output/hubs/<hub_slug>/pillar/post.md"
    target_page: pillar
    action: add_link
    anchor_text: "Claude Code for beginners"
    target_url: "https://www.builder.io/blog/claude-code-beginners"
    placement: body
    context: "Insert in the H2 section about getting started"
    before: "Getting started with Claude Code is straightforward."
    after: "Getting started with Claude Code is straightforward. For a step-by-step walkthrough, see [Claude Code for beginners](https://www.builder.io/blog/claude-code-beginners)."
```

**Rules for reverse link patches:**

1. Only generate patches for the pillar page, not for already-published cluster pages
2. Cluster-to-cluster reverse links are deferred to hub finalization (Step 5)
3. Each patch must include `before` and `after` context for precise text replacement
4. The `/content-hub` orchestrator skill applies these patches after each cluster page completes

### Step 5: Hub Finalization Link Sweep

After ALL cluster pages in the hub are created, run a finalization sweep. This step is triggered by the `/content-hub` orchestrator skill during Phase 3 (Hub Finalization).

**5a. Inject deferred cluster-to-cluster links:**

For each planned cluster ↔ cluster link in `hub.yaml`:

1. Read the source cluster's `post.md`
2. Find the appropriate body section
3. Insert the link using the anchor text strategy
4. Write the modified `post.md` back

**5b. Validate completeness:**

For each link in `hub.yaml`:

1. Verify the link exists in the source page's `post.md` (search for the target URL)
2. If found, update `hub.yaml` link status: `implemented` → `verified`
3. If missing, flag as an error in the finalization report

**5c. Check for orphaned pages:**

A page is orphaned if it has zero inbound hub links (no other hub page links to it). Scan `hub.yaml` links section:

- Every cluster must have at least 1 inbound link from the pillar
- Every cluster should have at least 1 inbound link from a sibling (warn if missing, not an error)
- The pillar must have at least 1 inbound link from every cluster

## Hub.yaml Link Section Maintenance

### Link Status Transitions

```
planned → implemented → verified
```

| Status        | Meaning                                                | Set By                                          |
| ------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `planned`     | Link is in the plan, not yet in any post.md            | hub-planning skill (Step 5)                     |
| `implemented` | Link has been inserted into the source post.md         | seo-optimization (Phase 8, this skill's Step 2) |
| `verified`    | Link has been validated to exist in the published post | post-publish-checklist (Phase 10)               |

### Updating hub.yaml After Each Page

After a page completes its pipeline:

1. Update `last_updated` in the `links:` section to today's date
2. For all links where `from == current_page_slug`, set `status: implemented`
3. For links verified during post-publish-checklist, set `status: verified`
4. If reverse link patches were applied to the pillar, set those links to `implemented`

### Link Count Tracking

Maintain a running count in the hub-level status. The `/content-hub` orchestrator skill can display:

```
Hub: claude-code
Links: 24 planned → 18 implemented → 12 verified
Orphaned pages: 0
```

## Examples

### Example 1: Pillar Page Linking

**Hub:** Claude Code (12 cluster pages)

**Pillar post.md H2 section (before linking):**

```markdown
## Getting Started with Claude Code

Claude Code installs as a CLI tool and connects to your terminal.
The setup process takes about 2 minutes.
```

**After hub-linking (link to beginner cluster):**

```markdown
## Getting Started with Claude Code

Claude Code installs as a CLI tool and connects to your terminal.
The setup process takes about 2 minutes. For a detailed walkthrough,
see [how to use Claude Code](https://www.builder.io/blog/claude-code-beginners).
```

**hub.yaml link entry:**

```yaml
- from: pillar
  to: claude-code-beginners
  anchor_text: "how to use Claude Code"
  placement: body
  status: implemented
```

### Example 2: Cluster → Pillar Backlink

**Cluster page (claude-code-vs-cursor) intro (before linking):**

```markdown
Choosing between AI coding tools is one of the biggest decisions
developers face in 2026. Both Claude Code and Cursor offer
powerful AI assistance, but they take fundamentally different approaches.
```

**After hub-linking (pillar backlink in intro):**

```markdown
Choosing between AI coding tools is one of the biggest decisions
developers face in 2026. This comparison is part of our
[complete guide to Claude Code](https://www.builder.io/blog/claude-code-guide), which covers
the full ecosystem. Both Claude Code and Cursor offer powerful AI
assistance, but they take fundamentally different approaches.
```

**Anchor text category:** Primary keyword (50% bucket) -- uses pillar's primary keyword.

### Example 3: Reverse Link Patch

**Scenario:** The "Claude Code for Beginners" cluster page just completed. The pillar page needs a link to it.

**Generated patch (phases/08-seo-reverse-links.yaml):**

```yaml
reverse_links:
  - target_file: "output/hubs/claude-code/pillar/post.md"
    target_page: pillar
    action: add_link
    anchor_text: "beginner's guide to Claude Code"
    target_url: "https://www.builder.io/blog/claude-code-beginners"
    placement: body
    context: "H2 section: Getting Started with Claude Code"
    before: "The setup process takes about 2 minutes."
    after: "The setup process takes about 2 minutes. For a detailed walkthrough, see our [beginner's guide to Claude Code](https://www.builder.io/blog/claude-code-beginners)."
```

### Example 4: Finalization Sibling Links

**Scenario:** Hub finalization injects a link from "Claude Code vs Cursor" → "Claude Code for Beginners."

**Before (claude-code-vs-cursor/post.md):**

```markdown
If you're new to Claude Code, the learning curve is gentler than
you might expect. Most developers are productive within a day.
```

**After finalization link sweep:**

```markdown
If you're new to Claude Code, the learning curve is gentler than
you might expect. Our [Claude Code beginner's guide](https://www.builder.io/blog/claude-code-beginners)
covers the full onboarding process. Most developers are productive within a day.
```

**hub.yaml link entry updated:**

```yaml
- from: claude-code-vs-cursor
  to: claude-code-beginners
  anchor_text: "Claude Code beginner's guide"
  placement: body
  status: implemented # Updated from planned during finalization
```

### Example 5: Orphan Detection

**Scenario:** After finalization, Cluster G has no inbound sibling links (only the pillar links to it).

**Finalization report:**

```
WARNING: Cluster "claude-code-mcp-servers" has 0 inbound sibling links.
  - Inbound from pillar: 1 (verified)
  - Inbound from clusters: 0

  Suggestion: Add a link from "advanced-claude-code-tips" → "claude-code-mcp-servers"
  (MCP servers are an advanced topic, natural fit)
```

## Guidelines

- Hub linking modifies existing content in `post.md`. Every link insertion must read naturally -- if a link cannot be added without disrupting flow, find a different sentence or add a brief contextual sentence.
- The pillar page is the only page that receives reverse link patches during sequential cluster creation. Cluster-to-cluster links are deferred to finalization to avoid re-opening published pages mid-pipeline.
- Anchor text diversity across the hub matters more than within a single page. Track which anchor text has been used for each target page across all source pages to avoid repetition.
- The link budget (15-20 for pillar, 5-8 for clusters) includes hub links only. External links and non-hub Builder.io blog links are additive, governed by seo-optimization Step 8.
- Link status in `hub.yaml` is the source of truth for resume support. If the hub pipeline is interrupted, the `/content-hub` orchestrator skill reads link statuses to determine which links still need implementation or verification.
- Do not generate reverse link patches for cluster-to-cluster links during sequential creation. This avoids re-triggering post-publish-checklist on already-published pages. All cluster-to-cluster links are injected during finalization.
- A hub with orphaned pages after finalization has a structural problem. Every page must be reachable from at least the pillar. Warn the user but do not auto-fix -- the author decides where the link fits best.
