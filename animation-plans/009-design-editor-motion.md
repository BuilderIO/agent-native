# 009 — Design editor: tooltip grouping, inspector collapse, and small motion fixes

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM-HIGH (tooltip delay replay hits every inspector hover)
- **Category**: Easing & duration / Interruptibility / Performance / Accessibility
- **Estimated scope**: ~6 files in `templates/design/app/`, one shared-provider hoist + several one-liners

## Problem

```tsx
// 1) No shared TooltipProvider: LayersPanel.tsx:2231-2291 (lock/hide per row),
// edit-panel/inspector-controls.tsx:243-280 (InspectorIconButton) and :12-63 (SectionIconButton)
// each render a bare <Tooltip>. Radix's skip-delay grouping only works under one shared
// provider, so the full default ~700ms open delay replays on EVERY icon as the user sweeps
// across a row — tooltips should appear near-instantly after the first.
// (Only inspector/AutoLayoutMatrix.tsx and inspector/AlignmentMatrix.tsx wrap a local provider.)

// 2) edit-panel/panel-primitives.tsx:664-698 — PanelSection, the collapse primitive behind
// every right-inspector section, hard mounts/unmounts its body:
{
  !collapsed && children ? (
    <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">{children}</div>
  ) : null;
}

// 3) inspector/DesignColorPicker.tsx:1438-1446 — paint-type tabs declare active:scale-95 but
// only transition-colors, so the scale snaps instead of easing:
("flex h-8 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "active:scale-95",
  // 4) components/layout/Layout.tsx:179 — mobile sidebar drawer slide has no reduced-motion out:
  "agent-layout-left-drawer fixed inset-y-0 start-0 z-50 transition-transform duration-200 ease-out md:static md:z-auto md:transition-none",
  (
    // 5) DesignImportPanel.tsx:517-529 — .fig upload progress animates width:
    <div
      className="h-full rounded-full bg-foreground/70 transition-[width] duration-150"
      style={{ width: `${figUploadProgress ?? 0}%` }}
    />
  ));

// 6) pages/Index.tsx:737 — three-dot menu on design cards pops with no fade (its sibling
// checkbox at :711 fades via transition-opacity):
("absolute top-2 end-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100");
```

## Target

1. **Tooltip grouping** — in the design editor's inspector root (`EditPanel.tsx`, wrapping its returned tree) and in `LayersPanel.tsx` (wrapping the panel root), add ONE shared provider each:
   ```tsx
   import { TooltipProvider } from "@/components/ui/tooltip";
   <TooltipProvider delayDuration={300} skipDelayDuration={400}>
     …existing tree…
   </TooltipProvider>;
   ```
   Remove nothing else; the local providers in AutoLayoutMatrix/AlignmentMatrix may stay. If `TooltipProvider` is not exported from `@/components/ui/tooltip`, re-export it there from `@agent-native/toolkit/ui/tooltip` (the toolkit file already exports it — verify; if not, import `TooltipPrimitive.Provider` in the toolkit file and export as `TooltipProvider`).
2. **PanelSection collapse** — replace the hard conditional with an always-mounted grid-rows transition:
   ```tsx
   <div
     className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
     style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
   >
     <div className="overflow-hidden">
       {children ? (
         <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">
           {children}
         </div>
       ) : null}
     </div>
   </div>
   ```
   Keep the `collapsed`/`setCollapsed` logic untouched. If sections contain popover triggers that get clipped by `overflow-hidden`, set `overflow-hidden` only while animating or when collapsed (`className={collapsed ? "overflow-hidden" : "overflow-clip [overflow-clip-margin:1px]"}` is NOT required — first try plain `overflow-hidden`; only if a popover inside a section visibly clips, fall back to `{collapsed ? "overflow-hidden" : ""}`).
3. **DesignColorPicker.tsx:1438** — `transition-colors` → `transition-[color,background-color,transform] duration-150`.
4. **Layout.tsx:179** — append `motion-reduce:transition-none` to the drawer class string.
5. **DesignImportPanel.tsx:517-529** — scaleX pattern: className `"h-full rounded-full bg-foreground/70 origin-left transition-transform duration-150"`, style `{{ transform: `scaleX(${(figUploadProgress ?? 0) / 100})`, width: "100%" }}`.
6. **Index.tsx:737** — add `transition-opacity` to the class string (match sibling at :711).

## Repo conventions to follow

- `@/components/ui/tooltip` re-exports `@agent-native/toolkit/ui/tooltip`; extend the re-export rather than importing Radix directly in app code.
- Collapse curve `cubic-bezier(0.2, 0, 0, 1)` at 200ms is the repo convention (core agent-native.css:519).

## Boundaries

- Do NOT touch `DesignCanvas.tsx`, `MultiScreenCanvas.tsx`, or `multi-screen/chrome-transitions.ts` — the canvas chrome-settle rework is deliberately excluded (documented engineering; needs its own session).
- Do NOT touch the motion-editing feature files (`MotionDock.tsx`, `shared/motion-*`).
- If a step's code has drifted, STOP on that step and report; continue the rest.

## Verification

- **Mechanical**: design template typecheck passes; `oxfmt` on modified files.
- **Feel check**: sweep the cursor across the layers panel's lock/hide icons — after the first tooltip appears, subsequent ones show with no ~700ms wait. Collapse/expand an inspector section rapidly — the body eases both ways and mid-toggle reversals retarget (no restart from zero). Open a color popover inside a collapsed→expanded section — nothing is clipped. Upload progress sweeps without layout jank.
- **Done when**: all 6 steps applied or reported as drifted; tooltip skip-delay verified by feel.
