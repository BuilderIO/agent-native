# 004 — Clips player: scrubber physicality + scoped card transitions

- **Status**: DONE (meeting cards this batch; scrubber steps landed via concurrent session edits — target state verified)
- **Commit**: f43d34ca24
- **Severity**: HIGH (scale(0) on a constantly-hovered surface)
- **Category**: Physicality & origin / Performance
- **Estimated scope**: 2 files in `templates/clips/app/components/`, 4 class-string edits

## Problem

```tsx
// templates/clips/app/components/player/scrubber.tsx:250-251 — thumb appears from nothing
// (scale-0). Nothing in the real world appears from scale 0.
(dragging ? "scale-125" : "scale-0 group-hover/bar:scale-100",
  // templates/clips/app/components/player/scrubber.tsx:203 — timeline markers grow by animating
  // layout width/height via transition-all on a constantly-hovered scrubber
  (className = "... h-3 w-0.5 bg-white/80 hover:h-4 hover:w-1 transition-all"));

// templates/clips/app/components/meetings/meeting-card.tsx:98 and :231 — transition-all on
// list cards hovered constantly while scanning
("cursor-pointer transition-all duration-150",
  "hover:border-foreground/20 hover:shadow-sm hover:-translate-y-px");
```

## Target

1. **scrubber.tsx:250-251** — replace the `scale-0` state with a subtle scale+fade (target range 0.9–0.97 + opacity 0):
   ```tsx
   dragging
     ? "scale-125 opacity-100"
     : "scale-90 opacity-0 group-hover/bar:scale-100 group-hover/bar:opacity-100",
   ```
   The element on line ~250 already has `transition-transform`; widen it to `transition-[transform,opacity]` so the fade animates too.
2. **scrubber.tsx:203** — keep the marker's box static and scale it instead:
   ```tsx
   className =
     "... h-3 w-0.5 bg-white/80 origin-bottom transition-transform hover:scale-x-[2] hover:scale-y-[1.33]";
   ```
   (2× of 0.5 width = 1px ≈ the old `w-1`; 1.33× of h-3 ≈ h-4. If the marker is centered on a timestamp, use `origin-center` for x so it grows symmetrically: `origin-bottom` governs y only — acceptable; pick `transform-origin: center bottom` via `origin-bottom`.)
3. **meeting-card.tsx:98 and :231** — `transition-all duration-150` → `transition-[transform,box-shadow,border-color] duration-150`.

## Repo conventions to follow

- Tailwind v4 arbitrary values (`scale-x-[2]`) are already used across clips (`scale-125` etc.).
- Class-string-only edits; imitate neighboring formatting.

## Boundaries

- Only the two files above. Do NOT touch the clips desktop app or chrome extension (plan 003 owns those).
- Do NOT alter drag logic or timeline math.
- If strings have drifted, STOP on that step and report.

## Verification

- **Mechanical**: template typecheck (`pnpm --filter clips typecheck` or repo-standard) passes; `oxfmt` run on both files.
- **Feel check**: hover the player scrubber — the thumb now fades/grows in from 90% instead of popping from nothing; at 10% DevTools animation speed the thumb never appears from a point. Markers grow without neighboring markers shifting (no layout change). Meeting cards still lift on hover.
- **Done when**: `rg "scale-0" templates/clips/app` returns nothing, and no `transition-all` remains in the two files.
