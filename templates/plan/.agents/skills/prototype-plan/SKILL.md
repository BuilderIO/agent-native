---
name: prototype-plan
description: >-
  Use Agent-Native Plans for /prototype-plan when work needs a functional
  prototype-first plan, static mocks, comments, review toggles, or conversion
  from a visual plan.
metadata:
  visibility: exported
---

# Prototype Plan

`/prototype-plan` creates a plan whose primary review surface is a live,
functional prototype above the document. Use it when the user needs to feel a
flow, operate basic UI state, or comment on interaction before implementation
hardens the decision.

## Rule

Make the prototype answer a concrete question. The plan should say what is being
tested, show the functional prototype first, then keep static mocks and implementation
notes in the document below.

## When To Use

Use `/prototype-plan` when the user asks for a prototype, wants to click through
and operate UI states, needs design review before code, wants comments pinned to
live screens, or asks to move a visual plan into a prototype.

Prefer `/visual-plan` for architecture, data flow, or non-interactive planning.
Prefer `/ui-plan` when static screen review is enough. Use `/visual-plan` first
when the user hands you an existing Markdown/Codex/Claude plan that needs a
visual companion before becoming interactive.

## Core Workflow

1. Inspect the real codebase and decide the question the prototype should
   answer. Good examples: "Does this onboarding flow feel short enough?" or
   "Which dashboard density should we implement?"
2. Call `create-prototype-plan` with a title, brief, and screen HTML. Default to
   one functional prototype screen when local UI behavior is enough; use 2-4
   screens only for true routes, steps, or materially different contexts. The
   returned plan opens with the prototype viewer on top and static mocks, flow
   diagram, implementation map, and verification below.
3. Make controls actually work. Use the renderer's safe Alpine-like directives:
   `x-data`, `x-model`, `x-for`, `x-text`, `x-show`, `:class`, `@click`, and
   `@keydown.enter`. Use safe helper verbs such as `remove(list, item)`,
   `setAll(list, 'done', true)`, `removeWhere(list, 'done', true)`, and counters
   such as `count(list)`, `countWhere(list, 'done', true)`, and
   `remaining(list, 'done')` when they help. Use `data-goto="screen-id"` only
   for true screen/route changes, not for every button press.
4. Show important app feedback inside the prototype itself: selected filters,
   checked rows, typed drafts, validation messages, permissions, progress, or
   empty states.
5. Surface the returned Plans link and ask the user to click through, comment on
   the prototype or static mocks, and approve the direction before code changes.
6. Before implementing or revising, call `get-plan-feedback`. Treat prototype
   anchors, screenshots, and resolver intent as the source of truth.
7. Update with `update-visual-plan` content patches. Use
   `patch-prototype-html`, `update-prototype-screen`, or `set-prototype` for
   targeted prototype edits instead of regenerating the whole plan.

## Converting A Visual Plan

When a visual plan already has HTML canvas wireframes, call
`convert-visual-plan-to-prototype` with the plan id. This derives prototype
screens from the canvas frames, preserves the canvas/static mocks by default,
and changes the top review surface to the prototype viewer.

Use `removeCanvas: true` only when the user explicitly wants the old canvas
gone. Otherwise keep static mocks available for source export and detailed
review.

## Prototype Screen HTML

Write bounded semantic HTML fragments only:

```html
<div style="display:flex;flex-direction:column;gap:14px;padding:18px;height:100%">
  <header style="display:flex;justify-content:space-between;gap:12px">
    <div>
      <h1>Launch checklist</h1>
      <p class="wf-muted">Reviewer can add, complete, filter, and remove tasks.</p>
    </div>
    <span class="wf-pill accent">Live prototype</span>
  </header>
  <section
    class="wf-card"
    x-data="{ draft: '', filter: 'all', todos: [{ text: 'Check copy', done: false }, { text: 'Confirm owner', done: true }] }"
    style="display:flex;flex-direction:column;gap:10px"
  >
    <div style="display:flex;gap:8px">
      <input x-model="draft" @keydown.enter="draft && todos.push({ text: draft, done: false }); draft = ''" placeholder="Add task" />
      <button class="primary" @click="draft && todos.push({ text: draft, done: false }); draft = ''">Add</button>
    </div>
    <div style="display:flex;gap:8px">
      <button @click="filter = 'all'" :class="{ primary: filter === 'all' }">All</button>
      <button @click="filter = 'done'" :class="{ primary: filter === 'done' }">Done</button>
      <button @click="setAll(todos, 'done', true)">Mark all done</button>
    </div>
    <p class="wf-muted"><span x-text="remaining(todos, 'done')"></span> open / <span x-text="count(todos)"></span> total</p>
    <div
      class="wf-box"
      x-for="todo in todos"
      x-show="filter === 'all' || (filter === 'done' && todo.done)"
      :class="{ 'is-done': todo.done }"
      style="display:flex;justify-content:space-between;gap:10px"
    >
      <label style="display:flex;gap:8px"><input type="checkbox" x-model="todo.done" /><span x-text="todo.text"></span></label>
      <button @click="remove(todos, todo)">Remove</button>
    </div>
    <button @click="removeWhere(todos, 'done', true)">Clear completed</button>
  </section>
</div>
```

Use real labels, counts, dates, and controls grounded in the target app. Keep
surfaces honest: `browser` for web pages, `desktop` for app shells, `mobile`
only for real mobile work, `panel` for side panels, and `popover` for menus.

Do not include `<html>`, `<body>`, `<script>`, `<style>`, browser `on*`
handler attributes such as `onclick`, fake APIs, raw secrets, or customer data.
The renderer owns sketchy/clean mode, theme, surface sizing, rough outlines, and
comment overlays.

## Review Surface

Prototype plans support:

- real local controls through safe prototype directives
- optional screen/route transitions from `data-goto`
- rough vs clean mode through the shared wireframe toggle
- dark vs light mode through the shared theme toggle
- comment visibility from the prototype toolbar
- Figma-style comments pinned directly on live prototype screens
- a popout URL with `?prototype=1` for focused browser review
- static wireframe mocks in the document body where they help implementation

## Source Files

Runtime JSON is canonical. Source export uses:

- `plan.mdx` for document blocks
- `prototype.mdx` for `<Prototype>`, `<PrototypeScreen>`, and
  `<PrototypeTransition>`
- `canvas.mdx` for static mocks when a canvas is present
- `.plan-state.json` for persisted viewport state

Patch source with `patch-visual-plan-source` only when the user wants
source-control friendly edits. Patch runtime content when the user is simply
reviewing and iterating.

## Related Skills

- `visual-plan`
- `ui-plan`
- `visual-questions`
