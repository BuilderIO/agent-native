# Locating the cause and verification discipline

Reading source to find *why* a gesture failed is slow and often wrong. The
fastest tool is a temporary `console.warn` at the boundary, read back over CDP.

Two defects in one session were cracked in minutes this way after source
reading had stalled:

```
// at the panel's drop boundary
[LPDBG] drop nodeType:"shape"  canDropInside:false  placement:"before"   // empty
[LPDBG] drop nodeType:"frame"  canDropInside:true   placement:"inside"   // filled
```

That one line identified the classifier as the culprit after four
permissive-looking gates had been read and cleared.

Delete only the lines you added the moment you have the answer, and check
`git diff` shows nothing else changed in that file.

## Verification discipline (each rule = one retracted claim)

- **Verify against persisted files via `get-design`, never the DOM.** A
  post-reload DOM can show optimistic state. "Persistence is broken" was
  retracted this way.
- **Dump ALL controls before calling one missing** — read
  `aria-label || innerText || title`, and make the *clicker* derive labels the
  **same way as the dumper**. `Add breakpoint` is a `title` tooltip; a clicker
  reading only the first two reported `absent` for a control the dump had just
  printed.
- **A filtered scan is not evidence of absence.** A scan that skipped elements
  with child nodes missed the same button entirely.
- **Hit-test before concluding "broken":** `scrollIntoView`, then assert
  `document.elementFromPoint(cx, cy)` actually hits the element — accepting
  `el === top || el.contains(top) || top.contains(el)`. The third clause matters:
  Tooltip-wrapped buttons return the wrapping `<span>`, which false-negatives a
  working control.
- **Assert what is selected before any per-element command.** A single click
  selects the *container*; double-click drills in. `Cmd+D` duplicated a whole
  nav because the child was never selected.
- **Assert the mode and the scope.** Overview vs single view behave differently,
  and a breakpoint chip must be *provably* active (`aria-pressed`) before you
  believe an edit was scoped.
- **Fresh design per mutating action.** Five mutations against one design once
  produced three false "disabled" results, because `Hide` ran first.
- **Never name a fixture something that collides with UI text.** A design titled
  "breakpoints" matched a control-label search; the document-title button got
  clicked and the feature was read as inert.
- **Assert match counts on scripted patches.** A silent `str.replace` that
  matched nothing left an unpatched helper under test and produced conclusions
  from it.
- **An unopened screenshot is not evidence**, and neither is another agent's
  summary of one. Name the images you actually looked at.
- **Baseline before blaming yourself — and before blaming the app.** Stash only
  the product files and re-run; several failures are pre-existing.

The ratio from the session that wrote these rules: eight retractions to six
real defects. Assume your first reading is wrong until the preconditions are
asserted. Its full evidence is in `.agents/skills/design-clip-repro/session-findings.md`; those
are worked examples of the method, not a list of open bugs.
