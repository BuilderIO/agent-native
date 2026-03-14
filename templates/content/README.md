# Content Pipeline

The content pipeline lives in `.builder/` and runs natively in the agent chat. It provides end-to-end blog creation, from topic research to publish-ready posts, with SEO/AEO optimization and style enforcement.

## Quick Start

Type any `/content-*` command in agent chat:

```
/content-blog "React Server Components best practices"
/content-research "headless CMS migration guide"
/content-lfg "AI code review tools comparison"
```

Each command runs an orchestrator skill that coordinates research agents, writing agents, and knowledge skills to produce pipeline artifacts in `output/posts/YYYY-MM-DD-topic-slug/`.

## Orchestrator Skills

These are the user-facing entry points. Invoke them with `/content-*` followed by a topic or output folder path.

### Full Pipelines

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-blog** | `/content-blog "topic"` | Full pipeline: research, outline, draft, edit, optimize, publish checklist. Stops at approval gates for your review. |
| **content-lfg** | `/content-lfg "topic"` | Same pipeline as content-blog but fully autonomous — zero approval gates. Use when you want maximum speed. |

### Individual Phases

Run phases independently when you want more control:

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-research** | `/content-research "topic"` | Research only: topic validation, keyword research, SERP analysis, multi-source research, and outline creation. Stops before drafting. |
| **content-write** | `/content-write output/posts/...` | Writes and edits a post from completed research. Use after `/content-research`. |
| **content-optimize** | `/content-optimize output/posts/...` | SEO optimization, AEO optimization, and publish readiness checks. Use after drafting. |
| **content-polish** | `/content-polish output/posts/...` | Section-by-section editorial polish with style guide enforcement. Voice/tone cleanup and final editing pass. |

### Content Refresh

Update existing posts against current data:

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-refresh** | `/content-refresh output/posts/...` | End-to-end refresh: re-analyzes keywords/SERPs, scopes changes, rewrites affected sections, re-optimizes. |
| **content-refresh-research** | `/content-refresh-research output/posts/...` | Research phase only: fetches original post, analyzes keyword/SERP deltas, recommends scope (keep/rewrite/add per section). |
| **content-refresh-write** | `/content-refresh-write output/posts/...` | Rewrites changed sections based on refresh research findings. Use after `/content-refresh-research`. |

### Content Hubs

Build topic clusters:

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-hub** | `/content-hub "broad topic"` | Plans a content hub (topic cluster) with pillar page and cluster pages. Also supports `--expand` and `--finalize` modes. |

### Post-Pipeline

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-revise** | `/content-revise output/posts/...` | Resolves teammate feedback. Parses quoted comments from Notion reviews and applies corrections with voice gate enforcement. |
| **content-compound** | `/content-compound output/posts/...` | Captures pipeline learnings into searchable knowledge at `docs/solutions/`. Run after completing a post to document what worked. |

### Setup & Maintenance

| Skill | Command | What it does |
|-------|---------|-------------|
| **content-seed** | `/content-seed "topic"` | Creates a seed research folder with placeholders for your existing materials (articles, URLs, docs, videos) to feed into research. |
| **content-style-update** | `/content-style-update "correction"` | Updates the style guide (`.content-style-guide.md`) from editorial corrections or new writing rules. |
| **content-builder-update** | `/content-builder-update "new info"` | Updates Builder.io product knowledge, persona, messaging, or competitive intelligence from new information. |

## Typical Workflows

### New blog post (with review)
```
/content-blog "topic"        # Full pipeline with approval gates
```

### New blog post (fast)
```
/content-lfg "topic"          # No gates, full speed
```

### Step-by-step control
```
/content-research "topic"     # Research + outline
# Review outline, then:
/content-write output/posts/2026-03-06-topic-slug/
/content-optimize output/posts/2026-03-06-topic-slug/
/content-polish output/posts/2026-03-06-topic-slug/
```

### Refresh an old post
```
/content-refresh output/posts/2025-01-15-old-post/
```

### Build a topic cluster
```
/content-hub "headless CMS"   # Plans pillar + cluster pages
# Then create each page individually with /content-blog or /content-research
```

## Knowledge Skills

These are reference skills loaded by orchestrators during execution. You don't invoke them directly — they provide methodology, rules, and templates.

| Skill | What it provides |
|-------|-----------------|
| `keyword-research` | Ahrefs MCP tool mapping, keyword analysis methodology |
| `serp-analysis` | SERP scoring rubrics, intent classification, beatability assessment |
| `multi-source-research` | Multi-source research methodology (docs, HN, X, YouTube, SO, Reddit) |
| `topic-discovery` | Topic validation criteria, awareness vs. acquisition classification |
| `outline-creation` | Outline templates, AEO heading patterns, structure rules |
| `blog-drafting` | Writing patterns, hook types, paragraph structure, voice guide |
| `style-guide` | Dual-location style architecture (project default + local override) |
| `content-editing` | 4-pass editing methodology, AI-voice detection, word count enforcement |
| `seo-optimization` | On-page SEO, meta descriptions, schema markup templates |
| `aeo-optimization` | Answer Engine Optimization, heading transformations for AI visibility |
| `post-publish-checklist` | Final QA checklist before publishing |
| `content-refresh-analysis` | Refresh delta thresholds, section-level scope recommendations |
| `hub-planning` | Hub/cluster planning methodology |
| `hub-linking` | Internal link rules, hub finalization process |
| `seed-research` | Seed file validation, ingestion, merge strategy |
| `content-compound-docs` | Pipeline learning documentation format and categorization |
| `builder-product-knowledge` | Builder.io capabilities, positioning, CTAs |
| `builder-messaging` | Builder.io messaging pillars, strategic narrative |
| `builder-competitor-knowledge` | Competitive intelligence across 4 categories |
| `builder-persona-knowledge` | 5 buyer personas with recognition signals and objection handling |

## Content Agents

Specialized subagents dispatched by orchestrators during pipeline phases. Located in `.builder/agents/`.

| Agent | Role |
|-------|------|
| `content-strategist` | Topic validation, content goal classification, keyword strategy |
| `seo-researcher` | Deep keyword analysis and SERP intelligence via Ahrefs |
| `content-researcher` | Multi-source research across docs, HN, X, YouTube, SO, Reddit |
| `content-spec-analyzer` | Cross-phase consistency checks on pipeline artifacts |
| `blog-writer` | First draft writing in voice with AEO blocks and Builder.io integration |
| `content-editor` | 4-pass editing: clarity, flow, AI-voice detection, engagement |
| `search-optimizer` | SEO + AEO optimization and publish readiness |
| `hub-strategist` | Hub planning, cluster page discovery, keyword mapping |
| `learnings-capturer` | Documents pipeline learnings to `docs/solutions/` |

## Style Guide

The pipeline uses a dual-location style guide:

1. **Project default** — `.builder/skills/style-guide/references/default-voice-and-tone.md` (baseline rules)
2. **Local override** — `.content-style-guide.md` at project root (your customizations)

Local rules override project defaults section-by-section. Update via `/content-style-update`.
