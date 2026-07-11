# 006 — Scope transition-all to real properties across analytics/forms/mail/calendar/macros

- **Status**: DONE (DailyProgress.tsx item superseded by concurrent scaleX rewrite; progress.tsx corrected to transition-transform)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM (constant-frequency surfaces, mechanical fix)
- **Category**: Performance
- **Estimated scope**: 6 files, ~22 single-token class edits

## Problem

`transition-all` animates every animatable property off-GPU and is always a finding. These sit on the highest-frequency navigation surfaces (sidebars, calendar grid, list rows). Each item below was verified; only the property that actually changes should transition.

```tsx
// templates/analytics/app/components/layout/Sidebar.tsx
// :2550, :2603, :2617, :2631, :2646, :2660, :2674, :2820, :2967, :3002 — nav links, color-only:
"flex w-full min-w-0 items-center rounded-lg transition-all hover:text-primary";
// :280, :919, :978, :1510 — icon-button hover reveals (opacity + color):
"... opacity-0 transition-all hover:bg-sidebar-accent ... group-hover/section:opacity-100 ...";
// :641 — row padding animates on hover to make room for already-absolutely-positioned icons:
"min-w-0 flex-1 px-2 py-1.5 pe-12 text-xs transition-[padding] md:pe-2 md:group-hover/item:pe-12 md:group-focus-within/item:pe-12";

// templates/forms/app/components/layout/Sidebar.tsx:134, :377, :393 — color-only:
"flex min-h-[44px] w-full ... text-sm transition-all hover:text-primary"; // and variants

// templates/mail/app/components/layout/AppLayout.tsx:1574 — opacity-only toggle:
"flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start transition-all";

// templates/calendar/app/components/calendar/EventCard.tsx:52 and :95 — draggable event cards,
// hover changes brightness (filter) only; also no press feedback on a clickable/draggable card:
"relative flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-foreground transition-all hover:brightness-110";

// templates/macros/app/components/DailyProgress.tsx:190 and
// templates/macros/app/components/ui/progress.tsx:19 — progress fills, width-only:
"h-full transition-all duration-500 ease-out rounded-full";
```

## Target

1. **analytics Sidebar nav links** (`:2550, :2603, :2617, :2631, :2646, :2660, :2674, :2820, :2967, :3002`) — `transition-all` → `transition-colors`.
2. **analytics Sidebar icon reveals** (`:280, :919, :978, :1510`) — `transition-all` → `transition-[opacity,color,background-color]`.
3. **analytics Sidebar :641** — stop animating padding: remove `transition-[padding]` (leave the responsive padding classes; the reveal is already carried by the icons' own opacity fade one line below at :649).
4. **forms Sidebar :134, :377, :393** — `transition-all` → `transition-colors`.
5. **mail AppLayout :1574** — `transition-all` → `transition-opacity`.
6. **calendar EventCard :52 and :95** — `transition-all` → `transition-[filter,transform]` and append `active:scale-[0.98]` to both class strings (press feedback target 0.95–0.98; the card is clicked/dragged constantly).
7. **macros DailyProgress :190 and ui/progress.tsx :19** — `transition-all duration-500 ease-out` → `transition-[width] duration-500 ease-out` (explicit width; a scaleX refactor is out of scope here because the fill has `rounded-full` ends that would distort).

## Repo conventions to follow

- Property-scoped arbitrary transitions (`transition-[opacity,color]`) already appear in these templates (e.g. mail's `transition-[padding]` pattern, analytics `transition-colors` on most rows).
- `templates/macros/app/components/ui/progress.tsx` is a literal (non-re-export) primitive copy — edit in place; do not convert to a re-export.

## Boundaries

- ONLY the class-token replacements listed. No markup, logic, or layout changes.
- Do NOT touch `templates/*/app/components/ui/` files other than macros `progress.tsx`.
- Line numbers may drift a few lines — match on the quoted class strings; if a string can't be found, STOP on that item and report, continue the rest.

## Verification

- **Mechanical**: `rg "transition-all" <the six files>` returns zero matches afterward; template typechecks pass; `oxfmt` run on modified files.
- **Feel check**: analytics sidebar hover — rows/icons behave identically to before (colors/opacity still fade); dashboards rows :641 — icons still fade in on hover and the text no longer shifts (padding is static per breakpoint; confirm no overlap between text and icons at narrow sidebar widths — if text overlaps the icon rail, restore the padding classes exactly as found and report). Calendar event cards dim slightly on press and still drag smoothly.
- **Done when**: zero `transition-all` in the six files, all feel checks pass.
