# 005 — Content editor: fix resize lag, progress bar, and hover easing

- **Status**: DONE (4/5 steps; step 4 was already fixed by concurrent work)
- **Commit**: f43d34ca24
- **Severity**: HIGH (sidebar drag-resize fights its own transition)
- **Category**: Performance / Easing & duration / Physicality & origin
- **Estimated scope**: 4 files in `templates/content/app/`, ~8 edits

## Problem

```tsx
// templates/content/app/components/sidebar/DocumentSidebar.tsx:1112 — the sidebar keeps its
// width transition DURING live drag-resize, so the edge chases the cursor through a 200ms curve.
// isResizing exists (state ~line 222; used for handle color ~line 1363) but never suppresses
// the transition; onResize is driven by raw mousemove (~line 254).
"agent-layout-left-drawer relative flex h-full min-h-0 flex-col border-e border-border bg-sidebar transition-[width] duration-200 ease-out",

// templates/content/app/root.tsx:225 — route-pending bar animates width via transition-all
`h-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] transition-all duration-200 ${
  pending ? "w-2/3 opacity-100" : "w-0 opacity-0"
}`

// templates/content/app/global.css:1454-1468 — media-block toolbar: 300ms ease-in-out on a
// hover-revealed toolbar (budget for small popovers is 150-250ms, entrances want ease-out).
// Similar rules repeat at ~:1485-1501, ~:1560-1564, ~:1700-1702.
transition:
  opacity 300ms ease-in-out,
  transform 300ms ease-in-out,
  visibility 0s linear 300ms;

// templates/content/app/global.css:432 and :1014 — ease-in on hover color changes
transition: background-color 120ms ease-in, color 120ms ease-in;

// templates/content/app/components/editor/LinkHoverPreview.tsx:167 — anchored below the link
// (top: rect.bottom + 8) but zooms from center
className="w-72 rounded-lg border bg-popover text-popover-foreground shadow-md overflow-hidden animate-in fade-in-0 zoom-in-95"
```

## Target

1. **DocumentSidebar.tsx** — make the width transition conditional on not resizing. The component already has `isResizing` state; change the root className to:
   ```tsx
   cn(
     "agent-layout-left-drawer relative flex h-full min-h-0 flex-col border-e border-border bg-sidebar",
     !isResizing && "transition-[width] duration-200 ease-out",
     ...
   )
   ```
   (If `isResizing` is not in scope at that JSX site, thread it — it lives in the same component per line ~222.)
2. **root.tsx:225** — animate transform instead of width:
   ```tsx
   `h-full w-2/3 origin-left bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] transition-[transform,opacity] duration-200 ${
     pending ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
   }`;
   ```
3. **global.css media-block toolbar rules (1454-1468 and the repeats)** — change every `300ms ease-in-out` in these hover-reveal rules to `200ms ease-out`, and the matching `visibility 0s linear 300ms` delays to `visibility 0s linear 200ms` (keep `0s` on the visible state).
4. **global.css:432 and :1014** — `ease-in` → `ease` (hover color changes use `ease`; keep 120ms).
5. **LinkHoverPreview.tsx:167** — add `origin-top-left` to the className (the panel is anchored top-left below the link; the Radix var is unavailable since this is hand-positioned).

## Repo conventions to follow

- Tailwind v4; arbitrary values fine. Keep `agent-layout-left-drawer` class — core styles hook it.
- Hover color feedback elsewhere in this file uses `ease` (e.g. `0.12s ease` at ~:2054) — step 4 aligns with that.

## Boundaries

- Only the four files above. No markup restructuring; class/CSS value changes plus the one conditional in step 1.
- Do NOT touch the editor's ProseMirror/collab code.
- If a string has drifted, STOP on that step and report; continue the rest.

## Verification

- **Mechanical**: template typecheck passes; `oxfmt` on modified files; `rg "ease-in[^-o]" templates/content/app/global.css` shows no plain ease-in remaining in the touched rules.
- **Feel check**: drag the sidebar resize handle rapidly — the edge sticks to the cursor with zero lag; release and toggle collapse — the 200ms width animation still plays. Navigate between documents — the pending bar sweeps via scale (no layout jank in DevTools paint flashing). Hover an image block — toolbar appears snappier (200ms ease-out); at 10% animation speed it starts fast and decelerates.
- **Done when**: all 5 steps applied or reported as drifted.
