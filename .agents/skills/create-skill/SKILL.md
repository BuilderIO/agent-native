---
name: create-skill
description: >-
  How to create new skills for an agent-native app. Use when adding a new
  skill, documenting a pattern the agent should follow, or creating reusable
  guidance for the agent.
---

# Create a Skill

## When to Use

Create a new skill when:

- There's a pattern the agent should follow repeatedly.
- A multi-step workflow needs reliable, step-by-step guidance.
- You want to scaffold files from a template.

Don't create a skill when:

- The guidance already exists in another skill — extend it instead.
- You're documenting something the agent already knows (e.g., how to write
  TypeScript).
- It's a one-off — put it in `AGENTS.md` (for everyone) or `memory/MEMORY.md`
  (personal, per-user). See **capture-learnings**.

## Interview

Before writing the skill, answer these:

1. **What should this skill enable?** — The core purpose in one sentence.
2. **Which of the four areas does it serve?** — UI, actions, skills/instructions,
   or application state (see the **adding-a-feature** skill). Most skills are
   about how to touch one or more of these correctly.
3. **When should it trigger?** — Describe the situations in natural language.
   Be slightly pushy — over-triggering is better than under-triggering.
4. **Does it involve context awareness?** — Does the agent need to know what the
   user is looking at? If so, reference the `navigation` application-state key and
   the `view-screen` action pattern. See the **context-awareness** skill.
5. **What type of skill?** — Pattern, Workflow, or Generator (see below).
6. **Does it need supporting files?** — References (read-only context) or none.
   Keep it minimal; push depth into `references/`.

## Skill Types and Templates

### Pattern (architectural rule)

For documenting how things should be done:

```markdown
---
name: my-pattern
description: >-
  [Under 40 words. What it covers AND when it should trigger.]
---

# [Pattern Name]

## Rule

[One sentence: what must be true]

## Why

[Why this rule exists]

## How

[How to follow it, with code examples]

## Don't

[Common violations]

## Related Skills

[Which skills compose with this one]
```

### Workflow (step-by-step)

For multi-step implementation tasks:

```markdown
---
name: my-workflow
description: >-
  [Under 40 words. What it covers AND when it should trigger.]
---

# [Workflow Name]

## Prerequisites

[What must be in place first]

## Steps

[Numbered steps with code examples]

## Verification

[How to confirm it worked]

## Troubleshooting

[Common issues and fixes]

## Related Skills
```

### Generator (scaffolding)

For creating files from templates:

```markdown
---
name: my-generator
description: >-
  [Under 40 words. What it covers AND when it should trigger.]
---

# [Generator Name]

## Usage

[How to invoke — what args/inputs are needed]

## What Gets Created

[List of files and their purpose]

## Template

[The template content with placeholders]

## After Generation

[What to do next — wire up sync, add routes, register the action, etc.]

## Related Skills
```

## Naming Conventions

- Hyphen-case only: `[a-z0-9-]`, max 64 characters.
- Pattern skills: descriptive names (`storing-data`, `delegate-to-agent`).
- Workflow/generator skills: verb-noun (`create-skill`, `capture-learnings`).
- The directory name must match the `name` in frontmatter.

## Tips

- **Keep descriptions under 40 words** — they load into context on every
  conversation. State what the skill does AND when to trigger it.
- **Keep SKILL.md lean (under ~500 lines)** — move detailed content to
  `references/` files (progressive disclosure).
- **Use standard markdown headings** — no XML tags or custom formats.

## Anti-Patterns

- **Inline LLM calls** — skills must not call LLMs directly. All AI work goes
  through the agent chat (see **delegate-to-agent**).
- **Introducing databases** — data lives in SQL via Drizzle (see **storing-data**).
- **Ignoring sync** — if a skill creates data, mention wiring `useDbSync` /
  `useActionQuery` so the UI updates (see **real-time-sync**).
- **Vague descriptions** — "Helps with development" won't trigger. Be specific
  about _when_.
- **Pure documentation** — skills should guide action, not just explain concepts.

## File Structure

```
.agents/skills/my-skill/
├── SKILL.md              # Main skill (required)
└── references/           # Optional supporting context
    └── detailed-guide.md
```

## Related Skills

- **adding-a-feature** — The four-area model every skill ultimately serves.
- **writing-agent-instructions** — How to write AGENTS.md and skills well for
  apps and templates you ship to others.
- **capture-learnings** — When a learning graduates to reusable guidance, create
  a skill; one-offs go to `AGENTS.md` or `memory/MEMORY.md`.
- **self-modifying-code** — The agent can create new skills (Tier 2 modification).
