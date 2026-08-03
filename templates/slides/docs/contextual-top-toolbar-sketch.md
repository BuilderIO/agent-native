# Slides — Contextual Top Toolbar (design sketch)

Status: **M1–M5 shipped** as `app/components/editor/SlideContextToolbar.tsx`,
mounted from `SlideEditor.tsx`. The style dock is still reachable behind the
row-1 paint toggle and is mutually exclusive with the toolbar. Sections 1–8
record the original ask and design reasoning; §9 records the plan and what
actually landed.

Still open, by decision rather than oversight: multi-select styling and
distribute (both new capability, not relocation), absorbing the row-1 cog's
slide properties, the stable insert segment, narrow-screen support, and
retiring the dock.

---

## 1. What was asked (digest of the thread)

**Sajal's original feedback (tldr):**

- If **AI-based editing** is the primary way users work: a side-pane style panel
  is good for _experimenting_, but it does not fit Agent Native's three-pane
  layout (slide rail + canvas + agent chat). In that world, **contextual style
  controls belong at the top**, scoped to the selected element, for precise
  tweaks.
- If **manual creation** is the primary way users work: keep the style tab in
  the side pane, but pinned open all the time (Figma-style) for fast access.
- Alternate: small inline AI input + a Figma-style always-open side panel. He
  flagged a real problem with the side-panel path — at the end the user needs a
  **big slide**; zooming in/out to make room for panels destroys the relative
  visual feel of a slide.

**Clarification:** Steve asked which option; Sajal confirmed he meant the
**second sub-bullet — top controls**.

**Steve's framing:** possibly two modes — a "design mode" with sidebar and a
default mode with controls on top. Asked for a mock.

**Sajal's mock + constraints:**

- "Something like this, **but it needs to be contextual to the selected
  element**" (his example: a text layer).
- "**Needs more organization of tools if there are many**, like alignments."
  → group related tools behind a single control instead of a flat row.
- "**Please use app styling and icons**" — our existing design language and
  Tabler icons, not a Google Slides look-alike.

**Steve's assignment:** move our right style sidebar to a **top bar like Google
Slides**. Reference Google Slides only to make sure we cover the complete set of
inputs; keep our styling.

**The one open question, and its answer:** Sajal asked whether to add a small AI
input box into the toolbar. Steve: **no** — "you'll always want a long running
chat and not assume AI does a good job one-off."

> ### 🔒 Agreed scope
>
> **Chat stays in the right sidebar. Styling moves to a contextual top bar.**
>
> - Style controls are **contextual to the current selection**, not a fixed
>   panel.
> - Grouped/progressively disclosed when there are many tools (alignment,
>   spacing, arrange).
> - Our app styling + Tabler icons.
> - **No AI input box in the toolbar.** The one AI affordance that survives is
>   the existing contextual **"Fix with AI"** chip on a detected problem (e.g.
>   layout overflow), which is a suggestion, not a prompt box.
> - Freeing the right rail gives the canvas its full width back — this is the
>   actual win Sajal was after.

---

## 2. Where this lives today

| Thing                     | File                                                        | Notes                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Deck editor page          | `app/pages/DeckEditor.tsx`                                  | owns panel open/close state                                                                                                                |
| Existing top bar          | `app/components/editor/EditorToolbar.tsx:413`               | `h-11` single row: back, title, counter, slide-settings cog, tools, save/presence, style toggle, comments, export/share, Present, overflow |
| Style panel (to be moved) | `app/components/editor/SlideStyleInspector.tsx:260`         | `SlideStyleInspector` + `SlideBackgroundInspector`                                                                                         |
| Style dock mount          | `app/components/editor/SlideEditor.tsx:4201`                | `w-[17rem]` right dock, `hidden lg:block`                                                                                                  |
| Selection state           | `app/components/editor/SlideEditor.tsx:1117-1136`           | `selectedObjectId`, `selectedStyleSnapshot`, etc.                                                                                          |
| Selection modes           | `app/components/editor/slide-object-interactions.ts:58-143` | `single`, `multi`, `image`, `editing`, `box-selected`, `resizing`, `canvas`                                                                |
| Agent chat                | `app/components/layout/Layout.tsx:104`                      | `AgentSidebar position="right"` — **unchanged**                                                                                            |

The snapshot the panel already receives (`SlideStyleInspectorSnapshot`) carries
everything a top bar needs: `isText`, `isImage`, `isAbsolute`, geometry, colors,
type styles, `mixedTextStyles`. **No new state model is required** — this is a
re-presentation of an existing surface.

---

## 3. Layout: before → after

**Before** (three panes squeeze the slide):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Untitled Deck  2/3          ⚙ 🧰 💾 👤   🎨 💬  ⬆Export [Present] ⋯│
├──────┬──────────────────────────────────┬──────────┬─────────────────┤
│      │                                  │ STYLE    │                 │
│ ▤ 1  │                                  │ 17rem    │  AGENT CHAT     │
│ ▤ 2  │        slide (squeezed)          │ Position │                 │
│ ▤ 3  │                                  │ Layout   │  ...            │
│      │                                  │ Fill     │                 │
│      │                                  │ Stroke   │                 │
│      │                                  │ Type     │                 │
└──────┴──────────────────────────────────┴──────────┴─────────────────┘
```

**After** (style becomes a second toolbar row; canvas reclaims 17rem):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Untitled Deck  2/3          ⚙ 🧰 💾 👤      💬  ⬆Export [Present] ⋯│  deck bar (row 1)
├──────────────────────────────────────────────────────────────────────┤
│ ⊹ ▭ ╱ 🖼 │ Fit ▾ │ [T Text] A⁻32A⁺ B I U ⬤ ≡▾ ⧉▾ ⋯ │ ⚠ Overflow │ ⌃ │  row 2
│ └ insert (stable) ┘         └── contextual to selection ──┘             │
├──────┬───────────────────────────────────────────┬───────────────────┤
│ ▤ 1  │                                           │  AGENT CHAT       │
│ ▤ 2  │            slide (full width)             │                   │
│ ▤ 3  │                                           │  ...              │
└──────┴───────────────────────────────────────────┴───────────────────┘
```

Row 2 replaces the `🎨` style toggle in row 1. It has **two segments** — see
§3a; only the right segment changes with selection.

### 3a. Two segments, learned from the Google Slides reference

The Google Slides screenshot settles a structural question the first draft of
this doc got wrong. Its toolbar is **not** wholly contextual — it is split:

- **Stable segment (left):** zoom/`Fit`, select cursor, text box, shape, line,
  image, comment. These are _insert & canvas tools_. They never change, so
  muscle memory holds and the row never feels like it is jumping around.
- **Contextual segment (right of the divider):** in the screenshot nothing is
  selected, so it shows **Background · Layout · Theme · Transition** — i.e.
  slide-level properties. Select a text box and that same span is replaced by
  font, size, B/I/U, color, align, line spacing, lists, indent.

This is a direct confirmation of the model in §4 (one row, swapped by
selection) **plus** a correction: keep a fixed tools segment on the left rather
than making the entire row contextual. Two further details worth copying:

- **A collapse chevron (`⌃`) at the far right** hides the toolbar entirely.
  This matters more for us than for Google: Sajal's whole complaint is canvas
  real estate, and a second row spends vertical space to buy back horizontal
  space. A collapse control makes that trade reversible per-user.
- **An explicit zoom control (`Fit`).** We have no zoom in `EditorToolbar.tsx`
  today. Sajal specifically called out that ad-hoc zooming "removes the
  relative visual feel of slides" — a discrete `Fit / 50 / 100 / 200%` control
  addresses that better than free zoom does.

What we should **not** copy: the menu bar (File/Edit/View/Insert/…). Our
equivalents already live in the row-1 overflow and the agent, and a menu bar
would fight the app's styling.

---

## 4. Contextual states

Driven by `selectedStyleSnapshot` + selection mode. This is the **right-hand
segment** only; the insert tools and zoom on the left persist across all of
them. One component, five renders.

### 4a. Nothing selected → slide context

```
│ [▦ Slide]   Background ⬤▾   Layout ▾   Theme ▾   Transition ▾   Aspect ▾ │
```

Replaces `SlideBackgroundInspector`. Also absorbs the slide-level items
currently buried in the row-1 cog popover. This is almost exactly what Google
Slides shows in the no-selection state, which is a good sign we are not
inventing a novel idle state.

### 4b. Text element selected (Sajal's example)

```
│ [T Text]  │ Inter ▾ │ A⁻ 32 A⁺ │ B I U S │ ⬤ │ ≡▾ │ ⇕ 1.4 │ ⧉▾ │ ⋯ │
             font       size       weight/   color  align  line   arrange
                                   style                   height
```

- `≡▾` → menu: horizontal align L/C/R/Justify **and** vertical align T/M/B, plus
  align-to-slide. This is the "more organization … like alignments" note.
- `⧉▾` → arrange: bring to front / send to back.
- `⋯` → overflow: opacity, corner radius, stroke weight/color, padding X/Y,
  X/Y/rotation. Precise numeric scrubbers live here, not in the visible row.

### 4c. Image selected

```
│ [🖼 Image]  Replace │ Crop │ ⬤ Tint │ ⬡ 8px │ ◐ 100% │ ⧉▾ │ ⋯ │
```

No typography, no padding (matches today's `!snapshot.isImage` guard).

### 4d. Shape / generic object selected

```
│ [◻ Shape]  ⬤ Fill │ ▭ Stroke 1px ⬤ │ ⬡ Radius │ ◐ Opacity │ ≡▾ │ ⧉▾ │ ⋯ │
```

### 4e. Multi-select

```
│ [◻◻ 3 selected]   ≡▾ Align │ ⇹▾ Distribute │ ⬤ Fill │ ⧉▾ │ ⋯ │
```

Values that differ across the selection render as **Mixed** (the snapshot
already supports this via `mixedTextStyles`).

---

## 5. Control mapping — nothing gets lost

Every control in `SlideStyleInspector.tsx` has a destination. `●` = visible in
the bar, `▾` = inside a grouped menu, `⋯` = overflow popover.

| Today's section           | Control                    | Text              | Image    | Shape |
| ------------------------- | -------------------------- | ----------------- | -------- | ----- |
| Position                  | H align / V align          | ≡▾                | ≡▾       | ≡▾    |
| Position                  | X, Y, Rotation             | ⋯                 | ⋯        | ⋯     |
| Arrange                   | Front / Back               | ⧉▾                | ⧉▾       | ⧉▾    |
| Layout                    | Width, Height              | ⋯                 | ⋯        | ⋯     |
| Appearance                | Opacity                    | ⋯                 | ●        | ●     |
| Appearance                | Corner radius              | ⋯                 | ●        | ●     |
| Fill / Tint               | Color                      | ●                 | ● (tint) | ●     |
| Stroke                    | Weight, Color              | ⋯                 | ⋯        | ●     |
| Typography                | Color, Size, Weight, Align | ●                 | —        | —     |
| Typography                | Line height                | ●                 | —        | —     |
| Spacing                   | Padding X / Y              | ⋯                 | —        | ⋯     |
| Background (no selection) | Slide fill                 | slide context bar |          |       |

Gap vs. Google Slides worth deciding on (see §8): font family, italic/underline/
strikethrough, bullet & numbered lists, indent, text case, link, and
copy/paste-format.

---

## 6. Interaction rules

1. **Selection drives the bar.** Same source of truth as the panel today —
   `selectedStyleSnapshot` in `SlideEditor.tsx`. Selection is already mirrored
   to `slides-selection` application state, so the agent keeps seeing exactly
   what the user has selected. No change there.
2. **Row 2 does not reflow the canvas.** Fixed height, always rendered when a
   deck is open, so the slide does not jump when selection changes. Empty
   selection shows the slide context bar (§4a) rather than collapsing.
3. **Grouped menus, not a long row.** Any group with more than ~3 related
   controls becomes a single button + shadcn `Popover`/`DropdownMenu`. No
   custom absolute-positioned popovers.
4. **Overflow is responsive.** Below `lg`, the row collapses progressively into
   `⋯`; the identity chip (`[T Text]`) and the most-used 3 controls stay.
5. **Keep the inline warning chip.** The right-aligned `⚠ Layout overflows by
28px — Fix with AI` from the mock stays in row 2. It is contextual and
   dismissible; it is not a prompt box.
6. **Rich-text selection must survive.** Clicking the toolbar cannot blur the
   editable text. The dock already handles this via
   `preserveRichTextSelection` on `onPointerDownCapture`
   (`SlideEditor.tsx:4205`) — the top bar must carry the same guard, or
   bold-on-a-selection silently no-ops.
7. **Read-only decks** show the identity chip and nothing editable, matching the
   existing `canEdit` / `readOnly` behavior.
8. **The row is collapsible.** A `⌃` chevron at the far right hides row 2 and
   leaves a thin re-open affordance, per the Google Slides precedent. The state
   persists per user. This is the honest answer to "a top bar costs vertical
   space": let the user take it back when they are reviewing rather than
   editing.
9. **The left segment is stable.** Insert tools and zoom never re-order or
   disappear based on selection — only the segment right of the divider swaps.

---

## 7. Two modes — recommendation

Steve floated "design mode with sidebar + default mode on top."

**Recommendation: ship the top bar only, no mode switch.** Reasons: a mode
toggle doubles the surface to maintain and test, contradicts "keep template UX
clean and progressively disclosed," and the `⋯` overflow already gives precise
numeric control without giving up canvas width. If power users ask for the
pinned Figma panel later, the inspector components are unchanged and can be
re-mounted behind a flag — the decision is cheap to reverse.

---

## 8. Open questions to settle before building

1. **Do we add the missing Google-Slides-parity controls now?** Font family,
   italic/underline, lists/indent, link, text case. They do not exist in the
   inspector today, so adding them is net-new work beyond "move the panel."
   Suggest: **font family + italic/underline in v1**, lists/indent in v2.
2. **Do we add a zoom / `Fit` control?** Google has one; we have none. It
   directly answers Sajal's "zooming removes the relative visual feel" note,
   but it is net-new work and needs canvas-scaling support. Suggest v1 if
   cheap, otherwise fast-follow.
3. **Which insert tools belong in the stable left segment?** Candidates from
   the existing row-1 tools popover: text box, image/media, shape, draw, pin,
   comment. Moving them down means row 1 keeps only deck-level actions — a
   cleaner split, but a bigger diff in `EditorToolbar.tsx`.
4. **Does the slide-settings cog in row 1 get absorbed** into the slide context
   bar (§4a), or stay where it is? Absorbing is cleaner but touches
   `EditorToolbar.tsx` more.
5. **Mobile/narrow** — is a bottom sheet acceptable below `lg`, given the style
   dock is currently just hidden there?
6. **Do we keep any always-available entry to the full inspector** (e.g. a
   "More styles" item in `⋯` that opens the old panel as a popover), or is the
   panel fully retired?
7. **Which detections earn a warning chip** besides layout overflow?

---

## 9. MVP plan

### 9.0 Decisions (agreed)

| Decision            | Choice                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Control set         | **Strict move only.** Relocate exactly today's controls. No font family, italic/underline, or lists in v1.                    |
| Old right dock      | **Kept behind the existing paint toggle.** Top bar is the default; the dock stays reachable as a fallback and A/B comparison. |
| Narrow screens      | **Hidden below `lg`**, matching the dock's current `hidden lg:block`. Zero regression, zero extra work.                       |
| AI input in toolbar | **No** (Steve). Chat stays in the sidebar.                                                                                    |
| Zoom                | **Leave the existing floating cluster alone** in v1.                                                                          |

The MVP goal is to prove **one thing**: that contextual top controls beat a
right dock for this app. Everything that does not serve that test is deferred.

### 9.1 The key architectural finding

The first draft of this doc assumed the bar mounts in `DeckEditor.tsx` beside
`EditorToolbar`. That would require hoisting selection state out of
`SlideEditor.tsx` — a 4,200-line file — which is most of the risk in this
project.

It is unnecessary. `SlideEditor`'s root is already a flex **column**
(`SlideEditor.tsx:4055`) whose first child is the canvas row (`:4058`).
Inserting the bar as a new first child renders it directly beneath row 1
visually, while staying inside the component that already owns everything it
needs:

| Needed                      | Already exists at                     |
| --------------------------- | ------------------------------------- |
| `selectedStyleSnapshot`     | `SlideEditor.tsx:1117-1136`           |
| `applySelectedStylePatch`   | `SlideEditor.tsx:3855`                |
| `handleArrangeSelected`     | passed to the dock, `:4213`           |
| `preserveRichTextSelection` | `SlideEditor.tsx:3839`                |
| `applySlideBackground`      | passed to the dock, `:4225`           |
| Localized labels            | existing `styleInspector.*` i18n keys |

**No state lifting, no new actions, no new i18n keys, no schema change.** The
MVP is a presentational component plus a mount.

### 9.2 Scope

**In:**

1. `app/components/editor/SlideContextToolbar.tsx` — presentational, driven by
   `SlideStyleInspectorSnapshot`, calling the existing `onChange` / `onArrange`
   callbacks.
2. Contextual states from §4: text, image, shape/object, multi-select, and
   no-selection (slide background).
3. Grouped menus for align and arrange, plus a `⋯` overflow holding the
   numeric controls, on shadcn `Popover` / `DropdownMenu`.
4. Mount at `SlideEditor.tsx:4058`, gated on `!readOnly` and `lg`.
5. Mutual exclusion with the dock: opening the dock via the paint toggle hides
   the bar, so exactly one styling surface is visible. This gives Steve's "two
   modes" idea for free, without a new mode concept.

**Out (deferred, tracked in §8):** font family, italic/underline/lists/indent,
moving insert tools into a stable left segment, absorbing the row-1 cog,
narrow-screen support, moving zoom into the bar, the collapse chevron, and the
`⚠ Fix with AI` chip (needs the overflow detection to exist first).

### 9.3 Milestones

| #   | Milestone                                                               | Proves                                |
| --- | ----------------------------------------------------------------------- | ------------------------------------- |
| M1  | Component skeleton + mount + **text** state wired to real callbacks     | The mount point works and edits apply |
| M2  | Image, shape, multi-select, and no-selection states                     | Contextual swapping is correct        |
| M3  | Grouped align/arrange menus + `⋯` overflow                              | Sajal's "organize the tools" note     |
| M4  | Dock mutual exclusion + read-only + a11y labels/tooltips                | No regressions                        |
| M5  | Verification pass (§9.5), changelog entry, `slide-editing` skill update | Ship-ready                            |

### 9.4 Known traps

1. **Rich-text selection loss.** The bar must carry
   `onPointerDownCapture={preserveRichTextSelection}`, exactly as the dock does
   at `:4205`. Without it, bolding a partial text selection silently no-ops —
   it will look like the feature works until someone selects three words.
2. **Popover focus stealing.** Colour pickers in the dock pass
   `data-slide-inline-edit-surface="true"` via `contentProps`. Any popover in
   the bar needs the same marker or it will blur the editable element.
3. **Mixed values.** `mixedTextStyles` must still render a "Mixed" state; a bar
   is more likely than a panel to imply a single concrete value.
4. **Horizontal overflow.** Row 2 must not push row 1's layout or introduce a
   scrollbar at common widths — budget the visible control count against the
   narrowest supported `lg` width with the agent sidebar open.
5. **Agent parity.** Selection still syncs to `slides-selection` app state via
   `syncSelectionToAppState`. Do not bypass it — `view-screen` depends on it.

### 9.5 How we verify

Per `verifying-changes`, on the running slides dev server with a real deck:

- Select a text box, a heading, an image, a shape, and a multi-selection; confirm
  the bar swaps and every relocated control still applies to the slide.
- Select **part** of a text run and apply weight/colour — guards trap 1.
- Confirm mixed values render as Mixed across a multi-selection.
- Deselect; confirm slide background editing is still reachable.
- Open a read-only/shared deck; confirm no editable controls.
- Toggle the paint icon; confirm dock and bar are mutually exclusive.
- Ask the agent "what is selected?" and confirm it still answers correctly.

### 9.6 Open questions this MVP intentionally does not answer

§8 items 1–3 (new controls, zoom placement, insert-tool segment) stay open on
purpose. They are additive and easier to judge once the team has used the bar
on a real deck.

### 9.7 What actually landed, and where it deviated

Shipped in `SlideContextToolbar.tsx`, mounted at `SlideEditor.tsx:4059`:

- **No selection** — slide background picker.
- **Text** — size, weight, colour, alignment, then align/arrange/overflow.
- **Image / shape** — fill or tint, opacity, corner radius, stroke weight and
  colour, then align/arrange/overflow.
- **Grouped** — `≡` object alignment popover, arrange buttons, `⋯` overflow
  holding width/height, X/Y/rotation, padding, and the text-only appearance
  controls.

Deviations from the plan, each deliberate:

1. **No identity chip.** The first build showed the selected element's text
   preview. It leaked slide content into the chrome and neither Google Slides
   nor Sajal's mock has one. Removed.
2. **Multi-select dropped from M2.** `multiSelection` (`SlideEditor.tsx:1105`)
   never feeds `selectedStyleSnapshot`, so no multi-select styling exists in
   the app at all. Building it is new capability, which the "strict move"
   decision excluded.
3. **Alignment math is now shared.** `resolveHorizontalAlignment`,
   `horizontalAlignPatch`, and their vertical twins are exported from
   `SlideStyleInspector.tsx`; both the dock and the toolbar call them. Two
   independent implementations of "where is centre" would have drifted and put
   the same object in two different places depending on which surface you used.
4. **Unreadable backgrounds no longer claim to be black.** The dock passes
   `#000000` when `backgroundCssValue` returns null — but null means
   _unparseable_ (gradient, named utility), not black. The toolbar passes an
   empty value alongside `mixed`. The dock still has the original behaviour and
   is worth fixing separately.

**The trap worth remembering:** `VisualColorPicker`'s trigger is `w-full`
(`packages/toolkit/src/design-tweaks/visual-style-controls.tsx:481`). That is
correct for the vertical dock it was written for, and actively destructive in a
flex row — it expanded to 1095px of a 1119px toolbar and pushed every later
control out of view, which read as "the toolbar is empty after the swatch."
Any horizontal reuse of these toolkit controls must pin a width. This is the
sibling-instance risk in `fix-at-the-boundary`: the same assumption will bite
the next row-shaped surface.

`.agents/skills/` needed no update — no skill describes the styling UI, and
selection still syncs through `syncSelectionToAppState`, so `view-screen` and
`slides-selection` behave exactly as before.

---

## 10. Google Slides pass #2 — insert, add-slide, and File

Second reference screenshot (Google Slides with a deck open). This section is
about the **stable left segment** that §3a identified but §9.2 deferred, plus
the slide rail. Plan only — nothing here is built yet.

### 10.1 What Google puts where, vs. where we put it

| Google Slides                                                 | Our equivalent today                                                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+ ▾` new slide, first item in the toolbar                    | `+` in the **slide rail header** (`EditorSidebar.tsx:747`) → `AddSlidePopover`                                                                                                   |
| Undo / redo / print / paint-format / zoom `Fit`               | none in row 1 (history only via `⋯ → Saved versions`)                                                                                                                            |
| Insert cluster: cursor, text box, shape, line, image, comment | scattered: `T` text box (`EditorToolbar.tsx:748`), tools popover → draw / pin (`:788`), **cog popover** → media, generate image, asset library, mermaid, Excalidraw (`:560-668`) |
| `File` menu: import, download, version history, rename        | scattered: `⋯ → Import file` (`:990`), `⋯ → Saved versions` (`:997`), `ExportMenu` (`:902`), inline title field                                                                  |
| Background · Layout · Theme · Transition (no-selection state) | cog popover: layout, background, transition, aspect ratio (`:494-728`)                                                                                                           |

The thing worth borrowing is not the menu bar — §3a already rejected that. It
is that **every insert lives in one predictable place**. Today, inserting an
image or an Excalidraw canvas means opening a settings gear, which nobody would
guess.

### 10.2 Cross-check against what was already confirmed

Nothing below contradicts §1's agreed scope, and two items are already-open
questions rather than new ideas:

- **Sajal:** contextual controls on top, grouped when numerous, app styling and
  icons, no AI input box. ✔ unaffected — the insert segment is _stable_, not
  contextual, so it does not touch the contextual half of the row.
- **Steve:** move the right dock to a top bar, reference Google only for
  coverage. ✔ shipped in M1–M5; the dock is retired.
- **§3a** already concluded "keep a fixed tools segment on the left rather than
  making the entire row contextual." This section schedules that conclusion.
- **§8 Q3** ("which insert tools belong in the stable left segment?") and
  **§8 Q4** ("does the row-1 cog get absorbed?") are answered here.
- **§9.0's "strict move only"** still holds: everything below is _relocation_ of
  existing affordances. No new capability, no new action, no schema change.

### 10.3 The small first step (what was asked for) — **shipped**

S1 and S2 below both landed. `AddSlidePopover` moved out of `EditorSidebar.tsx`
into its own `AddSlidePopover.tsx` and is now triggered by a `+` at the head of
the toolbar; `addSlideGenerating` lifted to `DeckEditor.tsx` so the toolbar owns
the trigger while the rail still shows the generating placeholder. The rail
header is gone, the drag handle is a hover overlay instead of a reserved column,
and the rail is `w-48 sm:w-52`.

The contextual toolbar also moved to full width. It used to start where the
canvas started, leaving the slide rail sitting beside it; it now renders into a
slot in `DeckEditor.tsx` directly under the deck toolbar and spans the whole
window, as in Google Slides. Selection state was **not** lifted out of
`SlideEditor.tsx` — the toolbar is `createPortal`ed into that slot, which avoids
exactly the 4,200-line refactor §9.1 warned about.

> "start small. Maybe we can get rid of this part then make the slide
> containers on the sider objects smaller"

Read as: the slide rail is doing two jobs it should not. Two independently
shippable slices:

**S1 — retire the rail header.** `EditorSidebar.tsx:738-759` is a `SLIDES`
caption plus the `+` add button. Google has neither; a column of numbered
thumbnails is self-evidently the slide list. Move `AddSlidePopover` to a `+ ▾`
button at the head of the toolbar's stable segment, delete the header row. The
rail gains ~44px of vertical space and loses one piece of chrome.

**S2 — shrink the thumbnail rows.** Each row is `p-2` around three columns — a
grip, a 20px index/presence rail, and the thumbnail (`EditorSidebar.tsx:241-289`)
— inside a `w-56 sm:w-64` rail.

```
 before                                after
┌────────────────────────────┐        ┌──────────────────────┐
│ ⠿   1   ┌───────────────┐  │        │ 1 ┌────────────────┐ │
│         │   thumbnail   │  │        │   │   thumbnail    │ │
│         └───────────────┘  │        │   └────────────────┘ │
└────────────────────────────┘        └──────────────────────┘
  grip col + index col + p-2            index gutter only;
                                        grip overlaid on hover
```

- Drop the dedicated grip column — make the row itself draggable, or overlay
  the grip on hover instead of reserving width for it.
- Index moves to a narrow left gutter; presence avatars overlay the thumbnail
  corner instead of owning a column.
- `p-2` → `p-1.5`; `space-y-1` unchanged.
- Rail `w-56 sm:w-64` → `w-48 sm:w-52`. That width is the actual "smaller
  containers" win — the canvas gets the difference.

**Watch for:** the rail's `SlideRenderer` feeds `deck-fit-checks` app state via
`onOverflowChange` (`EditorSidebar.tsx:634`). Thumbnails are CSS-scaled rather
than re-rendered at a new size, so measurements should stay valid — but verify
it, because a wrong `viewportWidth` there makes the agent's overflow checks lie.
`resolveThumbRect` (`:671`) reads the button rect, so the recent-edit highlight
follows automatically.

### 10.4 Then: the stable insert segment

`SlideContextToolbar` already owns the row, so this is a new leading cluster,
not a new surface:

```
│ + ▾ │ ⌖ T ▭ ╱ 🖼 ✎ 💬 │ ⌇ │ …contextual (unchanged)… │
  add   insert cluster
```

- `+ ▾` — add slide: empty, duplicate, or AI (today's `AddSlidePopover`).
- Insert — text box (from `EditorToolbar.tsx:748`), image / generate image /
  asset library (from the cog), shape, line, Excalidraw + mermaid (from the
  cog), pin comment (from the tools popover).
- The cog then keeps only true slide properties — layout, background,
  transition, aspect ratio — or those fold into the no-selection contextual
  state per §4a and the cog disappears entirely. Prefer the latter; that is the
  answer to §8 Q4.

### 10.5 And: a File group

Google's `File` menu maps almost 1:1 onto affordances we already ship but have
scattered. Grouping them behind one labelled entry (our styling, a `Popover`,
not a menu bar):

- Import file → `⋯ → Import file` (`EditorToolbar.tsx:990`)
- Download / export → `ExportMenu` (`:902`)
- Version history → `⋯ → Saved versions` (`:997`)
- Rename → stays inline in the title field; listed here for discoverability

Pure regrouping. `Present` and `Share` stay standalone — they are the two most
clicked actions and burying them would be a regression.

### 10.6 Order, and what is still undecided

Ship order: **S1 → S2 → §10.4 → §10.5**. S1 and S2 are small, visible, and
reversible, and they make the case for §10.4 — once `+` is in the toolbar, the
insert cluster wants to sit next to it.

Open:

1. Does toolbar `+ ▾` fully replace rail-header add, or does the rail keep an
   "insert slide here" affordance between thumbnails on hover?
2. Should rail width be a user preference (draggable / collapsible) rather than
   a constant? `EditorToolbar.tsx:430` already has a rail show/hide toggle.
3. ~~Undo / redo — Google has them in the toolbar; we have them nowhere.~~
   **Wrong.** `DeckContext` already ships per-user inverse-op undo:
   `undo`/`redo`/`canUndo`/`canRedo` (`DeckContext.tsx:195-199`) bound to
   Cmd/Ctrl+Z and Cmd/Ctrl+Y (`:1730-1743`). There is no UI for it. See §11.

---

## 11. Three-row header (planned)

Requested after §10 shipped: a `+`, undo, and redo at the far left of the
toolbar row; `Tt` (add text box) moved down out of the deck row; and the header
split into a title row and a `File · Edit …` row with Share/Present at its right.

**Row structure — confirmed choice: three rows, Google-style.**

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Untitled Deck                                    3/10  💾 👤    │ row 1  title
├──────────────────────────────────────────────────────────────────┤
│ File  Edit  Insert  Slide  View            ⬆ Export  Share  ▶    │ row 2  menus + actions
├──────────────────────────────────────────────────────────────────┤
│ + ↶ ↷ │ Tt ▭ 🖼 ✎ 💬 │ 19px  B  ⬤  ≡▾  ⧉▾  ⋯ │        ⌃         │ row 3  contextual
├────────┬─────────────────────────────────────────────────────────┤
│ ▤ 1    │                                                         │
│ ▤ 2    │                    slide canvas                         │
└────────┴─────────────────────────────────────────────────────────┘
```

Row 3 already exists and already spans full width (§10.3). Rows 1 and 2 are a
split of today's single `EditorToolbar.tsx:431` row.

### 11.1 This reverses an earlier decision — deliberately

§3a said: "What we should **not** copy: the menu bar (File/Edit/View/Insert/…).
Our equivalents already live in the row-1 overflow and the agent, and a menu bar
would fight the app's styling."

That is now overruled by an explicit product call. The reasoning that makes it
defensible: §10.1 showed our inserts are genuinely undiscoverable — an image and
an Excalidraw canvas are both reached through a **settings cog**. A named menu
is a worse fit for the app's visual language but a much better fit for
findability, and findability is the actual complaint. Nothing in Sajal's or
Steve's confirmed scope (§1) forbids it; §3a was our own inference, not theirs.

**The cost is real and must be paid down.** Sajal's core complaint was canvas
real estate, and this adds a third row (~44px). Two mitigations, both already
designed in this doc:

- **§6.8's collapse chevron** stops being optional. Row 3 gets a `⌃` that hides
  it, persisted per user.
- Row 1 is thin (title + save/presence only), so it can shrink to `h-9`.

### 11.2 Menu contents — all relocation, one new UI

Everything here already exists somewhere. The only net-new UI is undo/redo
buttons, and even those wrap an existing API.

| Menu       | Items                                                                                           | Where they live today                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **File**   | Import file, Export (PDF / PPTX / Google Slides), Version history, Duplicate deck, Rename       | `⋯ → Import file` (`EditorToolbar.tsx:1064`), `ExportMenu` (`:972`), `⋯ → Saved versions` (`:1068`), title input |
| **Edit**   | Undo, Redo, Duplicate slide, Delete slide                                                       | `DeckContext.undo/redo` (`:195-199`, no UI), rail row hover actions                                              |
| **Insert** | Text box, Image, Generate image, Asset library, Mermaid diagram, Excalidraw canvas, Comment pin | `T` (`:818`), cog popover (`:548`), tools popover (`:858`)                                                       |
| **Slide**  | Layout, Background, Transition, Aspect ratio, New slide, Speaker notes                          | cog popover (`:548`)                                                                                             |
| **View**   | Show/hide slide rail, Theme, Present                                                            | rail toggle (`:430`), `⋯ → theme` (`:1073`), Present (`:1024`)                                                   |

After this, **the cog and the tools popover are both empty and get deleted** —
that is §8 Q4 answered by attrition rather than by argument.

### 11.3 Row 3's stable left segment

```
│ + ↶ ↷ │ Tt ▭ ╱ 🖼 ✎ │ …contextual… │
  add/history  insert
```

- `+` — already built (§10.3); it moves from row 1 down to row 3.
- `↶ ↷` — new buttons, `disabled={!canUndo}` / `!canRedo`, calling the existing
  context methods. Tooltips must show the existing shortcuts.
- `Tt` — moves out of row 1 (`:818`); the `T` keyboard shortcut is unchanged.
- The rest of the insert cluster is §10.4, unchanged.

Duplication is intentional and matches Google: undo lives in both `Edit` and the
toolbar; insert items live in both `Insert` and the toolbar.

### 11.4 Milestones

| #   | Milestone                                                                  | Proves                                      |
| --- | -------------------------------------------------------------------------- | ------------------------------------------- |
| N1  | Split `EditorToolbar` into a thin title row + an actions row; no new items | The split holds without regressions         |
| N2  | **Shipped.** `+`, undo, redo, and `Tt` in row 3's stable left segment      | The requested left cluster, and undo has UI |
| N3  | `File` and `Edit` menus, sourced from existing handlers                    | Relocation loses nothing                    |
| N4  | `Insert`, `Slide`, `View`; delete the cog and tools popovers               | The undiscoverable-insert problem is fixed  |
| N5  | Row 3 collapse chevron + narrow-screen behavior; changelog                 | The vertical-space cost is paid back        |

**N2 as built** — `EditorActionCluster.tsx` holds `+`, undo, redo, and `Tt`.
`DeckEditor` passes it into `SlideContextToolbar`'s new `leading` slot via
`SlideEditor`, and `EditorToolbar` renders a second instance marked `lg:hidden`
(or always visible on Excalidraw slides, where row 3 does not render) so trap 4
below never bites. Trap 3 is resolved the way §11.5 recommends: `commitThenRun`
blurs an active editable before calling `undo`, so the click commits the typing
and then undoes it, rather than undoing the previous deck op behind it.

Two surprises worth recording. `editorToolbar.undo` / `undoWithShortcut` already
existed in all 11 catalogs with no code referencing them — a previous undo UI
left its strings behind, so N2 needed **zero** new i18n keys. And the T shortcut
and `data-toolbar-textbox-button` hook moved with the button unchanged.

### 11.4a Density feedback (Steve + Sajal, after N2) — **shipped**

Both flagged the row as too horizontal, and both asked for the same fixes:

- **Colour pickers show only the swatch.** No hex text, no caret. This needed a
  new `variant="swatch"` on the toolkit's `VisualColorPicker` — additive, the
  `outline`/`filled` variants are untouched. Note this is the _same control_
  whose `w-full` trigger caused the §9.7 overflow bug; the swatch variant fixes
  that class of problem at the source for any future row-shaped surface.
- **Font weight is one value + dropdown**, not four segmented buttons.
- **Text alignment is one icon + dropdown**, using standard align icons.
- **Undo/redo buttons removed** from N2's cluster and moved into the row-1 `⋯`
  overflow — "Ctrl+Z is standard" (Sajal), agreed by Steve. The buttons lasted
  one review cycle. `commitActiveEditThenRun` moved to its own module and still
  guards the menu items, so the typing-vs-deck-op trap stays fixed.

The cluster is now `+ │ Tt`. Undo/redo keep their keyboard shortcuts and now
show them in the overflow labels via the previously orphaned
`editorToolbar.undoWithShortcut` strings.

### 11.5 Known traps

1. **`EditorToolbar.tsx` is 1,000+ lines already.** Splitting into two rows
   inside one component will make it worse. N1 should extract `DeckTitleRow` and
   `DeckMenuRow` as siblings rather than nesting another div.
2. **Menu keyboard behavior.** A real menu bar needs arrow-key traversal between
   menus, not five independent `DropdownMenu`s. shadcn ships `Menubar` — use it
   rather than hand-rolling, or accept that it is just five dropdowns and do not
   call it a menu bar in the a11y tree.
3. **Undo's `isTyping` guard.** `DeckContext.tsx:1727` deliberately lets
   contenteditable and inputs handle their own undo. A toolbar button has no
   such guard, so clicking undo mid-text-edit will undo the _deck op_, not the
   typing. Decide this explicitly before N2 ships.
4. **Narrow screens.** Row 3 is `hidden lg:block`. If `+`, undo, and `Tt` move
   there, they vanish below `lg` — where they are reachable today. Either keep a
   minimal row-2 fallback or make row 3 responsive first.
5. **i18n.** Every menu label is a new key across 11 catalogs
   (`guard:i18n-catalogs` enforces parity).
6. **Three rows on short laptops.** At 800px tall, 44+44+40+rail leaves little
   canvas. N5 is not optional polish.
