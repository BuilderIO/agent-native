---
name: frontend-design
description: >-
  Product-specific interface design for an Agent-Native app. Use when creating
  or changing any user-facing UI, including screenshot feedback, copy or
  density cleanup, settings, controls, or a visual redesign.
scope: both
---

# Frontend Design

Design around the user's task and the app's existing visual language. A
distinctive interface comes from a clear product point of view, not extra
decoration. Keep implementation accessible and responsive.

## Choose a direction

Before a substantial new surface or redesign, decide who is using it, what
they came to do, and what they should see or do next. Pick a visual direction
that fits the product's brand and domain. For routine changes, inspect and
follow the existing components, type, color tokens, and spacing.

If a screen has two unrelated primary jobs, split the workflows or states.
Do not solve an unclear structure by adding more cards, tabs, controls, or
explanatory copy.

## Keep the starting view focused

The first view should show where the user is, the current work or state, and
the input or decision needed now. Make one action clear. Defer rare, advanced,
diagnostic, destructive, and historical controls to a relevant menu or
disclosure.

Every visible element should orient the user, show useful content or state,
collect required input, or enable the next action. If it has no job, remove it
or disclose it. Density should come from useful data, not extra chrome.

Do not add a page title that repeats the selected navigation item, a subtitle
or eyebrow under a title, a count strip over visible content, an About section
in settings, or helper copy that repeats a label unless the user asks for it.
A card, panel, tab, or settings group gets a title or a description, not both.
Use tooltips or progressive disclosure for explanations that are not needed to
make the current decision. User-authored descriptions are content: render them
when present and render nothing when empty.

For sequential setup, show one decision at a time with clear progress and
sensible defaults. Use the smallest surface that fits the task: an inline row
or dialog for a small edit, a focused flow for multi-step work.

## Use the app's design system

This starter ships **no brand system** — the neutral, 0%-saturation tokens in
`app/global.css` are a placeholder, not a design to preserve. Every app must
look impressive on first load even when the build prompt gives no design
direction: commit to one deliberate visual world, set a product-fitting accent
family in the light and dark tokens, and establish a clear type hierarchy,
spacing rhythm, and one signature detail. Do not ship the gray placeholder and
do not average toward generic SaaS. If an app already has a real brand, preserve
it. Keep shared behavior and semantic token names consistent; palette, density,
composition, type contrast, and shape language are yours to define. Prefer
semantic color tokens over raw palette colors, and avoid generic gradients,
glass effects, decorative blobs, and hero sections without a product purpose.

Use the app's local UI adapter for standard controls. In an Agent-Native app,
check the configured design system and toolkit provider before changing how
shared controls look. Read `shadcn-ui` when implementing or composing a
standard control; keep product-specific layout and visual decisions here.

Use real or generated imagery when it helps the user understand the subject.
Do not add decorative assets solely to fill empty space.

## Coordinate the UI with the agent

Keep repeatable, direct manipulation in the domain UI and use the agent for
work that benefits from judgment, exploration, or conversation. If the app has
a contextual agent sidebar, reuse it for in-context help and keep the user on
the current work surface. Do not add a second freeform prompt box. A control
that promises agent help should hand off the relevant context; label local,
deterministic behavior plainly.

## Interaction Responsiveness

Show feedback as soon as the user acts, aiming for 100 ms. When work cannot
finish immediately, acknowledge it before a network round-trip and show a
focused pending state within 400 ms. Use optimistic updates when safe, then
confirm or roll back on failure. Keep long work visibly progressing and offer
a way to stop when the operation supports cancellation.

## Make interactions clear and accessible

Support keyboard use, visible focus, accessible names, readable contrast, and
clear validation and recovery. Dialog and menu controls should use the app's
existing accessible primitives rather than hand-built click-outside behavior.
Never use browser `alert`, `confirm`, or `prompt` dialogs.

Use motion to clarify a state change. Prefer short transitions on opacity or
transform, respect reduced-motion preferences, and avoid delaying content with
decorative entrances or long animations.

Fit the content to narrow screens as well as desktop. Text and controls should
not overflow their containers; fixed-format editors, boards, and toolbars
should keep stable dimensions.

## Review the result

Check that the main job and next action are obvious. Look at the default,
loading, empty, error, and success states that apply, and check a narrow
viewport. Remove anything that competes with the task without helping the user
act or understand state.
