import { describe, expect, it } from "vitest";

import { resolveBackgroundPanelScope } from "./EditPanel";

/**
 * The nothing-selected panel used to pick its background section by whether an
 * `onCanvasBackgroundChange` callback was passed — a permission signal, not a
 * scope one. That handed read-only viewers the screen's fully wired document
 * controls (background stack, blend mode, font, base size) and left editors
 * with the board colour.
 */
describe("resolveBackgroundPanelScope", () => {
  it("addresses the board surround on the infinite canvas", () => {
    expect(
      resolveBackgroundPanelScope({
        viewMode: "overview",
        mode: "edit",
        readOnly: false,
      }),
    ).toBe("canvas");
  });

  it("addresses the open screen's document when editing one screen", () => {
    expect(
      resolveBackgroundPanelScope({
        viewMode: "single",
        mode: "edit",
        readOnly: false,
      }),
    ).toBe("document");
  });

  it("keeps the surround in the responsive interactive view, which is not an editing surface", () => {
    // `single` standalone is the responsive view; only a host-embedded editor
    // stays in `edit` there, so mode is what separates the two.
    expect(
      resolveBackgroundPanelScope({
        viewMode: "single",
        mode: "interact",
        readOnly: false,
      }),
    ).toBe("canvas");
  });

  it("offers no background section to a viewer, in any scope", () => {
    for (const viewMode of ["overview", "single"] as const) {
      for (const mode of ["edit", "interact", "annotate"] as const) {
        expect(
          resolveBackgroundPanelScope({ viewMode, mode, readOnly: true }),
        ).toBeNull();
      }
    }
  });
});
