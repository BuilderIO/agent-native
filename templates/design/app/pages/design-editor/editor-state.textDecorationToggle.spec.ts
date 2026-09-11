/**
 * editor-state.textDecorationToggle.spec.ts
 *
 * BUG-DOUBLE-TOGGLE-RACE — a second Cmd+U (toggle underline) press within
 * ~1s of the first silently no-ops instead of removing the underline.
 *
 * Root cause: commitVisualStyles commits Cmd+U/Cmd+Shift+X through the
 * SHORTHAND "textDecoration" property, but its synchronous optimistic patch
 * to selectedElement.computedStyles only merges the exact key(s) it
 * committed ("textDecoration") — it never decomposes that shorthand into the
 * LONGHAND "textDecorationLine" the toggle handler reads to decide its next
 * value. `computedStyles.textDecorationLine` only catches up once the
 * bridge's async getComputedStyle round trip lands. A second press inside
 * that window recomputes nextTextDecorationLineValue from the STALE
 * pre-toggle value, lands on the exact value the first press already
 * committed, and the style-commit pipeline dedupes it as a no-op.
 *
 * resolveOptimisticTextDecorationLine (DesignEditor.tsx's
 * handleToggleUnderlineHotkey/handleToggleStrikethroughHotkey now call this)
 * fixes it by preferring a still-fresh value OUR OWN previous toggle just
 * recorded for the SAME selected element over the possibly-stale
 * computedStyles reading. These tests drive it together with the real
 * (unmodified) nextTextDecorationLineValue to pin the exact double-toggle
 * sequence QA hit — both "before" (pass plain computedStyles, no tracking —
 * the old, buggy behavior) and "after" (thread the resolver through, the
 * fixed behavior).
 */
import { describe, expect, it } from "vitest";

import { nextTextDecorationLineValue } from "../../components/design/edit-panel/typography-helpers";
import {
  resolveOptimisticTextDecorationLine,
  type OptimisticTextDecorationLineEntry,
} from "./editor-state";

const ELEMENT_KEY = "node-42";

describe("BUG-DOUBLE-TOGGLE-RACE — Cmd+U rapid re-toggle", () => {
  it("BEFORE FIX: reading raw (stale) computedStyles for both presses computes the same target twice", () => {
    // Simulates the old handler: always reads selectedElement.computedStyles
    // directly, ignoring what it just committed. computedStyles never
    // updates between the two presses in this reproduction (the async
    // bridge round trip hasn't landed yet), so both presses see "none".
    const staleComputedTextDecorationLine = "none";

    const firstPressTarget = nextTextDecorationLineValue(
      staleComputedTextDecorationLine,
      "underline",
    );
    const secondPressTarget = nextTextDecorationLineValue(
      staleComputedTextDecorationLine,
      "underline",
    );

    expect(firstPressTarget).toBe("underline");
    // Bug reproduced: the second press computes the SAME value as the
    // first instead of toggling it back off — a downstream no-value-change
    // dedupe would make this a silent no-op.
    expect(secondPressTarget).toBe(firstPressTarget);
  });

  it("AFTER FIX: the optimistic tracker makes the second press read the just-committed value and toggle back off", () => {
    let tracked: OptimisticTextDecorationLineEntry | null = null;
    const staleComputedTextDecorationLine = "none"; // still hasn't refreshed

    // First Cmd+U press.
    const firstCurrent = resolveOptimisticTextDecorationLine(
      tracked,
      ELEMENT_KEY,
      staleComputedTextDecorationLine,
    );
    const firstPressTarget = nextTextDecorationLineValue(
      firstCurrent,
      "underline",
    );
    tracked = { key: ELEMENT_KEY, value: firstPressTarget };
    expect(firstPressTarget).toBe("underline");

    // Second Cmd+U press, still before computedStyles has refreshed.
    const secondCurrent = resolveOptimisticTextDecorationLine(
      tracked,
      ELEMENT_KEY,
      staleComputedTextDecorationLine,
    );
    const secondPressTarget = nextTextDecorationLineValue(
      secondCurrent,
      "underline",
    );
    tracked = { key: ELEMENT_KEY, value: secondPressTarget };

    // Fixed: alternates back to "none" instead of repeating "underline".
    expect(secondPressTarget).toBe("none");
  });

  it("underline and strikethrough toggles compose on the shared tracked value instead of clobbering each other", () => {
    let tracked: OptimisticTextDecorationLineEntry | null = null;
    const staleComputedTextDecorationLine = "none";

    const afterUnderline = nextTextDecorationLineValue(
      resolveOptimisticTextDecorationLine(
        tracked,
        ELEMENT_KEY,
        staleComputedTextDecorationLine,
      ),
      "underline",
    );
    tracked = { key: ELEMENT_KEY, value: afterUnderline };

    // Toggling strikethrough immediately after, still before any real
    // computedStyles refresh, must ADD line-through alongside underline
    // rather than reverting to just line-through.
    const afterStrikethrough = nextTextDecorationLineValue(
      resolveOptimisticTextDecorationLine(
        tracked,
        ELEMENT_KEY,
        staleComputedTextDecorationLine,
      ),
      "line-through",
    );
    tracked = { key: ELEMENT_KEY, value: afterStrikethrough };

    expect(afterStrikethrough.split(" ").sort()).toEqual(
      ["line-through", "underline"].sort(),
    );
  });

  it("falls back to computedStyles for a newly selected different element", () => {
    const tracked: OptimisticTextDecorationLineEntry = {
      key: ELEMENT_KEY,
      value: "underline",
    };
    // A different element's own real computed value must win — the tracked
    // entry belongs to the PREVIOUS selection, not this one.
    expect(
      resolveOptimisticTextDecorationLine(tracked, "node-99", "line-through"),
    ).toBe("line-through");
  });

  it("falls back to computedStyles when nothing has been tracked yet", () => {
    expect(
      resolveOptimisticTextDecorationLine(null, ELEMENT_KEY, "underline"),
    ).toBe("underline");
  });
});
