---
name: responsive-breakpoints
description: >-
  Framer-style responsive breakpoint editing in Design: one DOM tree per
  screen with cascading width-scoped overrides. Use when adding/removing
  breakpoints, editing a design at a specific device width, resolving which
  value renders at a width, or persisting responsive style changes.
---

# Responsive Breakpoints

Design uses the **Framer model**: every screen is ONE document (one DOM
tree). Breakpoint frames are the SAME document rendered at different
viewport widths — never separate copies. Edits cascade:

- The **base** is the primary (widest) frame. Base edits are plain
  unprefixed classes / inline styles and cascade down to every narrower
  breakpoint unless overridden there.
- Edits made while a **narrower breakpoint is active** persist as
  width-scoped overrides that apply from just below the next-wider frame
  down to zero. Narrower breakpoints layer their own overrides on top.

The bound for an override is `next-wider frame width - 1` (e.g. breakpoints
390/810 with a 1280 primary: editing 810 scopes to `≤ 1279px`, editing 390
scopes to `≤ 809px`). `breakpointUpperBoundPx` in
`shared/responsive-classes.ts` is the canonical implementation.

## Managing breakpoints

- `add-breakpoint` — adds a device-width frame to `designs.data.breakpointSet`
  (Framer defaults: Desktop 1200 / Tablet 810 / Phone 390, or custom 320-3840).
  Duplicate widths are ignored.
- `remove-breakpoint` — removes one by id (overrides already written stay in
  the document until removed).
- `set-active-breakpoint` — persists the active edit scope to application
  state (`design-active-breakpoint:<designId>`); the UI mirrors it in the
  `design-selection` state (`activeBreakpointId`). Check the active
  breakpoint via `view-screen` before making responsive-only edits.

The UI's breakpoint bar (chips above the focused screen) and the overview's
side-by-side linked frames drive the same state — a chip click changes the
iframe viewport width AND calls `set-active-breakpoint`.

## Editing responsively (agent parity)

Use `apply-visual-edit` with `activeFrameWidthPx` set to the ACTIVE
breakpoint frame width. This scopes BOTH `class` and `style` intents
uniformly through one class-vs-media decision:

- Values that are Tailwind utilities (`text-lg`, `p-4`) become width-scoped
  classes: `max-[809px]:text-lg` (arbitrary max-width variants the Tailwind
  CDN JIT compiles to `@media (max-width: 809px)`).
- Raw CSS values (`137px`, `rgb(...)`, `calc(...)`) persist into the managed
  `<style data-agent-native-breakpoints>` block as
  `@media (max-width: <bound>px)` rules targeting the element's
  `data-agent-native-node-id`. The block is deterministic (wider buckets
  first so narrower ranges win by source order) and readable/editable in the
  Code panel.

Other targeting options:

- `maxWidthPx` — explicit desktop-down bound, overrides derivation.
- `intent.kind: "breakpoint-style"` — direct managed-media write/remove:
  `{ target, maxWidthPx, property, value, operation: "set" | "remove" }`.
- `activeBreakpoint: "md"` etc. — LEGACY min-width prefix scoping for class
  edits only (mobile-first `md:text-lg`). Still supported for documents
  authored mobile-first; prefer `activeFrameWidthPx` for breakpoint-bar
  parity.

When the design has no breakpoint set, `activeFrameWidthPx` falls back to
the legacy min-width prefix behaviour for class edits. When the active frame
IS the widest context, edits are base writes (correct — the widest frame is
the base).

## Resolving and inspecting overrides

- `effectiveUtilityAtWidth(className, stem, widthPx)` — which utility
  renders at a width (narrowest applicable max-width scope wins, then
  min-width prefixes, then base).
- `getBreakpointOverrideState({ className, html, nodeId, property,
  breakpointWidths, baseWidthPx, activeWidthPx })` from
  `shared/breakpoint-media.ts` — aggregates class + media overrides for the
  inspector's overridden-at-this-breakpoint indicators.
- To RESET an override: remove the scoped class
  (`responsive-class` remove with `maxWidthPx` + stem) or the media rule
  (`breakpoint-style` with `operation: "remove"`); the base value cascades
  back down.

## Cautions

- Managed media rules anchor on `data-agent-native-node-id`. Inline (SQL)
  designs keep these ids; localhost write-back strips them — for local-file
  sources prefer scoped classes.
- Never rewrite the managed block wholesale by hand; use the edit intents so
  same-property writes replace instead of accumulate. The parser tolerates
  Code-panel edits but unknown selectors are ignored.
- Adding a breakpoint between two existing widths changes the bound for NEW
  overrides only; previously written overrides keep their original bounds.
