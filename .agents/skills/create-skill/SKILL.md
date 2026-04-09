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

- There's a pattern the agent should follow repeatedly
- A workflow needs step-by-step guidance
- You want to scaffold files from a template

Don't create a skill when:

- The guidance already exists in another skill (extend it instead)
- You're documenting something the agent already knows (e.g., how to write TypeScript)
- The guidance is a one-off — put it in `AGENTS.md` or `learnings.md` instead

## 5-Question Interview

Before writing the skill, answer these:

1. **What should this skill enable?** — The core purpose in one sentence.
2. **Which agent-native rule does it serve?** — Rule 1 (data in SQL), Rule 2 (delegate to agent), Rule 3 (scripts), Rule 4 (polling sync), Rule 5 (self-modify), Rule 6 (app-state in SQL), or "utility."
3. **When should it trigger?** — Describe the situations in natural language. Be slightly pushy — over-triggering is better than under-triggering.
4. **Does it involve context awareness?** — Does the agent need to know what the user is looking at to use this skill? If yes, the skill should reference the `navigation` app-state key and the `view-screen` script pattern. See the **context-awareness** skill.
5. **What type of skill?** — Pattern, Workflow, or Generator (see templates below).
6. **Does it need supporting files?** — References (read-only context) or none. Keep it minimal.

## Skill Types and Templates

### Pattern (architectural rule)

For documenting how things should be done:

```markdown
---
name: my-pattern
description: >-
  [Under 40 words. When should this trigger?]
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
  [Under 40 words. When should this trigger?]
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
  [Under 40 words. When should this trigger?]
---

# [Generator Name]

## Usage

[How to invoke — what args/inputs are needed]

## What Gets Created

[List of files and their purpose]

## Template

[The template content with placeholders]

## After Generation

[What to do next — wire up SSE, add routes, etc.]

## Related Skills
```

## Naming Conventions

- Hyphen-case only: `[a-z0-9-]`, max 64 characters
- Pattern skills: descriptive names (`storing-data`, `delegate-to-agent`)
- Workflow/generator skills: verb-noun (`create-script`, `capture-learnings`)

## Tips

- **Keep descriptions under 40 words** — They're loaded into context on every conversation.
- **Keep SKILL.md under 500 lines** — Move detailed content to `references/` files.
- **Use standard markdown headings** — No XML tags or custom formats.

## Anti-Patterns

- **Inline LLM calls** — Skills must not call LLMs directly (violates Rule 2)
- **Database patterns** — Skills must not introduce databases (violates Rule 1)
- **Ignoring db sync** — If a skill creates data, mention wiring up `useDbSync`
- **Vague descriptions** — "Helps with development" won't trigger. Be specific about _when_.
- **Pure documentation** — Skills should guide action, not just explain concepts

## File Structure

```
.agents/skills/my-skill/
├── SKILL.md              # Main skill (required)
└── references/           # Optional supporting context
    └── detailed-guide.md
```

## Related Skills

- **capture-learnings** — When a learning graduates to reusable guidance, create a skill
- **self-modifying-code** — The agent can create new skills (Tier 2 modification)
