---
name: builder-product-knowledge
description: "This skill should be used when creating any content that mentions or positions Builder.io. It provides the product's current capabilities, positioning angles by topic category, internal team positioning, and integration patterns ranked by authenticity. Applies to marketing deliverables, sales materials, landing pages, emails, case studies, and any external-facing content."
---

# Builder.io Product Knowledge

Position Builder.io accurately and naturally in any content. This skill is the single source of truth for what Builder.io is, which capability to highlight for a given topic, and how to integrate the mention without sounding like a sales pitch.

For Builder.io's messaging framework (pillars, narrative, persona resonance), see the `builder-messaging` skill (`.builder/skills/builder-messaging/SKILL.md`).

This is a **living document**. Builder.io evolves fast. When the product ships new features or positioning shifts, update the reference files to keep this skill current.

## When to Use This Skill

Use this skill when creating any content that mentions or positions Builder.io:

- **Marketing deliverables**: Landing pages, email campaigns, social posts, event briefs, ad copy
- **Sales materials**: Case studies, battle cards, outreach emails, demo scripts
- **External communications**: Press releases, partner materials, analyst briefings
- **Product pages**: Feature pages, comparison pages, pricing page copy

Skip this skill for purely internal documents (meeting notes, internal memos) that don't mention Builder.io externally.

**Blog content pipelines:** Loading is controlled by content_goal routing in pipeline orchestrator skills.
Load this skill for acquisition or hybrid content_goal. Do not load for awareness content.
See blog-drafting skill for blog-specific integration pattern behavior.

## Branding Rules

These rules are non-negotiable. Every mention of Builder.io in any content must comply.

| Rule                | Correct                                                                           | Incorrect                                                    |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Product name        | **Builder.io** or **Builder**                                                     | "Fusion" (internal codename -- never use externally)         |
| Product category    | Agentic Development Platform                                                      | "headless CMS", "visual editor", "CMS"                       |
| What the product is | Collaborative workspace where your whole team builds real products with AI agents | "a coding assistant", "an IDE", "a CMS"                      |
| What it produces    | Production code shipped via PRs                                                   | "prototypes", "mockups"                                      |
| Design-to-code      | Builder.io (the platform does this natively)                                      | "Visual Copilot" (legacy name, now absorbed into Builder.io) |

**Builder.io IS:**

- An Agentic Development Platform with a collaborative development workspace
- A system where devs run 20+ agents in parallel, each with its own remote container and full dev environment
- A platform where designers, PMs, QA, and devs all contribute directly -- not just devs copy-pasting feedback to an AI
- A tool that connects to your existing stack (Slack, Jira, Figma, GitHub/GitLab/Azure DevOps/Bitbucket)

**Builder.io IS NOT:**

- A solo-developer coding assistant (it is team-oriented, cross-functional)
- A prototype generator (it generates production code shipped via PRs)
- A new IDE (it integrates with existing tools and workflows)
- A headless CMS (that was the legacy product called "Publish" -- do not upsell CMS capabilities)
- Just another AI code-gen tool (the differentiator is the collaborative workspace and massively parallel agents)

## Positioning Flow

1. Identify the content type and audience
2. See `builder-messaging` (`.builder/skills/builder-messaging/SKILL.md`) for the narrative framework and pillar emphasis
3. Identify the topic category from the Topic-to-Capability Mapping below
4. Select 1-2 relevant capabilities from [builder-capabilities.md](./references/builder-capabilities.md)
5. Match capability to a messaging pillar using the Pillar Selection Process in builder-messaging
6. Match to the right persona (see Internal Team Positioning below, or see `builder-persona-knowledge` (`.builder/skills/builder-persona-knowledge/SKILL.md`) for buyer profiles, or `builder-messaging` for pillar resonance)
7. Choose an integration pattern from Natural Integration Patterns below
8. Draft the Builder.io mention as a specific, topic-connected paragraph framed around the selected pillar

If the topic does not clearly map to any category, ask the user:

> "This topic doesn't have an obvious Builder.io connection. How would you like to position Builder.io here?
> (a) Suggest a capability to highlight
> (b) Use a light CTA only
> (c) Skip the product mention entirely"

## Topic-to-Capability Mapping

| Topic Category                      | Primary Capability                              | Positioning Angle                                                                                     |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| React/Next.js/Frameworks            | Visual development + design system intelligence | "Build in [framework] with AI agents that understand your components and design tokens"               |
| Design-to-Code / Figma              | Figma integration + design system intelligence  | "Copy-paste Figma designs into your codebase -- Builder maps them to your actual components"          |
| AI Development Tools                | Agentic platform (massively parallel agents)    | "Run 20+ agents in parallel, each in its own container with full dev environment and browser preview" |
| CI/CD / DevOps / PRs                | Git integration + auto-PR + review response     | "Assign tickets to the bot, it creates PRs, responds to reviews, and fixes build failures"            |
| Design Systems                      | Design system intelligence + component mapping  | "Indexes your components and enforces your design tokens -- AI uses your Button, not a generated one" |
| Team Collaboration / DX             | Collaborative workspace + full-team workflows   | "Designers, PMs, and QA contribute directly -- devs review and merge, not copy-paste feedback"        |
| Parallel Development / Productivity | Massively parallel agents + cloud containers    | "Each agent gets its own remote container -- no git worktree hacks, no maxed-out local machine"       |
| MCP / AI Integrations               | MCP server ecosystem                            | "Built-in MCP servers for Neon, Supabase, Linear, Stripe, Sentry -- connect agents to real data"      |
| Marketing / Demand Gen              | Collaborative workspace + speed to market       | "Go from idea to live landing page faster -- your whole team builds and iterates together"            |
| Sales Enablement                    | Collaborative workspace + enterprise features   | "Enterprise-grade permissions, role-based access, and compliance-friendly deployment"                 |

For topics that do not map to any category: use a light CTA connecting the topic to Builder.io's most relevant capability.

**Removed categories:** CMS / Content Management and Performance / Web Vitals are no longer positioning angles. Do not position Builder.io as a CMS or visual editor.

## Internal Team Positioning

One-liners for internal Builder.io staff to understand how to think about the product by role. These are internal positioning guides, not buyer personas.

For full buyer persona profiles including discovery questions, objection handling, and recognition signals, see the `builder-persona-knowledge` skill (`.builder/skills/builder-persona-knowledge/SKILL.md`). For pillar-specific persona resonance (how each messaging pillar lands with each persona), see the `builder-messaging` skill (`.builder/skills/builder-messaging/SKILL.md`).

### Marketing Personas

| Persona            | Core Value                                             | One-Liner                                                                                                                  |
| ------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Marketing Leader   | Faster campaign execution, less dependency on dev team | "Launch landing pages and campaign assets without waiting in the dev queue -- your team builds directly."                  |
| Content Marketer   | Consistent brand voice across all channels             | "Every piece of content aligns with brand guidelines and product positioning automatically."                               |
| Demand Gen Manager | Faster experimentation and iteration                   | "Test landing page variants, launch campaigns faster, and iterate based on results -- not dev sprints."                    |
| Product Marketer   | Accurate positioning and competitive differentiation   | "Position Builder.io's unique capabilities (parallel agents, collaborative workspace) against competitors with precision." |

### Sales Personas

| Persona           | Core Value                                 | One-Liner                                                                                                                         |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Sales Leader      | Clear differentiation in competitive deals | "Builder.io is the only platform where the whole team collaborates -- not just another AI coding tool."                           |
| Account Executive | Tailored value props per prospect persona  | "Match the prospect's role to the right capability: CTOs care about parallel agents, VPs of Design care about Figma integration." |
| Sales Engineer    | Technical depth for demos and POCs         | "Show 20+ agents running in parallel, Figma-to-code in real time, and Jira integration -- concrete, not slideware."               |

### Pillar-Persona Quick Match

Use this table to select the messaging pillar (Context, Collaboration, or Trust) that resonates most with the target persona. For the full messaging framework, see the `builder-messaging` skill.

| Persona              | Primary Pillar | Why                                                                    |
| -------------------- | -------------- | ---------------------------------------------------------------------- |
| Engineering Leader   | Collaboration  | Teams work in parallel, engineering focuses on high-value work         |
| Developer            | Context        | Code follows existing patterns and standards from the start            |
| Designer             | Trust          | What they approve is what ships -- full control over production output |
| PM                   | Collaboration  | Turn tickets into working features, validate directly                  |
| Design System Leader | Context        | Adherence happens by default, correct components used automatically    |
| Marketing Leader     | Collaboration  | Team builds directly without waiting in dev queue                      |
| Demand Gen Manager   | Collaboration  | Faster experimentation and iteration cycles                            |
| Sales Leader         | Trust          | Clear differentiation, the whole team collaborates                     |
| Account Executive    | Collaboration  | Tailored value props per prospect persona                              |
| Sales Engineer       | Context        | Technical depth with concrete, real demos                              |

## Natural Integration Patterns

Ranked from strongest (most authentic) to lightest. Choose the highest-ranked pattern that fits naturally.

### 1. Product Showcase (strongest)

The content naturally demonstrates Builder.io as the tool being used. Product mention is organic because Builder.io IS the subject.

**Use when:** Content directly involves Builder.io functionality. Landing pages, product pages, demo walkthroughs.

### 2. Before/After

Show the painful current workflow, then the workflow with Builder.io. The contrast makes the value proposition concrete.

**Use when:** Content involves team collaboration pain points, design handoff, productivity bottlenecks, or campaign velocity.

### 3. Honest Comparison

Acknowledge competitor strengths while showing Builder.io's specific differentiator (collaborative workspace, parallel agents). No strawmen.

**Use when:** Comparison pages, battle cards, or competitive positioning materials.

For detailed competitive intelligence including competitor profiles, proof points, switching stories, and sales guidance, see the `builder-competitor-knowledge` skill (`.builder/skills/builder-competitor-knowledge/SKILL.md`).

### 4. Problem-Solution

Lead with the audience's pain point, then show how Builder.io solves it specifically. Not generic -- the solution must connect to the problem discussed.

**Use when:** Marketing emails, case studies, outreach sequences, event presentations.

### 5. Social Proof

Let customer results speak. Reference specific metrics and outcomes.

**Use when:** Case studies, sales decks, landing page testimonial sections.

### 6. Light CTA Only (lightest)

One specific line connecting the content's topic to a Builder.io capability. Placed at the end or in a sidebar.

**Use when:** Content has only tangential Builder.io relevance. Default for educational or awareness content.

## CTA Templates by Content Type

Use the messaging pillars from `builder-messaging` to select which capability to lead with in the CTA.

### Marketing CTAs

| Content Type           | CTA Template                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Landing page (hero)    | "Build real products with your whole team. [Start free]"                                            |
| Landing page (feature) | "Builder.io lets your team [specific benefit from section]. [See how it works]"                     |
| Email (campaign)       | "See how [Company] [achieved specific result] with Builder.io. [Read the case study]"               |
| Social post            | "[Specific stat or result]. That's what happens when your whole team builds together. [link]"       |
| Event brief            | "Live demo: Watch 20+ agents build a feature in parallel while the team collaborates in real time." |

### Sales CTAs

| Content Type   | CTA Template                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Case study     | "[Company] achieved [metric] by switching to Builder.io. [See their story]"                              |
| Battle card    | "Unlike [competitor], Builder.io gives the WHOLE team a collaborative workspace -- not just developers." |
| Outreach email | "Your team at [Company] could [specific benefit]. Here's a 2-minute demo showing how. [link]"            |
| Demo follow-up | "Here's the [specific feature] we discussed. Try it yourself: [link]"                                    |

### General CTAs (topic-connected)

| Topic Type           | CTA Template                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework / frontend | "Builder.io lets your whole team build in [Framework] -- devs run parallel agents while designers and PMs contribute directly. [Try Builder.io]"              |
| Design-to-code       | "Stop translating Figma mockups by hand. Builder.io maps your Figma designs to your actual codebase components and ships production code. [See it in action]" |
| AI tools / agents    | "Builder.io runs 20+ agents in parallel, each in its own cloud container with browser preview. No git worktree hacks, no maxed-out laptop. [Watch the demo]"  |
| Team workflow        | "Builder.io gives your whole team a collaborative workspace -- designers propose changes, PMs verify, devs review and merge. [Start free]"                    |

## Guidelines

- NEVER use generic CTAs like "Try Builder.io" or "Check out Builder.io" without specificity
- The CTA must reference something discussed in the content
- Product mentions in educational content must not exceed 20% (80/20 rule)
- If the connection feels forced, downgrade to Light CTA Only
- When in doubt about positioning, ask the user rather than guessing
- NEVER refer to "Visual Copilot" -- that capability is now just part of Builder.io
- NEVER refer to "Fusion" -- that is an internal codename only
- NEVER position Builder.io as a CMS or visual editor -- that is legacy positioning

## Compounding

This skill's reference files are living documents. Update them when:

1. Builder.io ships a new feature -- update [builder-capabilities.md](./references/builder-capabilities.md)
2. A new topic category emerges -- add a row to the Topic-to-Capability Mapping
3. A new CTA template is needed for a content type -- add it to CTA Templates
4. A positioning angle works well in published content -- append it to [topic-positioning-playbook.md](./references/topic-positioning-playbook.md)
5. CEO positioning doc changes -- update Internal Team Positioning, and coordinate with `builder-messaging` skill for narrative updates

When `/content-compound` identifies a positioning gap, it will suggest updating this skill.

## Examples

### Example 1: Marketing landing page for parallel agents

**Content type:** Landing page hero section
**Capability selected:** Massively parallel agents + cloud containers
**Persona:** Engineering Leader
**Integration pattern:** Product Showcase

> Your engineers spend half their time waiting on one agent to finish before starting the next. Builder.io flips this -- spin up 20+ agents in parallel, each in its own cloud container with browser preview and full dev environment. Your team reviews PRs as they land, not after each sequential prompt. Meanwhile, QA and design validate directly in the branch.

### Example 2: Sales case study

**Content type:** Case study
**Capability selected:** Collaborative workspace + full-team workflows
**Persona:** PM
**Integration pattern:** Social Proof

> Everlane's product team cut launch times by 4x after switching to Builder.io. Their designers propose changes directly in the branch, PMs verify the UI in real-time previews, and developers focus on architecture instead of manual QA. "We went from three-week cycles to shipping in days," says their VP of Engineering.

### Example 3: Marketing email for demand gen campaign

**Content type:** Email sequence (nurture)
**Capability selected:** Figma integration + design system intelligence
**Persona:** Designer
**Integration pattern:** Problem-Solution

> Subject: Your Figma designs deserve better than a 45-minute manual translation.
>
> You designed it once. Why rebuild it in code? Builder.io maps your Figma components to your codebase components -- your actual Button with your design tokens, not a generated look-alike. The output goes directly to a PR. What you designed is what ships to production.

### Example 4: Competitive battle card

**Content type:** Sales battle card (vs. Cursor)
**Capability selected:** Collaborative workspace + parallel agents
**Persona:** Account Executive
**Integration pattern:** Honest Comparison

> Cursor is a powerful solo-developer coding assistant. Builder.io is a collaborative workspace for the whole team. When the prospect's pain point is "my developer is slow," Cursor fits. When the pain point is "my team can't ship fast enough," Builder.io wins -- because the bottleneck isn't one developer's speed, it's the feedback loop between dev, design, PM, and QA.

See [builder-capabilities.md](./references/builder-capabilities.md) for the full capability reference.
See [topic-positioning-playbook.md](./references/topic-positioning-playbook.md) for extended positioning examples.
