# 011 — Consolidate chat disclosure rows onto AnimatedCollapse

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Interruptibility
- **Estimated scope**: 4 files in `packages/core/src/client/`, structural but bounded
- **Depends on**: plan 002 (edits the same `tool-call-display.tsx`; run this AFTER 002 lands)

## Problem

The message stream has one correctly-animated disclosure primitive — `AnimatedCollapse` in `packages/core/src/client/chat/tool-call-display.tsx` (~line 455): rAF-measured height, `transition-[height] duration-200`, retargets mid-animation. But three sibling tool-output cells reimplement disclosure as bare conditionals that teleport open/closed in the same visual stream:

```tsx
// packages/core/src/client/tool-cells/FilesChangedSummary.tsx:177 (row button ~:149-199)
{isExpanded && part.type === "tool-call" && part.structuredMeta && (
  …detail rows…
)}

// packages/core/src/client/tool-cells/EditCell.tsx:282 — same bare-conditional pattern
// packages/core/src/client/tool-cells/WriteCell.tsx:124 — same bare-conditional pattern
```

Every coding turn renders these; a tool call's "Thinking" block eases open while the file-diff row directly below it snaps — visibly inconsistent.

## Target

1. Export `AnimatedCollapse` from `tool-call-display.tsx` if it isn't already exported (add `export` to the existing declaration; do not move it).
2. In each of the three cells, wrap the previously-conditional content:
   ```tsx
   <AnimatedCollapse open={isExpanded}>
     {part.type === "tool-call" && part.structuredMeta && (
       …existing detail rows, unchanged…
     )}
   </AnimatedCollapse>
   ```
   Match `AnimatedCollapse`'s actual prop names — read its signature first (it may take `open`/`expanded`/`children` plus an optional `onTransitionEnd`). Content must stay mounted-when-closed only if that is how the component works for the "Thinking" block; mirror the exact usage pattern already present at its call sites in `tool-call-display.tsx`.

## Repo conventions to follow

- Imitate the existing `AnimatedCollapse` call sites in `tool-call-display.tsx` verbatim (props, keying, wrapping div classes).
- Import path: relative within `packages/core/src/client/` matching how tool-cells already import from `../chat/…` (check an existing cross-import in the tool-cells directory first).

## Boundaries

- Do NOT modify `AnimatedCollapse` itself beyond adding `export`.
- Do NOT change what content renders — only when/how it appears.
- If a cell's conditional is structured differently than the excerpt (drift), STOP on that cell and report; do the others.

## Verification

- **Mechanical**: core typecheck passes; `oxfmt` on modified files.
- **Feel check**: in a template chat, run a coding task that edits files; expand/collapse a "Files changed" row, an Edit cell, and a Write cell — each eases open/closed over ~200ms exactly like the Thinking block above them; spam-toggling retargets smoothly instead of restarting.
- **Done when**: all three cells animate identically to the existing tool-call collapse.
