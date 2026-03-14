---
name: builder-persona-knowledge
description: >
  Provides Builder.io's 5 buyer personas with recognition signals, discovery questions,
  objection handling, and "Don't Say" guardrails. Use when producing targeted content
  (campaigns, outreach, calls, ABM materials). Skip for generic/educational content.
---

# Builder.io Persona Knowledge

Builder.io's 5 buyer personas from the PMM team. Use these profiles to match tone, discovery questions, objection handling, and messaging guardrails to the specific buyer you're addressing.

## When to Use

Use this skill when producing **targeted content** for a specific buyer:

- Campaign briefs targeting named personas
- Email sequences and LinkedIn outreach
- Call scripts and demo prep
- ABM (Account-Based Marketing) materials
- Landing pages targeting a specific role

**When NOT to use:** Skip for generic/educational content (blog posts, docs, tutorials), SEO-focused content targeting broad audiences, social posts not targeting a specific persona, or internal documents that don't address a specific buyer.

## Persona Quick Reference

| Persona | Shorthand | Reference File | Common Titles | Top 2 Recognition Signals |
|---------|-----------|---------------|---------------|--------------------------|
| Engineering Leaders | `exec-buyer` | `engineering-leaders.md` | CTO, VP of Engineering, Director of Engineering | Asks about enterprise security/compliance; Mentions Board reporting or proving ROI |
| Champions | `champion` | `champions.md` | Senior/Staff/Principal Engineer, Frontend Lead, EM | Asks about code quality, linting, CI/CD; Skeptical, wants to see actual code output |
| Design Platform/Systems Lead | `design-lead` | `design-platform-leads.md` | Design Platform Lead, Design Systems Lead, UX Engineering Lead | Talks about scaling design or design-to-engineering gap; Mentions failed AI tool rollouts (Cursor, Figma Make) |
| Influencers | `influencer` | `influencers.md` | CPO, VP of Product/Design, Head of Product/Design | CEO/Board pressure to ship faster; Frames problems as cross-functional friction |
| Core Contributors | `core-contributor` | `core-contributors.md` | Senior PM, Senior UX Designer, Marketing Manager | Complains about waiting on engineering; Blocked by other teams, wants to self-serve |

## Persona Selection Process

How to identify which persona a deliverable targets:

**Path 1 -- Explicit:** Campaign brief, plan metadata, or `_progress.yaml` specifies `target_personas` → use them directly. Read the corresponding reference file(s).

**Path 2 -- Inferred:** No persona specified → check job titles, company context, and communication style against the Recognition Signals column above. Match to the closest persona.

**Path 3 -- Ambiguous:** Multiple personas match or no clear match → ask the user:

> "Who is the primary audience for this deliverable?"
> 1. Engineering Leaders (CTOs, VPs of Engineering)
> 2. Champions (Senior/Staff Engineers, Frontend Leads)
> 3. Design Platform/Systems Lead (Design Systems, UX Engineering)
> 4. Influencers (CPOs, VPs of Product/Design)
> 5. Core Contributors (PMs, Designers, Marketing Managers)

Persist the selection as `target_personas: [shorthand]` in the deliverable's metadata or `_progress.yaml`.

## Reference File Loading Protocol

How many reference files to read based on persona count:

- **1 persona identified** → Read that 1 reference file
- **2 personas identified** (e.g., ABM multi-threading) → Read both reference files
- **3+ personas or "all"** → Read ONLY this Quick Reference table, not individual files. Summarize from the table.
- **Default maximum: 2 reference files per deliverable.** If more are needed, the deliverable should be split.

| Scenario | Files Loaded | Estimated Words |
|----------|-------------|-----------------|
| Single-persona email sequence | SKILL.md + 1 reference | ~850 |
| Two-persona ABM campaign brief | SKILL.md + 2 references | ~1,650 |
| Generic review (persona check only) | SKILL.md only | ~250 |

## Guidelines

### "Don't Say" Enforcement

When generating content for a specific persona:

1. Read that persona's "Don't Say" list from the reference file
2. Inject the "Don't Say" items as hard constraints BEFORE generating content
3. After generation, scan the output against the "Don't Say" list
4. Flag any violations as **CRITICAL** severity

### Voice Mixing

Don't mix persona voices in a single 1:1 customer-facing deliverable (email, LinkedIn DM, call script). Campaign briefs and landing pages MAY address multiple personas in distinct sections.

### Don't Fabricate

Never invent persona details not present in the reference files. If a reference file doesn't cover a specific scenario, say so explicitly rather than guessing.

### Personas Are Starting Points

Real prospects blend personas. Note the primary persona and acknowledge secondary signals. Example: "Primary: Champion (asks about CI/CD integration). Secondary: Design Lead signals (mentions design system concerns)."

### Compounding

Update reference files when PMM shares updated persona documentation, campaign learnings reveal new signals, or sales feedback identifies gaps. Track changes via the `<!-- last_updated -->` comment at the top of each reference file.

For Builder.io's messaging pillars and how each pillar resonates per persona, see the `builder-messaging` skill (`.builder/skills/builder-messaging/SKILL.md`).
For full Builder.io product capabilities and positioning, see the `builder-product-knowledge` skill (`.builder/skills/builder-product-knowledge/SKILL.md`).
