# 002 — Core motion tokens + agent-chat micro-motion fixes

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: HIGH (cohesion foundation + highest-frequency surface)
- **Category**: Cohesion & tokens / Easing & duration / Performance / Accessibility
- **Estimated scope**: ~10 files in `packages/core/src/`, mostly single-line edits + one token block

## Problem

Core hand-duplicates its two signature curves — `cubic-bezier(0.32, 0.72, 0, 1)` (260ms, chrome/drawer) and `cubic-bezier(0.2, 0, 0, 1)` (200ms, collapse) — with no shared tokens, and the agent chat (the single most-used surface in the product) has a handful of wrong or missing micro-transitions.

Current code:

```css
/* packages/core/src/styles/agent-native.css:112-113 */
will-change: width;
transition: width 260ms cubic-bezier(0.32, 0.72, 0, 1);
/* same literal curve repeated at :153-156 (three properties), :239, :254, :268 */
/* collapse curve repeated at :518-521 and :543-546 */

/* packages/core/src/styles/agent-native.css:554-558 — reduced-motion nukes opacity too */
@media (prefers-reduced-motion: reduce) {
  .agent-native-settings-section-body {
    transition: none;
  }
}
```

```tsx
// packages/core/src/client/chat/tool-call-display.tsx:455 — generic ease-out, not the collapse curve
className="overflow-hidden transition-[height] duration-200 ease-out"

// packages/core/src/client/chat/tool-call-display.tsx:807 — transition-all on every tool-call row's chevron
"absolute size-3.5 opacity-0 transition-all group-hover/tool:opacity-100",

// packages/core/src/client/composer/TiptapComposer.tsx:2748-2756 — Send button: no transition, no press feedback
className="agent-composer-send-button shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"

// packages/core/src/client/composer/VoiceButton.tsx:107-111 — color states snap (no transition class)
className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-30 disabled:cursor-not-allowed ${recording ? "text-[#00B5FF] bg-[#00B5FF]/10 hover:bg-[#00B5FF]/20" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}

// packages/core/src/client/AgentPanel.tsx:368-386 — ungated animate-pulse skeletons (several divs)
<div className="h-5 w-3/5 rounded bg-muted animate-pulse" />

// packages/core/src/client/extensions/ExtensionsSidebarSection.tsx:1057 — BUG: fade declared but
// transition-colors doesn't cover opacity, so the drag-handle reveal never animates
"-ml-2 cursor-grab rounded p-0.5 text-muted-foreground/30 opacity-0 transition-colors hover:text-muted-foreground/70 active:cursor-grabbing group-hover/extension:opacity-100 group-focus-within/extension:opacity-100"
// same file :570, :873, :943 — transition-all on opacity/color-only hover reveals

// packages/core/src/client/progress/RunsTray.tsx:562+569 — transition-all animating width
"h-full transition-all"  /* + style={{ width: `${run.percent}%` }} */
// :252 — perpetual animate-spin for entire run lifetime, ungated
className={cn(triggerTone, activeCount > 0 && "animate-spin")}

// packages/core/src/client/visual-style-controls.tsx:339 — transition-all on hover-scaled swatches
"size-5 cursor-pointer rounded-md border border-border/70 transition-all hover:scale-105 hover:border-foreground/40 …"

// packages/core/src/client/FeedbackButton.tsx:436,489 — popover/tooltip zoom with no origin var
// packages/core/src/client/context-xray/ContextXRayPanel.tsx:124 — meter animates width
className="h-full rounded-full bg-foreground transition-[width] duration-200" style={{ width: `${pct}%` }}
```

## Target

1. **Tokens** — in `packages/core/src/styles/agent-native.css`, inside the existing `@theme` block (next to `--animate-bounce-once` at :359), add:
   ```css
   --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
   --ease-collapse: cubic-bezier(0.2, 0, 0, 1);
   --ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
   ```
   Then replace every literal `cubic-bezier(0.32, 0.72, 0, 1)` in this file with `var(--ease-drawer)` and every `cubic-bezier(0.2, 0, 0, 1)` with `var(--ease-collapse)`. Values must stay identical.
2. **agent-native.css:112** — delete the `will-change: width;` line (width is a layout property; the hint only costs memory). Do the same for the identical hint near :238 if present.
3. **agent-native.css:554-558** — keep movement removal but preserve the fade:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .agent-native-settings-section-body {
       transition: opacity 150ms ease;
     }
   }
   ```
4. **tool-call-display.tsx:455** — `ease-out` → `ease-[var(--ease-collapse)]` (keep `transition-[height] duration-200`).
5. **tool-call-display.tsx:807** — `transition-all` → `transition-[opacity,transform]` (the chevron both fades and rotates).
6. **TiptapComposer.tsx:2748** — append `transition-[opacity,transform] duration-150 active:scale-[0.97]` to the Send button className (before `disabled:`-classes is fine).
7. **VoiceButton.tsx:107** — add `transition-colors duration-150` to the static class portion.
8. **AgentPanel.tsx:368-386** — add `motion-reduce:animate-none` to each `animate-pulse` div.
9. **ExtensionsSidebarSection.tsx:1057** — `transition-colors` → `transition-[opacity,color]`. Lines :570, :873, :943 — `transition-all` → `transition-[opacity,color,background-color]`.
10. **RunsTray.tsx:562/569** — replace width animation with transform: className `"h-full origin-left transition-transform duration-200 ease-[var(--ease-collapse)]"` and style `{{ transform: `scaleX(${run.percent / 100})`, width: "100%" }}`. Line :252 — append `motion-reduce:animate-none` next to `animate-spin`.
11. **visual-style-controls.tsx:339** — `transition-all` → `transition-[transform,border-color]` (match siblings at :575/:595).
12. **FeedbackButton.tsx:436** — add `origin-[--radix-popover-content-transform-origin]`; **:489** — add `origin-[--radix-tooltip-content-transform-origin]`.
13. **ContextXRayPanel.tsx:124** — same scaleX pattern as step 10: className `"h-full rounded-full bg-foreground origin-left transition-transform duration-200"`, style `{{ transform: `scaleX(${Math.min(1, pct / 100)})`, width: "100%" }}`.

## Repo conventions to follow

- Token declarations live in the `@theme` block of `packages/core/src/styles/agent-native.css` (exemplar: `--animate-bounce-once` at :359).
- Use `ease-[var(--ease-collapse)]` arbitrary-value classes in TSX (do not rely on generated `ease-collapse` utilities — core client classes are compiled by each template's Tailwind build).
- Press feedback target per the motion playbook: scale 0.95–0.98, ~150ms, ease-out.

## Boundaries

- Do NOT touch `packages/toolkit/**` (that's plan 001/008) or `packages/code-agents-ui/**` (concurrent edits).
- Do NOT touch `packages/frame/**` — its mirrored curves are out of scope; leave a `TODO(motion-tokens)` comment ONLY if you must, otherwise nothing.
- Do NOT restructure components; className/style/CSS edits only.
- If a quoted string doesn't match (drift), STOP on that step and report; continue the rest.

## Verification

- **Mechanical**: `pnpm --filter @agent-native/core typecheck` (or repo-standard typecheck) passes. `rg "cubic-bezier\(0.32, 0.72, 0, 1\)" packages/core/src/styles/agent-native.css` returns only the token definition line; same for the collapse curve. Run `oxfmt` on modified files.
- **Feel check**: in any template, hover a tool-call row — chevron fades/rotates as before; expand a tool call and a settings section — both collapses feel identical (same curve). Click Send — button dips slightly on press. Watch the runs tray progress — fill scales smoothly with no layout jitter. Toggle reduced-motion — skeletons stop pulsing, settings collapse still fades.
- **Done when**: all steps applied or reported as drifted; both curves exist exactly once as literals (the token definitions).
