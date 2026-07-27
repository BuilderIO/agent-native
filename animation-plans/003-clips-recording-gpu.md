# 003 — Stop clips recording surfaces from animating layout/paint properties

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: HIGH
- **Category**: Performance / Easing & duration / Purpose & frequency
- **Estimated scope**: 2 CSS files (`templates/clips/desktop/src/styles.css`, `templates/clips/chrome-extension/src/overlay.css`, plus `templates/clips/chrome-extension/src/styles.css`), ~8 rule edits

## Problem

The clips desktop app and Chrome extension draw overlays ON TOP OF the screen being recorded. Any main-thread jank they cause is captured into the user's recording, so these surfaces must composite-animate only. Today they animate `box-shadow`, `height`, `margin-top`, and `max-height`, and their tooltips use `ease-in` and replay entrances on `instant-open`.

Current code:

```css
/* templates/clips/desktop/src/styles.css:1088-1101 — infinite box-shadow pulse for the whole
   recording session (paint every frame, never composited). Near-duplicate `rec-pulse` at
   ~:2780-2799 (1.4s) reused at ~:3965. */
animation: rec-live-pulse 1.2s ease-out infinite;
@keyframes rec-live-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.6);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(255, 255, 255, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
  }
}

/* templates/clips/desktop/src/styles.css:2836-2838 — recording toolbar expands via height */
transition:
  height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
  border-radius 170ms cubic-bezier(0.2, 0.8, 0.2, 1);

/* templates/clips/desktop/src/styles.css:2955-2960 — hover-actions block: height + margin-top */
transition:
  height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
  margin-top 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
  opacity 130ms ease-out,
  transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);

/* templates/clips/desktop/src/styles.css:1633-1640 — tooltips replay entrance on instant-open,
   and exit with ease-in */
.tooltip-content[data-state="delayed-open"],
.tooltip-content[data-state="instant-open"] {
  animation: tooltip-in 120ms ease-out;
}
.tooltip-content[data-state="closed"] {
  animation: tooltip-out 90ms ease-in;
}

/* templates/clips/desktop/src/styles.css:334 — same ease-in exit on feedback popover */
animation: feedback-popover-out 90ms ease-in;

/* templates/clips/chrome-extension/src/overlay.css:286-294 — hover reveal animates max-height
   on the in-page toolbar (janks the recorded page) */
max-height: 0;
transition:
  max-height 0.18s ease,
  opacity 0.18s ease;
/* … */
max-height: 120px;

/* templates/clips/chrome-extension/src/styles.css:234-236 — CSS tooltip uses ease-in both ways */
transition:
  opacity 90ms ease-in,
  transform 90ms ease-in;
```

## Target

1. **rec-live-pulse / rec-pulse** — stop animating `box-shadow`. Give the dot a pulsing ring via an absolutely-positioned pseudo-element that only uses transform+opacity:
   ```css
   /* replace the box-shadow keyframes; keep selector names and timing */
   .rec-live-dot {
     position: relative;
   } /* adjust to the actual pulsing selector */
   .rec-live-dot::after {
     content: "";
     position: absolute;
     inset: -1px;
     border-radius: inherit;
     border: 1px solid rgba(255, 255, 255, 0.6);
     animation: rec-live-pulse 1.2s ease-out infinite;
     pointer-events: none;
   }
   @keyframes rec-live-pulse {
     0% {
       transform: scale(1);
       opacity: 1;
     }
     70% {
       transform: scale(2.4);
       opacity: 0;
     }
     100% {
       transform: scale(2.4);
       opacity: 0;
     }
   }
   ```
   Merge `rec-pulse` (the 1.4s near-duplicate) into the same keyframes; keep its 1.4s duration at its use sites if visually distinct timing was intended. Gate both with:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .rec-live-dot::after {
       animation: none;
       opacity: 0.6;
       transform: none;
     }
   }
   ```
2. **Toolbar expand (2836-2838, 2955-2960)** — remove `height` and `margin-top` from the transition lists, keeping border-radius/opacity/transform:
   ```css
   transition:
     border-radius 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
     opacity 130ms ease-out,
     transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
   ```
   Then make the reveal transform-driven: if the expanded/collapsed states set explicit heights, keep the heights static per state (instant) and let opacity+`transform: translateY(-6px)→0` (already present at :2952-2953) carry the motion. Do NOT attempt a clip-path rewrite; the goal is simply that no layout property is in a transition list on these rules.
3. **Tooltips (1633-1640)** — split the rule: `delayed-open` keeps `animation: tooltip-in 120ms ease-out;`; `instant-open` gets `animation: none;` (a tooltip that follows an already-open tooltip must appear instantly). Change `tooltip-out`'s timing function from `ease-in` to `ease-out`, and `feedback-popover-out` at :334 likewise `ease-in` → `ease-out`.
4. **overlay.css hover reveal (286-294)** — replace the `max-height` mechanism with opacity+transform on a normally-sized block:
   ```css
   .toolbar-v-hover-actions {
     opacity: 0;
     transform: translateY(-4px) scaleY(0.92);
     transform-origin: top;
     pointer-events: none;
     transition:
       opacity 0.18s ease,
       transform 0.18s ease;
   }
   .toolbar-v:hover .toolbar-v-hover-actions {
     opacity: 1;
     transform: none;
     pointer-events: auto;
   }
   ```
   If removing `max-height: 0` changes the collapsed toolbar's footprint (the actions block would occupy space), instead keep `max-height: 0/120px` WITHOUT transitioning it (remove it from the transition list) and let opacity/transform carry the motion — footprint pops but paint stays cheap and the recorded page never reflows smoothly-per-frame.
5. **extension styles.css:234-236** — `ease-in` → `ease` for the show transition and `ease-out` for hide; keep 90ms.

## Repo conventions to follow

- This codebase's desktop CSS already does indeterminate progress correctly with `transform: translateX` (`finalizing-progress-sweep`, desktop styles.css ~:2665-2673) — imitate that discipline.
- Reduced-motion blocks already exist at desktop styles.css :3067 and :4382 — add new gates alongside the same pattern.

## Boundaries

- Do NOT touch the `bubble-compositor-heartbeat` keyframes (~:3152-3162) — deliberate compositor keep-alive.
- Do NOT touch `region-record-border-pulse` (~:4366-4386) — documented deliberate tradeoff with an existing reduced-motion guard.
- Do NOT change any Rust/TS source, markup, or class names — CSS values/rules only.
- If line numbers have drifted, locate rules by the quoted selectors/keyframe names; if a rule can't be found, STOP on that step and report.

## Verification

- **Mechanical**: CSS parses (run the app build if cheap: `pnpm --filter clips-desktop build` or the repo-standard check). `rg "ease-in[^-]" templates/clips/desktop/src/styles.css templates/clips/chrome-extension/src` shows no remaining UI `ease-in` timing functions. Run `oxfmt` if it covers CSS; otherwise leave formatting as-is.
- **Feel check**: with DevTools performance overlay (paint flashing) on the extension overlay page, hovering the toolbar must not repaint the page beneath each frame; the live-recording dot pulse shows no per-frame paint outside its own bounds. Tooltips: sweep across the toolbar — only the first tooltip animates in; closes feel immediate.
- **Done when**: no `box-shadow`, `height`, `margin-top`, or `max-height` appears in any `transition`/`@keyframes` in the touched rules, and tooltip `instant-open` has no entrance animation.
