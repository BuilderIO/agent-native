---
name: builder-competitor-knowledge
description: >
  This skill should be used when producing competitive marketing or sales content.
  Provides Builder.io's competitive positioning across 4 categories with competitor profiles,
  proof points, discovery questions, and sales guidance. Use when deliverables involve
  competitive comparisons, battle cards, or sales call preparation. Skip for generic/educational content.
---

# Builder.io Competitor Knowledge

Builder.io competes in 4 distinct categories simultaneously. Use these profiles to select the right differentiators, proof points, discovery questions, and sales guidance for the specific competitive context.

## When to Use

Use this skill when producing content that involves competitive positioning:

- Competitive landing pages and comparison content
- Battle cards and competitive campaign briefs
- Sales call preparation against named competitors
- Email sequences targeting competitive displacement
- LinkedIn outreach referencing competitor pain points
- Case studies with switching stories

**When NOT to use:** Skip for generic/educational content (blog posts, tutorials), internal announcements, social posts without competitive framing, or any deliverable that doesn't reference competitors or competitive positioning.

## Competitive Category Quick Reference

### Category Overview

| Category                    | Slug              | Reference File                                                                | Key Competitors                                                          | Core Battle                                    | Builder's Advantage                                                       |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
| Prototyping/AI App Builders | `prototyping`     | [prototyping-ai-app-builders.md](./references/prototyping-ai-app-builders.md) | v0, Lovable, Bolt, Replit, Figma Make                                    | Production-ready vs. demo code                 | Real design system components, no "demo code ceiling"                     |
| AI IDEs                     | `ai-ides`         | [ai-ides.md](./references/ai-ides.md)                                         | Cursor, GitHub Copilot, Windsurf                                         | Visual editing + AI vs. pure code generation   | No "reprompting ceiling," non-developers participate                      |
| AI Agents                   | `ai-agents`       | [ai-agents.md](./references/ai-agents.md)                                     | Devin, Factory.ai, GitHub Copilot Workspace                              | Collaboration workspace vs. autonomous agent   | No "autonomy ceiling," human-in-the-loop, distributed QA                  |
| Traditional CMS             | `traditional-cms` | [traditional-cms.md](./references/traditional-cms.md)                         | Contentful, Sanity, Strapi, Webflow, Framer, Wix, WordPress, Drupal, AEM | Speed + intelligence vs. traditional workflows | AI-first workflows, real design system integration, no developer blockers |

### Competitor-to-Category Lookup

| Competitor               | Aliases             | Category          | Tier   |
| ------------------------ | ------------------- | ----------------- | ------ |
| v0 (Vercel)              | v0, vercel v0       | `prototyping`     | Tier 1 |
| Lovable                  | GPT Engineer        | `prototyping`     | Tier 1 |
| Bolt (StackBlitz)        | StackBlitz          | `prototyping`     | Tier 1 |
| Replit Agent             | Replit              | `prototyping`     | Tier 1 |
| Figma Make               |                     | `prototyping`     | Tier 1 |
| Claude Artifacts         | Anthropic Artifacts | `prototyping`     | Tier 2 |
| Cursor                   |                     | `ai-ides`         | Tier 1 |
| GitHub Copilot           | Copilot             | `ai-ides`         | Tier 1 |
| Windsurf                 | Codeium             | `ai-ides`         | Tier 1 |
| Devin (Cognition)        | Devin, Cognition    | `ai-agents`       | Tier 1 |
| GitHub Copilot Workspace | Copilot Workspace   | `ai-agents`       | Tier 2 |
| Factory.ai               | Factory             | `ai-agents`       | Tier 2 |
| Cursor Background Agents |                     | `ai-agents`       | Tier 2 |
| Contentful               |                     | `traditional-cms` | Tier 1 |
| Sanity                   |                     | `traditional-cms` | Tier 1 |
| Strapi                   |                     | `traditional-cms` | Tier 1 |
| Webflow                  |                     | `traditional-cms` | Tier 1 |
| Framer                   |                     | `traditional-cms` | Tier 1 |
| Wix                      |                     | `traditional-cms` | Tier 1 |
| WordPress                | WP                  | `traditional-cms` | Legacy |
| Adobe AEM                | AEM                 | `traditional-cms` | Legacy |
| Drupal                   |                     | `traditional-cms` | Legacy |

## Shared Differentiators

These 4 differentiators apply across all competitive categories. Category-specific elaboration lives in the reference files.

1. **Real Component Systems** -- Builder works with actual design system components, not generic ShadCN/Tailwind. Every category competitor uses generic libraries.
2. **Visual + Code Flexibility** -- Not forced to choose between visual editing and code control. Unique across all 4 categories.
3. **Production Quality** -- Not demo code. Accessibility, performance, enterprise requirements baked in.
4. **Ongoing Iteration** -- Not one-shot generation. Continuous visual editing after initial creation.

## Category Selection Process

Identify which category a deliverable targets using one of three paths:

**Path 1 -- Explicit:** Plan metadata or `_progress.yaml` specifies `competitive_categories: [slug]` -- use them directly. Read the corresponding reference file(s).

**Path 2 -- Named Competitor:** User names a specific competitor -- look up in the Competitor-to-Category Lookup table above -- confirm the category with the user.

**Path 3 -- Contextual:** No competitor named but competitive intent detected. Competitive intent indicators: "vs.", "compare", "alternative to", "switch from", "migrate from", "better than", "competitor", "battle card", "competitive", "displacement", "win against". Ask the user which category:

> "Which competitive category does this target?"
>
> 1. Prototyping/AI App Builders (v0, Lovable, Bolt, Replit, Figma Make)
> 2. AI IDEs (Cursor, GitHub Copilot, Windsurf)
> 3. AI Agents (Devin, Factory.ai, Copilot Workspace)
> 4. Traditional CMS (Contentful, Sanity, Webflow, WordPress, etc.)

Persist the selection as `competitive_categories: [slug]` in the deliverable's metadata or `_progress.yaml`. Valid slugs: `prototyping`, `ai-ides`, `ai-agents`, `traditional-cms`.

**Unknown competitors:** If a competitor is not in the lookup table, ask the user which category is closest, or use shared differentiators only.

## Reference File Loading Protocol

How many reference files to read based on category count:

- **1 category identified** -- Read that 1 reference file
- **2 categories identified** (e.g., prospect evaluating tools across categories) -- Read both reference files
- **3+ categories or "all"** -- Read ONLY the Quick Reference tables and Shared Differentiators above, not individual reference files. If the user needs deeper detail, split the deliverable by category.
- **Default maximum: 2 reference files per deliverable.** If more are needed, the deliverable should be split.

| Scenario                                 | Files Loaded            | Estimated Words |
| ---------------------------------------- | ----------------------- | --------------- |
| Single-category competitive landing page | SKILL.md + 1 reference  | ~950-1,250      |
| Two-category competitive campaign brief  | SKILL.md + 2 references | ~1,650-2,250    |
| Generic review (competitive check only)  | SKILL.md only           | ~250            |

## Guidelines

### Never Fabricate Competitor Weaknesses

Only use information from the reference files. Do not invent, exaggerate, or speculate about competitor limitations.

### Attribution Accuracy

Never cite unattributed proof points as attributed. The AI Agents category has unattributed industry feedback -- do not present it as named customer quotes. Use the attribution markers in reference files to distinguish:

- `**Adobe:**` or `**Cisco:**` -- attributed, named company
- `**Industry feedback (unattributed):**` -- real feedback, no company name
- `**Expected pattern:**` -- hypothetical, no real source

### Respect Red Flags

Each category has "Red flags indicating wrong fit." When the prospect's need actually aligns with a competitor, acknowledge it honestly.

### Acknowledge Competitor Strengths First

Lead with what competitors do well, then explain where Builder goes further. No FUD (fear, uncertainty, doubt).

### Preserve Quote Attribution

Customer quotes (Adobe, Cisco, Jane App) must be attributed to the correct company and context. Never move a quote to a different company or context.

### Don't Mix Categories

Do not mix competitive categories in a single 1:1 deliverable. If a prospect evaluates across categories, create separate sections per category.

### Compounding

Update reference files when PMM shares updated competitive intelligence, new deals close with competitive displacement stories, competitors ship significant features, or campaign learnings reveal new competitive patterns. Track changes via `last_updated` and `last_verified` dates at the top of each reference file.

For Builder.io's messaging pillars and strategic narrative, see the `builder-messaging` skill (`.builder/skills/builder-messaging/SKILL.md`).
For Builder.io product capabilities, positioning, and branding rules, see the `builder-product-knowledge` skill (`.builder/skills/builder-product-knowledge/SKILL.md`).
For buyer persona profiles and recognition signals, see the `builder-persona-knowledge` skill (`.builder/skills/builder-persona-knowledge/SKILL.md`).
