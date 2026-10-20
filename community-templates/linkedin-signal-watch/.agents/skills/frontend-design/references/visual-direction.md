# Visual Direction Reference

Use this reference when a new app or workspace needs a visual point of view and
does not already have an established brand system. It adapts the useful parts
of Impeccable's workflow: understand the product, name the surface mode, deal
several coherent directions, commit to one, and audit the result for defaults
that became the design by accident.

## The direction contract

Before writing UI, capture these decisions in the app's `DESIGN.md`:

| Decision             | What to record                                                      |
| -------------------- | ------------------------------------------------------------------- |
| Product mode         | `operate`, `read`, `persuade`, or `experience`                      |
| Audience and cadence | Who uses it, how often, and under what conditions                   |
| Visual world         | A short name and the feeling it creates                             |
| Palette family       | The semantic accent family and neutral undertone                    |
| Type treatment       | Sans-first, editorial contrast, or display-led emphasis             |
| Composition          | Dense console, focused workbench, document, canvas, or guided steps |
| Shape language       | Quiet corners, crisp geometry, or soft utility surfaces             |
| Anti-references      | Defaults this app must not drift toward                             |

`DESIGN.md` is a portable design contract, not a license to bypass the app's
tokens or component system. If the app already has a brand system, document it
and preserve it. If it does not, choose a direction before styling.

## Palette families

Use one family as an accent and keep the rest of the system semantic and quiet.
These are starting points, not a fixed theme library:

| Family           | Good fit                                    | Typical character                 |
| ---------------- | ------------------------------------------- | --------------------------------- |
| Ink / graphite   | Admin, security, sensitive review           | Serious, low-noise, high contrast |
| Cobalt / sky     | Planning, collaboration, scheduling         | Clear, trustworthy, alert         |
| Pine / teal      | Automation, systems, finance, data          | Calm, capable, grounded           |
| Indigo / violet  | Slides, creative tools, research            | Exploratory, focused, expressive  |
| Plum / berry     | Publishing, knowledge, editorial work       | Distinctive, thoughtful, human    |
| Coral / rose     | Communication, people, customer workflows   | Warm, direct, social              |
| Ochre / citron   | Lightweight planning or energetic utilities | Optimistic, sparing, directional  |
| Paper / charcoal | Long-form reading, exports, approvals       | Tactile, restrained, legible      |

Do not make warm beige plus terracotta the universal fallback. Do not rotate
through saturated colors mechanically. Choose the family that supports the
workflow, then verify contrast, dark mode, focus states, destructive states,
and the sidebar boundary.

## Variation without chaos

Vary at least two independent axes when sibling apps share a workspace:

- accent family or neutral undertone;
- information density and page composition;
- type contrast and display treatment;
- radius and border language;
- navigation emphasis and use of whitespace.

Keep shared behavior, semantic token names, accessibility, and AgentSidebar
placement consistent. The goal is a family of products, not five unrelated
themes and not five copies of the same starter.

For a batch of apps, keep a small direction ledger in the workspace
`DESIGN.md` or the handoff. Record each app's mode, direction, and palette
family, then choose a new family or a clearly different composition for the
next app unless an existing brand requires reuse. Never copy a sibling's
`global.css` palette block or treat the last app's accent as the generator
default.

## Review vocabulary

Make one named intervention at a time so the agent can reason about the
change:

- `distill` - remove copy, controls, cards, and chrome that do not serve the
  next decision;
- `typeset` - repair hierarchy, measure, line length, and emphasis;
- `colorize` - establish a restrained semantic palette and contrast states;
- `layout` - repair grouping, density, alignment, and responsive composition;
- `polish` - resolve the small visual inconsistencies after the structure is
  right;
- `audit` - check slop, accessibility, responsive behavior, and visual drift.

Do not average several directions into a generic compromise. Deal two or three
coherent options when the brief is open, select one, and encode the decision in
tokens and `DESIGN.md`.

## Anti-slop audit

Before handoff, inspect the first viewport and ask:

- Did the app inherit the neighboring app's palette or hero layout without a
  product reason?
- Are there equal-weight cards, status chips, helper paragraphs, or controls
  that should be removed or disclosed?
- Does the typography fit the product mode instead of decorating the shell?
- Is the AgentSidebar distinct but quiet, with the domain page still primary?
- Are focus, loading, empty, error, dark, and narrow-width states part of the
  same design direction?
