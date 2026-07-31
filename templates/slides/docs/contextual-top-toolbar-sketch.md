# Slides — Contextual Top Toolbar (design sketch)

Status: **sketch only, no code**. Purpose is to lock down what the ask actually
is before anyone builds it.

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

## 9. Suggested build order (once agreed)

1. `SlideContextToolbar.tsx` — presentational, driven by
   `SlideStyleInspectorSnapshot`, reusing the existing `onChange` /
   `onArrange` callbacks so no editing logic is rewritten.
2. Mount it as row 2 in `DeckEditor.tsx`; remove the `w-[17rem]` dock and the
   `🎨` toggle from row 1.
3. Grouped menus (align, arrange, overflow) on shadcn primitives.
4. Slide context state (§4a) + warning chip.
5. Responsive collapse.
6. Update `.agents/skills/slide-editing` so the agent describes the new surface
   correctly, and add a changelog entry.
   </content>
   </invoke>
