---
slug: what-goes-in-a-technical-design-document
use_case: see-what-your-coding-agent-plans
job_id: job-agent-plan-review
title: "What goes in a technical design document?"
meta_description: "A technical design document explains what you'll build and why before you build it. A copy-and-paste template, and how to review one with your coding agent."
category: plans
audience: technical
published: 2026-10-14
author: "Agent-Native Team"
app_cta_url: "https://plan.agent-native.com"
cta_label: "Plan visually"
screenshot_alt: "A visual plan in Plans: a canvas of three mobile screens above a written plan with a goal and a comment indicator"
cta_band_heading: "Review your next plan visually"
cta_band_subhead: "Ask your agent for a plan, then work through the details together."
related_resources:
  - label: "Agent-Native Plans"
    url: "https://www.agent-native.com/apps/plan/"
related: []
internal:
  target_terms: "technical design document (US 350/mo, KD 5); technical design document template (200, KD 1); technical design document example (90); architecture diagram examples (200)"
  verify: "Plans install command and supported clients against the Plans page."
---

A technical design document explains what you're going to build and why before you build it: the problem, the proposed approach, the alternatives you rejected, and the risks. For a small change, a paragraph is enough. For anything that touches several systems, write it down.

Writing it down is cheap. Finding out halfway through a build that two people pictured different designs is not.

## What goes in a technical design document?

| Section | What to write |
| --- | --- |
| Context and problem | What's broken or missing, and who it affects. |
| Goals and non-goals | What this change must do, and what it deliberately won't. |
| Proposed design | The approach, with a diagram of the data flow if more than one system is involved. |
| Alternatives considered | What else you looked at and why you didn't choose it. |
| Data model and interfaces | Tables, APIs, events, or files that change. |
| Risks and open questions | What could go wrong, and what you haven't decided. |
| Rollout and testing | How you'll ship it and how you'll know it works. |

## What's a technical design document template you can copy?

```
Title:
Author:
Status:

Context and problem:

Goals:
-

Non-goals:
-

Proposed design:

Alternatives considered:
- [Option]: [why not]

Data model and interfaces:

Risks and open questions:
-

Rollout and testing:
```

## How do you review one with your coding agent?

If your coding agent writes the plan, the review is the same: read the approach before it touches code. A plan in a terminal is hard to review, so use something you can see.

1. Add the Plans skills to your agent with the install command from the Plans page.
2. Ask your agent for a visual plan. You get diagrams, wireframes, and annotated code instead of a wall of text.
3. Comment on the text, or pin feedback to a specific spot in a visual.
4. Ask the agent to read the comments and revise the plan.

<!-- screenshot -->

<!-- try-it -->

## What should you check before you rely on it?

Comments on a plan support your review. They don't automatically stop the agent from changing code, so read the plan before you tell it to build. New hosted plans are private until you share them, and commenting requires an account. Plans is labeled alpha, so expect rough edges.

## Frequently asked questions

### How long should a technical design document be?

As short as it can be while still answering the questions a reviewer will ask. A page or two covers most changes.

### Do I need a design document if my coding agent writes the code?

For anything risky, yes. The plan is where you catch a wrong assumption before the agent changes code.

### Who should review a technical design document?

The people who own the systems it touches, and whoever will maintain the result.

### Can my coding agent write the document?

Yes. You can ask your agent for a plan. Review it as you would a colleague's: check the goals, the alternatives, and the risks.

### Is Plans free?

Yes. Plans is free and open source. It's labeled alpha, so expect rough edges.
