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

For a new app or a changed workflow, write or update `DESIGN.md` before
implementation. It is the single required design contract. Use the
`app-quality-bar` pattern index and decision log. For a small existing-surface
fix, read and apply the current contract.

Before a substantial new surface or redesign, decide who is using it, what
they came to do, and what they should see or do next. Pick a visual direction
that fits the product's brand and domain. For routine changes, inspect and
follow the existing components, type, color tokens, and spacing.

If a screen has two unrelated primary jobs, split the workflows or states.
Do not solve an unclear structure by adding more cards, tabs, controls, or
explanatory copy.

## Keep the starting view focused

Subtract before adding: remove redundant chrome, duplicate controls, and extra
layers first (10% rule — if you never have to add back ~10% of what you cut,
you aren't simplifying enough). The first view shows where the user is, current
state, and the next action; defer rare, diagnostic, destructive, or historical
controls to a menu or disclosure.

Every visible element must orient, show useful data/state, collect required
input, or enable the next action. Do not add a nav-repeating page title, a
subtitle or eyebrow under a title, a count strip over visible content, an About
section in settings, or helper copy that repeats a label unless asked. A card,
panel, tab, or settings group gets a title or a description, never both (put
explanations in tooltips or disclosures). Render user-authored descriptions
only when non-empty.

For sequential setup, show one decision at a time with clear progress and
sensible defaults. Use the smallest surface that fits the task: an inline row
or dialog for a small edit, a focused flow for multi-step work.

## Use the app's design system

Preserve the existing brand and theme. Prefer semantic color tokens and the
app's type system over raw palette colors or a newly invented visual system.
Choose an accent and type treatment for a reason; avoid generic gradients,
glass effects, decorative blobs, and hero sections without a product purpose.

Use the app's local UI adapter for standard controls. In an Agent-Native app,
check the configured design system and toolkit provider before changing how
shared controls look. Read `shadcn-ui` when implementing or composing a
standard control; keep product-specific layout and visual decisions here.

Hold every new or customized surface to the host app's native UX bar: reuse its
sheets, menus, composers, focus states, and motion rather than raw styled
elements or hardcoded colors; ship zero duplicate or unwired controls; blend
adjacent surface edges seamlessly; and respect native scroll/swipe gesture
ownership. Use imagery only when it clarifies the subject, never as filler.

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

Visually inspect rendered screenshots across light/dark, default, loading,
empty, error, populated, and narrow/mobile states before shipping. Confirm
every visible control is wired and non-duplicated, the next action is obvious,
and anything competing with the task is removed.
