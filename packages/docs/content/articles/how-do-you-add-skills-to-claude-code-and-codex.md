---
slug: how-do-you-add-skills-to-claude-code-and-codex
topic: coding-agents
apps: [plans]
use_case: see-what-your-coding-agent-plans
job_id: job-agent-plan-review
title: "How do you add skills to Claude Code and Codex?"
meta_description: "A skill is a Markdown file that teaches your coding agent a workflow. How skills work in Agent-Native, how to install them, and how to write your own."
audience: technical
published: 2026-10-15
author: "Agent-Native Team"
app_cta_url: "https://plan.agent-native.com"
cta_label: "Plan visually"
screenshot_alt: "A visual plan in Plans: a canvas of three mobile screens above a written plan with a goal and a comment indicator"
cta_band_heading: "Add the planning skills"
cta_band_subhead: "One command gives your coding agent visual plans and recaps."
related_resources:
  - label: "Skills"
    url: "https://www.agent-native.com/docs/skills-guide/"
  - label: "Visual Plans"
    url: "https://www.agent-native.com/docs/template-plan/"
  - label: "PR Visual Recap"
    url: "https://www.agent-native.com/docs/pr-visual-recap/"
related: []
internal:
  target_terms: "best claude code skills (US 300/mo, KD 6); claude code skills (10,000, KD 66); claude skills (21,000, KD 67)"
  basis: "Search Console: 'visual plan skill', 'visual-pr skill', 'visual recap skill', 'agent native skills'"
  sources: "/docs/skills-guide/, /docs/template-plan/, /docs/pr-visual-recap/"
---

A skill is a Markdown file that gives your agent deep knowledge of a specific workflow. In Agent-Native, each skill lives at `.agents/skills/<name>/SKILL.md` and loads only when a task needs it, so the agent's default context stays small. You can install ready-made skills with one command, or write your own.

## How do you install a skill?

| What you want | How |
| --- | --- |
| An Agent-Native app-backed skill, like visual-plan or assets | `npx @agent-native/core@latest skills add <name>` |
| Instructions only, through the open Skills CLI | `npx skills@latest add BuilderIO/agent-native --skill assets`. This doesn't register MCP connectors. |
| A plugin for your coding agent | Agent-Native has a Claude Code marketplace plugin and a Codex plugin. |
| A portable bundle | `npx @agent-native/core@latest plugin import` |

## Which skills can you add?

The app-backed skills are visual-plan, visual-recap, visualize-repo, visual-edit, assets, and content. The Plans skills are a good place to start:

- `/visual-plan` builds a plan before your agent writes code, with diagrams, wireframes, mockups, and clickable prototypes when the work calls for them.
- `/visual-recap` turns an existing pull request, commit, branch, or diff into a visual review.
- `/visualize-repo` explores the codebase.

Install them with:

```
npx @agent-native/core@latest skills add visual-plan
```

This also registers the hosted Plans connector at `https://plan.agent-native.com/mcp`. Then ask your agent to use a skill, for example: "Use /visual-plan before changing the auth flow."

<!-- screenshot -->

<!-- try-it -->

## How do you write your own skill?

Create a folder and a file at `.agents/skills/<name>/SKILL.md`, and write the workflow in Markdown. A few things to know:

- Claude Code reads skills from `.claude/skills/`, separately from `.agents/skills/`. Agent-Native's update command repairs the links between them, so both see the same instructions.
- Add `scope: dev` to a skill to hide it from the in-app agent while keeping it available to your coding agent.
- Knowledge about one particular person belongs in `memory/MEMORY.md`, not in a skill.

## What should you check before you rely on a skill?

Running `/visual-plan` or `/visual-recap` starts an agent session against your coding agent's model, so cost grows with the size of the plan or diff and the model you choose. A recap supports your review but never replaces reading the actual diff.

## Frequently asked questions

### What is a skill?

A Markdown file that gives your agent deep knowledge of a specific workflow. It loads only when a task needs it.

### Where do skills live?

In Agent-Native, at `.agents/skills/<name>/SKILL.md`. Claude Code reads skills from `.claude/skills/`, and Agent-Native's update command repairs the links so both see the same instructions.

### How do I install the Plans skills?

Run `npx @agent-native/core@latest skills add visual-plan`. It also registers the hosted Plans connector.

### Do Agent-Native skills work in Claude Code and Codex?

Yes. Agent-Native has a Claude Code marketplace plugin and a Codex plugin.

### Does running a skill cost anything?

Plans and recaps run against your coding agent's model, so the cost follows that model's usage and grows with the size of the plan or diff.
