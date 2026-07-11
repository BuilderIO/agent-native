# 001 — Fix transform-origin, exits, and easing across toolkit overlay primitives

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: HIGH
- **Category**: Physicality & origin / Easing & duration / Cohesion
- **Estimated scope**: 10 files in `packages/toolkit/src/ui/` + 2 template copies, ~20 single-line class-string edits

## Problem

The shared shadcn primitives in `packages/toolkit/src/ui/` render every popover-layer surface in every template app (template `app/components/ui/*.tsx` files are 1-line re-exports of these). Several of them scale from center instead of their trigger, exit with `ease-in`, or animate unintended properties. `dropdown-menu.tsx` and `hover-card.tsx` in the same directory already do it right — this plan brings the rest up to that standard.

Current code (verbatim, one line each — the full className strings are long; the excerpts show the relevant portion):

```tsx
// packages/toolkit/src/ui/tooltip.tsx:35 — no origin, no exit animation (snaps closed)
"z-[300] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md animate-in fade-in-0 zoom-in-95",

// packages/toolkit/src/ui/popover.tsx:30 — zooms with no transform-origin (scales from center)
"z-[290] w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",

// packages/toolkit/src/ui/select.tsx:76 — same: no origin
// packages/toolkit/src/ui/context-menu.tsx:51 (SubContent) and :67 (Content) — same: no origin
// packages/toolkit/src/ui/menubar.tsx:76 and :99 — same: no origin

// packages/toolkit/src/ui/context-menu.tsx:67 also carries a stray unconditional entrance
// that conflicts with the gated one (two competing animation-names, fade-from-0.8 vs 0):
"... shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out ..."

// packages/toolkit/src/ui/dropdown-menu.tsx:57 and :86 — exit uses ease-in (starts slow at the
// exact moment the user acts; ease-in on UI is always wrong):
"... data-[state=closed]:duration-100 data-[state=open]:duration-150 data-[state=closed]:ease-in data-[state=open]:ease-out ..."

// packages/toolkit/src/ui/sheet.tsx:32 — stray `transition ease-in-out` (transition utilities
// mixed with keyframe animation classes; ease-in-out is the wrong curve for enter/exit):
"fixed z-[230] gap-4 border-border bg-background p-6 text-foreground shadow-lg outline-none transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:duration-200",

// packages/toolkit/src/ui/tabs.tsx:30 — transition-all on TabsTrigger (tens of times/day):
"inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",

// packages/toolkit/src/ui/checkbox.tsx:14 — checked-state color teleports (no transition at all)
// packages/toolkit/src/ui/select.tsx:119 — SelectItem lacks the transition-colors that
//   dropdown-menu.tsx:104 / context-menu.tsx:85 / menubar.tsx:118 items all have
// packages/toolkit/src/ui/skeleton.tsx:9 — animate-pulse with no motion-reduce gate
// packages/toolkit/src/ui/sidebar.tsx:456 — BUG: "transition-[margin,opa]" — `opa` is not a CSS
//   property; the browser silently drops it, so the group-label opacity fade never animates
```

Literal template copies that do NOT re-export toolkit and need the same tabs fix:

```tsx
// templates/macros/app/components/ui/tabs.tsx:30
"inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:text-foreground",

// templates/plan/app/components/ui/tabs.tsx:30
"inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-transparent px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground",
```

And one core composer popover with the same origin/exit gap:

```tsx
// packages/core/src/client/composer/PastedTextChip.tsx:124 — enter-only, center-origin
className =
  "z-50 w-[min(560px,calc(100vw-32px))] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95";
```

## Target

The exemplar to imitate is `packages/toolkit/src/ui/hover-card.tsx:19`, which ends with `origin-[--radix-hover-card-content-transform-origin]`, and `dropdown-menu.tsx:57`, which pairs gated enter/exit with the origin var.

1. **tooltip.tsx:35** — replace the motion classes so the string becomes:
   ```
   "z-[300] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md origin-[--radix-tooltip-content-transform-origin] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-100 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100"
   ```
2. **popover.tsx:30** — insert `origin-[--radix-popover-content-transform-origin]` after `outline-none`, and append `motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100 motion-reduce:data-[side=bottom]:slide-in-from-top-0 motion-reduce:data-[side=left]:slide-in-from-right-0 motion-reduce:data-[side=right]:slide-in-from-left-0 motion-reduce:data-[side=top]:slide-in-from-bottom-0`.
3. **select.tsx:76** — same two additions with `origin-[--radix-select-content-transform-origin]`.
4. **context-menu.tsx:51 and :67** — add `origin-[--radix-context-menu-content-transform-origin]` + the same motion-reduce suffix. On line 67 ONLY, also delete the stray `animate-in fade-in-80 ` pair (keep the `data-[state=…]`-gated classes).
5. **menubar.tsx:76 and :99** — add `origin-[--radix-menubar-content-transform-origin]` + the same motion-reduce suffix.
6. **dropdown-menu.tsx:57 and :86** — change `data-[state=closed]:ease-in` → `data-[state=closed]:ease-out` (both lines). Append the same motion-reduce zoom/slide-zeroing suffix used in step 2 (slide distances here are `-1`, so use `…slide-in-from-top-0` etc. all the same).
7. **sheet.tsx:32** — remove `transition ease-in-out ` and change the tail to `data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:slide-in-from-right-0 motion-reduce:data-[state=closed]:slide-out-to-right-0 motion-reduce:data-[state=open]:slide-in-from-left-0 motion-reduce:data-[state=closed]:slide-out-to-left-0 motion-reduce:data-[state=open]:slide-in-from-top-0 motion-reduce:data-[state=closed]:slide-out-to-top-0 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:slide-out-to-bottom-0` (curve = the repo's chrome/drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` from `packages/core/src/styles/agent-native.css:113`; under reduced motion the slide zeroes out and the fade remains).
8. **tabs.tsx:30 (toolkit)** — `transition-all` → `transition-[color,background-color,box-shadow]`. Same replacement in **templates/macros/app/components/ui/tabs.tsx:30** (keep its `duration-200` and `hover:text-foreground`) and **templates/plan/app/components/ui/tabs.tsx:30** (keep its `border border-transparent`).
9. **checkbox.tsx:14** — add `transition-colors duration-150` after `shrink-0` (or equivalent position).
10. **select.tsx:119 (SelectItem)** — add `transition-colors` to match `dropdown-menu.tsx:104`.
11. **skeleton.tsx:9** — `"animate-pulse rounded-md bg-muted"` → `"animate-pulse motion-reduce:animate-none rounded-md bg-muted"`.
12. **sidebar.tsx:456** — `transition-[margin,opa]` → `transition-[margin,opacity]`.
13. **PastedTextChip.tsx:124 (packages/core)** — insert `origin-[--radix-popover-content-transform-origin] ` before `animate-in` and replace `animate-in fade-in-0 zoom-in-95` with `data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95`.

## Repo conventions to follow

- Origin var pattern: `origin-[--radix-<component>-content-transform-origin]` exactly as in `hover-card.tsx:19` and `dropdown-menu.tsx:57`.
- Durations via tw-animate `duration-*`/`ease-*` utilities gated on `data-[state=…]`, as `dropdown-menu.tsx:57` already does.
- The template `ui/` sync guard is `packages/core/src/templates/ui-primitives-sync.spec.ts`; macros/plan `tabs.tsx` are intentional literal copies — edit them in place, do not convert to re-exports.

## Boundaries

- Do NOT touch `packages/toolkit/src/ui/dialog.tsx`, `command.tsx`, or `toast.tsx` — a concurrent session is actively editing them.
- Do NOT touch `packages/code-agents-ui/**` (concurrent edits).
- Do NOT change component structure, props, or exports — className strings only.
- Do NOT add dependencies.
- If a quoted string does not match what you find, STOP on that step and report; do the remaining steps.

## Verification

- **Mechanical**: `pnpm --filter @agent-native/toolkit typecheck` (or `pnpm -w tsc -p packages/toolkit` if no script) passes; `pnpm vitest run packages/core/src/templates/ui-primitives-sync.spec.ts` still passes (macros/plan tabs edits keep their allowed deviations intact). Run `oxfmt` on every modified file.
- **Feel check**: in any template app, open a dropdown from a bottom-right trigger and confirm in DevTools (Animations panel at 10% speed) that popover/select/tooltip content grows from the trigger corner, not the center; close a dropdown and confirm the exit no longer lags at the start (ease-out, not ease-in). Toggle "Emulate prefers-reduced-motion" and confirm overlays fade without zoom/slide.
- **Done when**: all 13 steps applied (or explicitly reported as drifted), typecheck + sync-guard green.
