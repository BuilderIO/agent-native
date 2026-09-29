# Session findings — evidence for each defect and retraction

Worked examples for the method in `SKILL.md`, from one long local session.

## The original question

The user's clip showed an element failing to drop *inside a group*. The first
real finding was that **this is not a bug**: Figma also inserts into the
nearest auto-layout container at the nearest index, and getting an element
inside a group requires the layers panel in Figma too. Measuring Figma first
would have saved the whole first investigation.

---

## Fixed (6)

### 1. Menu gated to single view
`Add auto layout` / `Frame selection` were gated on `viewMode === "single"`
while `Cmd+G` already worked from overview — the two entry points disagreed
about the same command. Removed the gate; precedent was a comment already in
the file about exactly this.

### 2. Empty painted `<section>` refuses a layers-panel drop

```
EMPTY  <section> target -> parent unchanged     FAIL (3/3)
FILLED <section> target -> parent = "box"       OK
canvas drag into the SAME empty <section>       OK
```

Found by instrumenting the drop boundary after four gates had been read and
cleared:

```
EMPTY  [LPDBG] nodeType:"shape"  canDropInside:false  placement:"before"
FILLED [LPDBG] nodeType:"frame"  canDropInside:true   placement:"inside"
```

`treeTypeForNode` classifies a **childless** painted, sized element as
`"shape"`; the same element is a `"frame"` once it has one child. `"shape"` is
not in `CONTAINER_TYPES`, so `dropPlacementForEvent` could only ever return a
sibling placement. Fixed at the classifier: container-by-definition tags
(`section header footer nav main article aside ul ol form fieldset`) are never
a drawn rectangle. A bare `<div>` is untouched — an empty painted div really
can be a rectangle, and Figma refuses inside-drops on rectangles too.

### 3. Layers panel reversed auto-layout children

Measured in real Figma on a fresh page first:

```
3 loose texts, left→right Alpha Bravo Charlie
  Figma panel: Charlie Bravo Alpha        paint order
Shift+A (wrap in auto layout)
  Figma panel: Alpha Bravo Charlie        layout order; X = 0 / 260 / 520
```

The app reversed unconditionally, so dragging a nav link to the top of the list
moved it to the **end** of the nav. Fixed by skipping the L5 reversal — and the
before/after and multi-drag inversions written to agree with it — when the
parent is flex/grid. One consequence handled: L10 resolves an expanded
container's bottom zone to "inside"; under flow order that zone sits above the
FIRST child, so for a flow container it now targets the first child with
"before".

### 4. Editing padding erased the other axis — data loss

```
before: padding:24px                       rendered 24px
Left/Right field reads 0px                 <- wrong, it is 24
set Left/Right = 48
after:  padding-top: 0px; padding-right: 48px;
        padding-bottom: 0px; padding-left: 48px
        rendered 0px 48px                  <- vertical padding destroyed
```

Instrumented the reader:

```
shorthand  keys: ["padding"]                     <- no longhands at all
longhand   keys: ["padding-left","paddingLeft", …]
```

A missing longhand read as `0`, indistinguishable from an authored zero, and
the writer committed that `0` over the axis the user never touched. Fixed in
`cssStyleAliases`, which already expanded `background` and `font` with the
browser's own parser.

### 5. Asymmetric corner radius displayed as uniform

`border-radius: 12px 4px` renders 12/4/12/4 but every per-corner read is
`styles.borderTopLeftRadius || styles.borderRadius`, so all four showed `12`.
Same expansion fix. **Display-only** — the write path was measured before
assuming it matched #4, and it is correct (setting Top left to 30 produced
`30px 4px 12px` = TL30/TR4/BR12/BL4).

No unit test: jsdom does not expand `border-radius` (it does expand `padding`),
so the assertion would have been vacuous. Verified in the real browser and
baselined by reverting just that block.

### 6. Screen root exempt from #3

The commonest landing-page shape — the body as a vertical stack:

```
body: display:flex; flex-direction:column
visual:            Alpha Bravo Charlie
panel BEFORE fix:  Charlie Bravo Alpha
panel AFTER fix:   Alpha Bravo Charlie
absolute root (control): Charlie Bravo Alpha   <- still reversed, correct
```

The `<body>` that owns the flow is compacted out of the tree, so nothing
carried its flow-ness. The screen row now carries the body's layout; single
view, which lists those children at the panel root with no screen row, gets the
flag directly.

---

## Logged, deliberately not fixed (2)

### Breakpoint edits write an unscoped base style

```
click 810 -> Base(aria-pressed=false) 810(aria-pressed=true)   scope active
select Hero -> ["Hero"]                                        right node
set Gap = 80   [1440: 24→80]  [810: 24→80]                     base changed
click Vertical [1440: column] [810: column]                    base changed
persisted: flex-direction: column; gap: 80px  class:(none)  @media:(none)
```

Should scope to `≤ next-wider width − 1`. Not fixed: the substrate
(`commit-styles-to-selected-layers.ts`, `activeBreakpointWidthState`,
`breakpointUpperBoundPx`) carries `BP-DEEP` comments suggesting in-flight work,
and a wrong guess writes silently-wrong CSS into real documents.

### Layers-row menu lacks `Add auto layout`

Code side is trivial and follows the existing pattern. Blocked on UI copy in
nine locales that cannot be authored against unknown product terminology. The
command is reachable via `Shift+A` and the canvas menu.

---

## Partially traced

**`Swap instance` does nothing from the canvas context menu**, while the
inspector's own `Swap instance` button opens the picker (a dialog listing
`BravoCard 1`). Annotations are correct — main carries `component-id`, the
`Cmd+D` copy carries `component-ref` — and context-menu `Detach instance`
works, which shares the identical `selectedInstanceActionNodeId` guard, so the
handler's early return is ruled out. Cause is in the
`componentSwapPickerRequest` → `setSwapPickerOpen(true)` path; leading
hypothesis is the closing context menu immediately dismissing the popover.

---

## Retracted before becoming false reports (8)

| Claim | What was actually wrong |
| --- | --- |
| Persistence broken | Read the post-reload DOM, which showed optimistic state |
| Figma refuses child drops | Read Figma's parent-relative child coords as absolute; drops landed on empty canvas |
| App requires select-then-drag | The failing press was 8px from a frame edge — the resize-handle zone |
| Components don't propagate | `Cmd+D` places the copy at identical coords; the click hit the copy, not the main |
| Three menu items "disabled" | Five mutations against one design; `Hide` ran first |
| Text colour picker broken | Picker sat at y≈908 in a 772px viewport; never scrolled into view |
| Constraints popover never opens | It is a toggle (`aria-pressed`), and pins are SVG where `offsetParent` is null |
| Breakpoint override leaks to base | The chip never switched scope; it was a base edit, so writing base was correct |

Plus two self-inflicted misses worth naming: a design **titled** "breakpoints"
matched a control-label search (the document-title button got clicked, and the
feature was read as inert), and a `str.replace` that silently matched nothing
left an unpatched helper under test.

---

## Verification that closed the session

- Unit suite **8759 passed**; the only 16 failures are pre-existing stale
  `.generated/bridge` artifacts that fail identically with the work stashed.
- Blast radius of the ordering change, nine specs run twice:

```
with changes   33 passed   7 failed   8 did not run
at HEAD        34 passed   6 failed   8 did not run
```

  Exactly one regression, a stale assertion frame, corrected → 11 passed.
