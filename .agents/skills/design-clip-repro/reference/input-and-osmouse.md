# Input layers, osmouse and the one browser

### One browser, one cursor

`openEditor()` launches its own headless Chromium and injects the session from
the REST login, so Design-app probes can run in parallel. **Figma and osmouse
share the one branch browser and must hold the lock:**

```js
import { withLock } from ".agents/skills/design-clip-repro/harness/lock.mjs";
import { open } from ".agents/skills/design-clip-repro/harness/figlib.mjs";
await withLock("osmouse", async () => {
  const F = await open(); // attaches to the Figma tab, closes coach marks
  /* … drive Figma … */
});
```

`HEADED=1` switches `dlib` to the branch browser too — for watching a run, or
when a gesture genuinely needs a real cursor. Treat `HEADED=1` as taking the
lock. Never call `bringToFront()` outside it, and never close tabs you did not
open. If you delegate to subagents, open the screenshots they saved before
repeating any of their claims.

## Choosing the input layer (this decides whether you waste a day)

| Interaction                           | Use                                | Why                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layers-panel row drag (HTML5 DnD)     | Playwright `locator.dragTo()`      | CDP `Input.dispatchMouseEvent` produces `isTrusted:true` pointer events but **cannot** drive HTML5 drag-and-drop. `dragTo` uses `Input.dispatchDragEvent`, which can.                                  |
| Canvas pointer drag in the design app | `page.mouse.move/down/…/up`        | The canvas listens to pointer events; synthetic CDP events work fine.                                                                                                                                  |
| Figma's canvas                        | `page.mouse` on the branch browser | Measured: a CDP drag asked +150,+80 moved the node exactly +150,+80. Earlier "Figma ignores synthetic input" readings were OS clicks silently dropped, or drags swallowed by an onboarding coach mark. |
| Anything needing real window focus    | **osmouse**                        |                                                                                                                                                                                                        |

**The single most useful fact:** almost nothing needs osmouse, in the app or
in Figma. Keep it for a gesture you have proven fails under CDP.

### osmouse

OS-level input. In a Fusion branch it is `.agents/skills/design-clip-repro/harness/osmouse-linux`,
which drives display `:99` through xdotool. On a Mac it is a Swift `CGEvent`
wrapper you build once from `harness/osmouse.swift` (see `SKILL.md`), and the
terminal app needs Accessibility permission. Subcommands: `pos`, `trusted`, `move`, `click`, `down`, `dragto`,
`jiggle`, `up`, `drag`. It drives the one cursor, so **always hold
`withLock("osmouse", …)`**. The harness exports `osm` and `scr` (page
coordinates to screen coordinates).

Never trust an osmouse drag that did not prove it grabbed something — see
`verifiedDrag` in `harness-recipes.md`: press, nudge 24px, re-read geometry, and
**refuse to report a result** if nothing moved.
