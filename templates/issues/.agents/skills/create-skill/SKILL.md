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
