---
name: builder-messaging
description: >
  This skill should be used when producing any content that articulates Builder.io's
  positioning, messaging pillars, category narrative, or transformation story. Provides
  Builder.io's official messaging framework: top-level message, 3-pillar messaging house
  (Context, Collaboration, Trust), strategic narrative, and persona resonance. Skip for
  internal docs or content that doesn't mention Builder.io.
---

# Builder.io Messaging

Builder.io's official messaging framework from the PMM team. This is the source of truth for how Builder.io talks about itself -- the messaging house (3 pillars), the strategic narrative, persona resonance, and category definition.

## When to Use

Use this skill when producing **any content that positions Builder.io externally**:

- Campaign briefs and landing pages
- Email sequences with pillar emphasis
- LinkedIn outreach referencing Builder.io's value
- Call scripts and demo prep
- Case studies and competitive positioning pieces
- Pitch decks, keynotes, and presentations
- Any content that articulates Builder.io's narrative or transformation story

**When NOT to use:** Skip for internal docs, content that doesn't mention Builder.io, purely educational content (tutorials, how-tos), social posts without positioning intent, or internal Slack announcements.

## Messaging Quick Reference

| Element           | Content                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Top-Level Message | "The agentic development platform where your team and AI agents build, review, and ship apps and sites with confidence." |
| Elevator Analogy  | What Figma did for product design, Builder is doing for product development, with AI.                                    |
| Category          | Agentic Development Platform                                                                                             |

### Category Definition

Agentic development is a new way to build software. AI agents and every role on the product team work together in shared workflows to build, review, and ship production-ready code.

Traditional development makes engineering the bottleneck. Existing AI tools only operate in isolated steps of the end to end product development cycle.

Agentic development changes three things: who participates in development, how they work together, and what it takes to trust the output.

The result: teams ship faster, at higher quality, without scaling engineering headcount.

### Messaging Pillars

| Pillar        | Slug            | Key Message                                                         | Top 2 Proof Points                                                               | Reference          |
| ------------- | --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| Context       | `context`       | AI that builds on your real codebase, tech stack, and design system | Design system intelligence built in; Context Graph learns your team's reasoning  | messaging-house.md |
| Collaboration | `collaboration` | Every role on the product team builds and ships alongside AI agents | Devs, PMs, designers, QA contribute directly; Agents and humans work in parallel | messaging-house.md |
| Trust         | `trust`         | Review, approval, and guardrails built into every change            | Structured review and approval workflows; Engineers always have final say        | messaging-house.md |

### Pillar-Persona Quick Match

| Persona    | Lead Pillar            | Why                                             |
| ---------- | ---------------------- | ----------------------------------------------- |
| Eng Leader | Context or Trust       | Standards compliance, scaling without headcount |
| Developer  | Context                | Code follows their patterns already             |
| Designer   | Collaboration          | Full control over what ships                    |
| PM         | Collaboration or Trust | Prototype-to-ship, validated output             |
| DS Lead    | Trust or Context       | Automatic adherence, no policing                |

> **Note:** These 5 personas are the messaging house's internal role categories. For full buyer persona profiles (recognition signals, discovery questions, objection handling), see the `builder-persona-knowledge` skill (`.builder/skills/builder-persona-knowledge/SKILL.md`).

## Pillar Selection Process

How to pick which pillar(s) to lead with for a given deliverable.

**Path 1 -- Explicit:** Campaign brief, plan metadata, or `_progress.yaml` specifies `messaging_pillars: [context, collaboration, trust]` -- use them directly.

**Path 2 -- Inferred:** No pillar specified. Use one of these heuristics (in order):

- **Persona-driven:** If `target_personas` is set, cross-reference the Pillar-Persona Quick Match table. Use the persona's lead pillar.
- **Content-type-driven:** If no persona, apply defaults:

  | Content Type      | Pillar Guidance                                              |
  | ----------------- | ------------------------------------------------------------ |
  | Landing page      | All 3 pillars (Context -> Collaboration -> Trust)            |
  | Campaign brief    | All 3 pillars                                                |
  | Case study        | Lead with the pillar that best explains the customer outcome |
  | Email sequence    | 1 pillar per email; rotate across the sequence               |
  | Single email      | 1 pillar (match to the email's purpose)                      |
  | LinkedIn outreach | 1 proof point from 1 pillar                                  |
  | Call script       | Lead with 1 pillar; weave others if conversation allows      |
  | Social post       | 1 proof point from 1 pillar                                  |
  | Ad copy           | 1 pillar, 1 proof point                                      |

**Path 3 -- Ambiguous:** No clear signal -- ask the user:

> "Which messaging pillar should this content lead with?"
>
> 1. Context (AI that builds on your real codebase)
> 2. Collaboration (whole team builds alongside AI)
> 3. Trust (review, approval, guardrails)
> 4. All three (overview / positioning piece)

Persist the selection as `messaging_pillars: [slug]` in the deliverable's metadata or `_progress.yaml`.

## Reference File Loading Protocol

How many reference files to read based on the content's needs:

- **Pillar-specific content** (emails, social, outreach) -- Read SKILL.md + messaging-house.md
- **Narrative/transformation content** (pitch decks, keynotes, blog intros) -- Read SKILL.md + strategic-narrative.md
- **Full messaging context** (campaign briefs, landing pages, comprehensive reviews) -- Read SKILL.md + both reference files
- **Quick positioning check** (review pass, light mention) -- Read SKILL.md only

| Scenario                          | Files Loaded                      | Estimated Words |
| --------------------------------- | --------------------------------- | --------------- |
| Social post pillar alignment      | SKILL.md only                     | ~900            |
| Email with single-pillar emphasis | SKILL.md + messaging-house.md     | ~2,000          |
| Narrative blog post               | SKILL.md + strategic-narrative.md | ~1,900          |
| Campaign brief (full framework)   | SKILL.md + both references        | ~3,000          |

Default maximum: 2 reference files per deliverable.

## Market Context: AI Output Quality

The market is growing skeptical of AI-generated output. Buyers have seen demos that don't translate to production. They've tried tools that create more cleanup than they save. This skepticism is rising across every competitive category.

Builder's three pillars naturally address this concern:

- **Context** ensures quality at the input level. AI that knows your system produces better output.
- **Collaboration** ensures quality at the process level. Humans review, refine, and direct throughout.
- **Trust** ensures quality at the output level. Nothing ships without structured review and quality checks.

This is a market tailwind. The pillars do the work. In content and thought leadership, let the quality story emerge from what Builder does rather than positioning directly against the problem.

## Examples

### Example 1: Email targeting an Engineering Leader (Context pillar)

**Setup:** Single email, target_personas: [exec-buyer]
**Pillar selected:** Context (Pillar-Persona Quick Match -> Eng Leader -> Context or Trust)
**Files loaded:** SKILL.md + messaging-house.md

**Instead of:** "Builder.io helps your team ship faster with AI."

**Use:** "Builder.io connects to your existing codebase, design system, and tech stack. AI output follows your patterns from the start -- engineers focus on architecture and code review, not cleaning up AI slop."

**Why it works:** Leads with the Context pillar's key message, uses the "production-ready output from the start" proof point, and resonates with the Eng Leader's priority (standards compliance, engineers on high-value work).

### Example 2: Landing page using all 3 pillars

**Setup:** Landing page, messaging_pillars: [context, collaboration, trust]
**Files loaded:** SKILL.md + both references

**Structure:**

- **Hero:** Top-level message ("The agentic development platform where your team and AI agents build, review, and ship apps and sites with confidence.")
- **Section 1 -- Context:** "AI that builds on your real codebase." Proof points: design system intelligence, Context Graph. Customer evidence: Frete's 70% reduction in build time.
- **Section 2 -- Collaboration:** "Every role ships alongside AI agents." Proof points: direct contribution, parallel workflows. Customer evidence: Conservice UX Designer quote.
- **Section 3 -- Trust:** "Review, approval, and guardrails built in." Proof points: structured review workflows, engineers have final say. Customer evidence: EagleEye's 50% reduction in dev time.

### Example 3: Campaign brief using the strategic narrative

**Setup:** Campaign brief for competitive displacement, no pillars pre-selected
**Files loaded:** SKILL.md + both references
**Pillar selected via Path 2:** All 3 (campaign brief default)

**Key Messaging section of the brief:**

Use the From -> To transformation framing as the campaign arc:

- **From:** "Teams where engineering is the bottleneck, AI is a toy, and everyone waits in line."
- **To:** "Teams where every role ships directly, AI agents do the heavy lifting, and the workflow has the guardrails to trust what gets built."

Then map each channel deliverable to a lead pillar: email sequence rotates one pillar per email, landing page uses all three, LinkedIn outreach picks the pillar most relevant to the prospect's role.

## Guidelines

### Pillar Integrity

Do not invent proof points not in the messaging house. Only cite customer evidence from the reference files (Frete, Conservice, EagleEye).

### Persona Resonance Accuracy

When targeting a specific persona, the pillar emphasis must match the persona resonance table. Do not mix persona-pillar mappings.

### No Direct "AI Quality" Positioning

The market context is a tailwind, not a positioning message. Content must not position Builder.io by directly attacking AI output quality skepticism. Let pillars address it naturally.

### Category Definition Consistency

Always use "Agentic Development Platform" as the category. Never revert to "headless CMS," "visual editor," "AI code generator," or "AI IDE."

### Don't Mix Pillar Narratives

For single-pillar content (emails, social posts), lead with one pillar only. Do not blend proof points across pillars in a single argument.

### Messaging Don'ts

| Don't                                                               | Why                                                     | Do Instead                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Don't claim Builder.io "replaces developers"                        | Contradicts Collaboration pillar                        | "Engineers focus on architecture and code review" |
| Don't conflate the 3 pillars into a single undifferentiated message | Loses structural clarity                                | Lead with 1 pillar, connect to others             |
| Don't use competitor category labels to describe Builder            | "AI code generator" or "AI IDE" diminishes the category | "Agentic development platform"                    |
| Don't invent customer evidence                                      | Only attributed evidence from the messaging house       | Omit rather than fabricate                        |

### Compounding

Update reference files when:

- **Immediate:** CEO or Josh announces positioning shift, proof point retracted, customer evidence revoked, or major feature creates new proof point
- **Quarterly:** Win/loss analysis reveals pillar underperformance, new customer evidence available, competitive landscape shifts pillar framing, content performance data shows pillar-specific conversion differences
- **Annual (aligned with SKO):** Full messaging house review -- market context shift, category definition relevance, persona resonance recalibration

Track changes via `<!-- last_updated: YYYY-MM-DD -->` and `<!-- last_reviewed: YYYY-MM-DD -->` comments at the top of each reference file.

## Cross-References

For buyer persona profiles, recognition signals, and objection handling, see the `builder-persona-knowledge` skill (`.builder/skills/builder-persona-knowledge/SKILL.md`).
For competitive positioning, proof points, and sales guidance, see the `builder-competitor-knowledge` skill (`.builder/skills/builder-competitor-knowledge/SKILL.md`).
For product capabilities, topic mapping, and CTAs, see the `builder-product-knowledge` skill (`.builder/skills/builder-product-knowledge/SKILL.md`).
