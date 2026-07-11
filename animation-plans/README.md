# Animation improvement plans

Written 2026-07-11 at commit `f43d34ca24` by the `improve-animations` audit (4 parallel area audits + verification pass over ~60 raw findings; every plan step was re-verified at its cited file:line before writing).

## Plans

| #                                           | Title                                                              | Severity    | Status |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------- | ------ |
| [001](001-toolkit-overlay-primitives.md)    | Toolkit overlay primitives: origins, exits, easing, reduced-motion | HIGH        | DONE   |
| [002](002-core-motion-tokens-and-chat.md)   | Core motion tokens + agent-chat micro-motion                       | HIGH        | DONE   |
| [003](003-clips-recording-gpu.md)           | Clips recording surfaces: stop animating layout/paint props        | HIGH        | DONE   |
| [004](004-clips-player-scrubber.md)         | Clips player scrubber physicality                                  | HIGH        | DONE   |
| [005](005-content-editor-motion.md)         | Content editor: resize lag, progress, hover easing                 | HIGH        | DONE   |
| [006](006-productivity-transition-scope.md) | transition-all sweep: analytics/forms/mail/calendar/macros         | MEDIUM      | DONE   |
| [007](007-mail-swipe-velocity.md)           | Mail swipe: velocity-based commit                                  | MEDIUM      | DONE   |
| [008](008-button-press-feedback.md)         | Shared Button press feedback                                       | MEDIUM      | DONE   |
| [009](009-design-editor-motion.md)          | Design editor: tooltip grouping, inspector collapse, fixes         | MEDIUM-HIGH | DONE   |
| [010](010-slides-editor-motion.md)          | Slides editor: broken toggle, progress, toolbar popover            | MEDIUM      | DONE   |
| [011](011-core-collapse-consolidation.md)   | Chat disclosure rows onto AnimatedCollapse                         | MEDIUM      | DONE   |

## Execution order & dependencies

- All plans are file-disjoint and safe to run in parallel EXCEPT **011 must run after 002** (same file: `tool-call-display.tsx`).
- Concurrent-work exclusions baked into the plans: `packages/toolkit/src/ui/{dialog,command,toast}.tsx` and `packages/code-agents-ui/**` are being edited by another session (a `motion="instant"` dialog opt-out + toast fixes) — no plan touches them.
- Suggested order by leverage: 001 → 002 → 003 → 005 → 009 → 004 → 010 → 006 → 007 → 008 → 011.

## Feel-check results (2026-07-11, browser-verified)

A second pass verified the design editor (plan 009): PanelSection grid-rows collapse eases and retargets mid-animation, **no popover clipping** (the color-model mini-menu nests inside a portaled popover, so the section's `overflow-hidden` never applies), layers-panel tooltips animate on `delayed-open` under the shared provider, zero console errors. Remaining unverified by browser: mail swipe (needs Gmail + touch device), content sidebar resize (browser-testing content is off-limits in this workspace), clips overlays (GPU-safe by construction, grep-verified).

A live browser pass (slides + analytics; mail inconclusive — needs Gmail OAuth) verified the button press, ease-out exits, the slides toggle/toolbar-menu fixes, and analytics hover fades, and caught two bugs that were then fixed and re-verified live:

- **`origin-[--radix-…]` compiled to an empty CSS rule** (Tailwind v4 removed the bare-custom-property bracket sugar) — this predated the plans (dropdown/hover-card origins never worked) and the plans propagated it. Fixed to `origin-[var(--radix-…)]` across 7 toolkit primitives + PastedTextChip + FeedbackButton; live computed transform-origin now edge-aware.
- **Tooltip entrance gated on `data-[state=open]`, which Radix tooltips never emit** (`delayed-open`/`instant-open` only) — plan 001 regression. Fixed to `data-[state=delayed-open]:` entrance (instant-open intentionally unanimated per the frequency rule); exit unaffected.
- Analytics sidebar: `transition-[padding]` was restored on the dashboards/analyses rows — removing it (plan 006 step 3) made the hover padding snap jarringly; the drag-handle grip also got `transition-[opacity,color]` so its declared fade actually runs.

## Deliberately NOT planned (backlog)

- **Design canvas chrome-settle** (`templates/design/app/components/design/multi-screen/chrome-transitions.ts` + `MultiScreenCanvas.tsx` handle styles): settle transitions animate inset/border/width/height once per zoom-commit (150ms). Real cost, but the file documents deliberate compositor engineering and the fix requires reworking handle geometry to transforms inside a 10k-line canvas — needs a design-editor session with visual regression checks, not a zero-context executor.
- **Toolkit accordion** animates `height` keyframes (`agent-native.css:361-372`); grid-rows rework is a behavior-visible structural change.
- **Toolkit sidebar.tsx** `transition-[width]`/`transition-[width,height,padding]` on menu buttons — layout-prop animation, but the sidebar primitive's geometry contract makes a transform proxy nontrivial.
- **db-admin** hand-rolled modal/drawer with zero motion (`SqlEditor.tsx:186-226`, `RowSidePanel.tsx:148-153`) — should become shadcn Dialog/Sheet (repo convention) rather than gaining bespoke animation.
- **Changelog.tsx:228-262** hand-rolled dialog and **ThumbsFeedback.tsx:130-137** raw `PopoverPrimitive.Content` — swap to shared primitives.
- **Settings arm→confirm snaps** (`SettingsPanel.tsx:355-397`, `VersionHistoryPanel.tsx:82-123`), duplicated async-save button (8 sites), and 3 hand-rolled switches — extract shared components first.
- **Missed-opportunity delight**: onboarding checklist has zero motion and vanishes instantly on completion (`OnboardingPanel.tsx:89`); mail Inbox-Zero photo pops with no fade (`EmailList.tsx:185-193`); dashboard skeleton→content hard swap (analytics `sql-dashboard/index.tsx:1618`).
- **`motion` v12 is a declared dependency of mail/macros/slides/analytics/calendar but has zero imports anywhere** — either adopt it for the gesture surfaces (mail swipe, calendar drag) or drop the dep.

## Refuted during verification (do not re-file)

- toolkit `toast.tsx` `transition-all` — already `transition-transform` + `motion-reduce:*` (fixed concurrently).
- clips extension `saving-indeterminate` `margin-left` sweep — already `translateX`.
- slides `CanvasCommentPins.tsx:313` 1000ms fly-away — already `transition-[transform,opacity] duration-200` + reduced-motion.
- Ungated `hover:` transforms as touch-a11y bugs — Tailwind v4 compiles `hover:` under `@media (hover: hover)` by default.
- `code-agents-ui` dropdown exit "ease-in" — actual curve at the cited lines is `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out).
