# 010 — Slides editor: broken toggle thumb, progress bar, unanimated toolbar popover

- **Status**: DONE (mechanically verified; feel checks pending)
- **Commit**: f43d34ca24
- **Severity**: MEDIUM (includes one outright broken animation)
- **Category**: Performance / Cohesion / Physicality & origin
- **Estimated scope**: 4 files in `templates/slides/app/`, ~6 edits

## Problem

```tsx
// templates/slides/app/components/editor/GenerateSlidesDialog.tsx:151-159 — BROKEN: the class
// says transition-transform but the thumb moves via `left`, so it teleports (transform never changes)
className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
  includeImages ? "left-[calc(100%-18px)]" : "left-0.5"
}`}

// templates/slides/app/components/presentation/PresentationView.tsx:514-522 — progress bar
// animates layout width
style={{ width: `${((currentIndex + 1) / safeSlides.length) * 100}%`, transition: "width 0.3s" }}

// templates/slides/app/components/editor/EditorToolbar.tsx:203-212 — the hand-rolled
// ToolbarPopover (Layout/Background/Tools menus) portals a fixed div with ZERO animation,
// while the same toolbar's shadcn DropdownMenu (line ~979) animates open/close.
return createPortal(
  <div ref={menuRef} className="fixed rounded-lg border ... z-[200] ...">{children}</div>,
  document.body,
)

// templates/slides/app/components/editor/EditorSidebar.tsx:218 — slide-row selection uses
// transition-all on the most-navigated element in the editor
className={`w-full text-left flex items-start gap-2 p-2 rounded-lg transition-all duration-150 ${
  isActive ? "bg-accent ring-1 ring-[#609FF8]/50" : "hover:bg-accent"
} focus:outline-none`}
```

## Target

1. **GenerateSlidesDialog.tsx:151-159** — move the thumb with transform so the declared transition actually runs:
   ```tsx
   className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150 ${
     includeImages ? "translate-x-[14px]" : "translate-x-0"
   }`}
   ```
   (Track width minus thumb and padding: the old on-position was `left: calc(100% - 18px)` on the same track — measure the track: if its width is `w-8` (32px), 32 − 16 − 2·2 = 14px is nearly right; verify visually and adjust the pixel value so the on/off positions match the previous rendering exactly.)
2. **PresentationView.tsx:514-522** — scaleX pattern:
   ```tsx
   style={{
     transform: `scaleX(${(currentIndex + 1) / safeSlides.length})`,
     transformOrigin: "left",
     transition: "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
     width: "100%",
   }}
   ```
3. **EditorToolbar.tsx ToolbarPopover (~203-212)** — add entrance motion to match the sibling dropdown: append `animate-in fade-in-0 zoom-in-95 duration-150 origin-top-left` to the portal div's className (position is set via inline style below the trigger, so top-left origin approximates growing from the trigger).
4. **EditorSidebar.tsx:218** — `transition-all duration-150` → `transition-[background-color,box-shadow] duration-150`.

## Repo conventions to follow

- Slides already uses tw-animate classes (`animate-in fade-in-0 zoom-in-95`) elsewhere via the toolkit primitives; imitate that.
- Class-string / inline-style edits only.

## Boundaries

- Only the four files. Do NOT touch presentation slide-transition effects (user-facing product content in global.css:1103-1154) or the deck data model.
- If a string has drifted, STOP on that step and report; continue the rest.

## Verification

- **Mechanical**: slides typecheck passes; `oxfmt` on modified files.
- **Feel check**: toggle "include images" in the generate dialog — the thumb now slides (before it teleported); at 10% DevTools animation speed confirm a smooth 150ms glide landing exactly on the old end positions. Present a deck — progress advances smoothly with no layout recalcs (paint-flash check). Open the Layout menu — it fades/zooms in from the trigger corner like the toolbar's other menus.
- **Done when**: all 4 steps applied; the toggle thumb's rest positions are pixel-identical to before.
