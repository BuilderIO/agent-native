# 008 — Press feedback on the shared Button (and re-align macros' drifted copy)

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM (every pressable in every app; a feel decision — feel-check required)
- **Category**: Physicality & origin / Cohesion
- **Estimated scope**: 2 files, 2 class-string edits

## Problem

The shared Button has hover color transitions but zero press feedback — clicks feel inert. Meanwhile macros carries a drifted literal copy that DOES have press feedback (`active:scale-[0.98]`) but uses `transition-all`:

```tsx
// packages/toolkit/src/ui/button.tsx:9 (canonical — renders in every template)
"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",

// templates/macros/app/components/ui/button.tsx:8 (drifted literal copy — keeps rounded-lg deviation)
"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
```

## Target

Press feedback per the motion playbook: subtle scale in the 0.95–0.98 range with a fast transform transition.

1. **toolkit button.tsx:9** — replace `transition-colors` with:
   ```
   transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100
   ```
   (everything else in the string unchanged).
2. **macros button.tsx:8** — replace `transition-all duration-150` with `transition-[color,background-color,border-color,box-shadow,transform] duration-150` and add `motion-reduce:active:scale-100` after its existing `active:scale-[0.98]`. Keep its `rounded-lg` deviation exactly as-is.

## Repo conventions to follow

- Macros' copy is an allowed deviation tracked by `packages/core/src/templates/ui-primitives-sync.spec.ts` — edit in place, do not convert to a re-export.
- 0.98 (not 0.95): these are small, dense productivity-app buttons; deeper scales look cartoonish at this size.

## Boundaries

- Exactly the two class strings. No variant additions, no prop changes.
- Do NOT touch link-variant behavior concerns beyond the base string (the `link` variant inherits the scale; acceptable — flag in the report if it feels wrong in the feel check).
- If a string has drifted, STOP and report.

## Verification

- **Mechanical**: toolkit + macros typechecks pass; `pnpm vitest run packages/core/src/templates/ui-primitives-sync.spec.ts` still passes; `oxfmt` on both files.
- **Feel check** (this plan lives or dies here): in any template, press-and-hold a primary button — it should dip slightly (barely perceptible, ~2%) and spring back on release; rapid clicks never leave it stuck small. Check a destructive button, a ghost/icon button, and a `link`-variant button — if the link variant's text scaling looks wrong, add `active:scale-100` to the `link` variant's classes and note it.
- **Done when**: both buttons share the scoped transition list, press feedback feels subtle at normal speed, and the sync spec is green.
