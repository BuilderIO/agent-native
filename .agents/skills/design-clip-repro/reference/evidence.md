# Evidence rules and report shape

Text assertions cannot see paint order, clipping, overlap, a layer behind its
sibling, or "structurally right but looks wrong". Those defects pass every DOM
check. **Capture every interaction on both sides and open the images.**

### Two kinds of claim, two authorities

Getting this wrong in either direction is how sessions go bad.

| Claim                                                     | Authority                                                        | A screenshot is…                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| "it persisted", "the node moved", "the attribute is set"  | persisted file via `get-design`, computed style, geometry number | not enough — it also hides whatever is off-screen    |
| "Figma does X", "these look the same", "it renders wrong" | **the captured image**                                           | the only valid evidence; a DOM read cannot answer it |

So: never close a _state_ question with a picture, and never close a _visual or
Figma-behaviour_ question without one.

### Non-negotiable rules

1. **Every interaction in the repro gets a capture, both sides.** Not the run —
   each interaction. The report lists both paths per item so the user can check
   them.
2. **"Saved" is not "looked at".** An image you did not open with `Read` has
   told you nothing. State explicitly which images you opened.
3. **No claim about Figma without a Figma capture or a measured inspector
   value.** Inferring Figma's behaviour from the clip, from a frame reader, or
   from memory is banned. "Figma behaves the same here" is the single most
   expensive sentence you can write unmeasured — one capture settles it.
4. **Never accept a subagent's written summary as the basis for a claim.** If a
   delegated agent reports "verified, matches Figma", that is a pointer, not
   evidence: open the images it saved.
5. **Run a noticing pass on each finished interaction.** Look at the canvas for
   what nobody was hunting — a fill painting the wrong box, corners that should
   not be round, a shifted baseline. Defects found this way are the ones the
   user would otherwise find first.

### Capture

`.agents/skills/design-clip-repro/harness/shot.mjs` returns report-ready paths:

```js
import { shots } from ".agents/skills/design-clip-repro/harness/shot.mjs";
const cap = shots("drag-into-col"); // writes under templates/design/.tmp/parity/shots
await cap.app(page, "before");
/* …gesture… */
const path = await cap.app(page, "after"); // then Read it
```

Figma captures use the branch browser, so they run under
`withLock("osmouse", …)`. App captures work headless and are parallel-safe.

Then open both and compare. When they disagree, get the **numbers** before
theorising — `getComputedStyle` on one side, Figma's inspector fields on the
other. "Looks 4px off" is usually a different padding model, not a bug.

### Report shape

Every item in a pass/fail list carries its evidence:

```
PASS  drag card into auto-layout column
      app:   templates/design/.tmp/parity/shots/drag-col-app.png
      figma: templates/design/.tmp/parity/shots/drag-col-figma.png
      persisted: col children = [card1, dragged, card2]
FAIL  pasted vector keeps its fill
      app:   templates/design/.tmp/parity/shots/vec-app.png     <- fill paints the bounding box
      figma: templates/design/.tmp/parity/shots/vec-figma.png   <- fill follows the path
```

A finding without both paths is not reportable.
