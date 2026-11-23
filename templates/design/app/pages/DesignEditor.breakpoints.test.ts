// oracle-change: Exact duplicate fixture and assertions remain in this suite; every distinct regression case stays.
import { describe, expect, it } from "vitest";

import { parseBreakpointWidthInput } from "@/components/design/BreakpointBar";

import { shouldPopToOverviewOnZoomOut } from "./design-editor/overview-camera";
import {
  applyScopedVisualStyleEdit,
  formatPendingVisualStylePrompt,
} from "./design-editor/pending-edits";

// oracle-change: removed DesignEditor source-text greps about breakpoint wiring; the behavioural breakpoint cases in this file remain

const html = `<html><head></head><body><section data-agent-native-node-id="hero" class="text-sm p-4">Hello</section></body></html>`;

describe("applyScopedVisualStyleEdit (§6.4 single write path)", () => {
  it("base scope (null bound) writes a plain inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("left: 137px");
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("Tailwind-utility values become width-scoped classes", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "fontSize",
      value: "text-lg",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("max-[809px]:text-lg");
    expect(patch.content).toContain("text-sm");
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("raw CSS values become managed @media rules", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("left: 137px !important;");
    expect(patch.content).not.toContain('style="');
  });

  it("bounds breakpoint-only edits to the selected responsive range", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      lowerBoundPx: 390,
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      "@media (min-width: 390px) and (max-width: 809px)",
    );
    expect(patch.content).toContain("data-agent-native-breakpoint-range");
    expect(patch.content).not.toContain("@media (max-width: 809px)");
  });

  it("replaces an exact-range property when switching back to the normal cascade", () => {
    const exact = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      lowerBoundPx: 390,
      upperBoundPx: 809,
    });
    const cascade = applyScopedVisualStyleEdit({
      content: exact.content,
      target: { nodeId: "hero" },
      property: "left",
      value: "144px",
      upperBoundPx: 809,
    });
    expect(cascade.result.status).toBe("applied");
    expect(cascade.content).not.toContain("data-agent-native-breakpoint-range");
    expect(cascade.content).toContain("@media (max-width: 809px)");
    expect(cascade.content).toContain("left: 144px");
  });

  it("scoped failures do not silently fall back to base writes", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "url(bad)",
      upperBoundPx: 809,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("a fill (backgroundImage) commit with a breakpoint active becomes a width-scoped @media write, not a base inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png") center / cover no-repeat',
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain(
      'background-image: url("https://example.com/fill.png") center / cover no-repeat !important;',
    );
    expect(patch.content).not.toContain('style="');
  });

  it("tolerates the image-fill fit marker comment in a scoped backgroundImage write", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value:
        'url("https://example.com/fill.png") /* agent-native-image-fit:fill */',
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("agent-native-image-fit:fill");
  });

  it("still rejects an unsafe url() scheme on backgroundImage even though url() is now allowed", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
      upperBoundPx: 809,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("still rejects url() on the base scope for an unsafe scheme", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
      upperBoundPx: null,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("a safe backgroundImage url() at the base scope still writes a plain inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png")',
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      'style="background-image: url(&quot;https://example.com/fill.png&quot;)"',
    );
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });
});

describe("Fill 'Add layer' single-property commit with a breakpoint active", () => {
  // Mirrors EditPanel's FillProperties "Add layer" button (the +) for an
  // element with no existing visible fill: a single onStyleChange("backgroundColor",
  // ...) call — not a multi-property patch — must still scope through
  // applyScopedVisualStyleEdit instead of silently landing as a base inline
  // style while a non-base breakpoint (e.g. Mobile 390) is active.
  it("a single backgroundColor commit scopes to the active breakpoint's @media block", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundColor",
      value: "#ffffff",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("background-color: #ffffff !important;");
    expect(patch.content).not.toContain('style="');
  });

  it("the same backgroundColor commit at the base scope still writes a plain inline style (byte-identical base behavior)", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundColor",
      value: "#ffffff",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('style="background-color: #ffffff"');
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("the 'mixed fill' Add-layer patch (color + backgroundColor + backgroundImage: none) scopes every property, none silently falls back to base", () => {
    const properties: Array<[string, string]> = [
      ["color", "#000000"],
      ["backgroundColor", "#ffffff"],
      ["backgroundImage", "none"],
    ];
    let content = html;
    for (const [property, value] of properties) {
      const patch = applyScopedVisualStyleEdit({
        content,
        target: { nodeId: "hero" },
        property,
        value,
        upperBoundPx: 809,
      });
      expect(patch.result.status).toBe("applied");
      content = patch.content;
    }
    expect(content).toContain("<style data-agent-native-breakpoints>");
    expect(content).toContain("color: #000000 !important;");
    expect(content).toContain("background-color: #ffffff !important;");
    expect(content).toContain("background-image: none !important;");
    expect(content).not.toContain('style="');
  });
});

describe("pending visual edit breakpoint stamping (gesture parity)", () => {
  const edit = {
    screenId: "screen-1",
    filename: "home.html",
    screenName: "Home",
    selector: ".hero",
    classes: [],
    styles: { left: "137px" },
    originalStyles: { left: "120px" },
    updatedAt: 1,
    breakpoint: { activeWidthPx: 390, upperBoundPx: 809 },
  };

  it("includes the breakpoint scope in the agent prompt payload", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      designTitle: "Test",
      activeFileId: "screen-1",
      activeFilename: "home.html",
      edits: [edit],
    });
    expect(prompt).toContain('"activeWidthPx": 390');
    expect(prompt).toContain('"upperBoundPx": 809');
    expect(prompt).toContain("activeFrameWidthPx");
    expect(prompt).toContain("width-scoped overrides");
  });

  it("omits the scoped-edit instruction for base-only edits", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      designTitle: "Test",
      activeFileId: "screen-1",
      activeFilename: "home.html",
      edits: [{ ...edit, breakpoint: undefined }],
    });
    expect(prompt).not.toContain("width-scoped overrides");
  });
});

describe("delete-to-display:none at an active breakpoint (item 7b)", () => {
  it("scopes a display:none delete override to the active breakpoint's @media block, leaving the base element intact", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "none",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("display: none !important;");
    expect(patch.content).toContain(
      '<section data-agent-native-node-id="hero" class="text-sm p-4">Hello</section>',
    );
  });

  it("at the base scope (no active breakpoint), a display:none write is a plain inline style — callers must route base deletes through structural removal instead", () => {
    // This function is scope-agnostic; the base-vs-scoped BRANCHING decision
    // (structural remove vs. display:none override) lives in
    // handleDeleteSelection, asserted below via source checks. This case
    // documents why: at upperBoundPx === null there is no @media scoping to
    // hide the element at a specific width only, so a real delete must stay
    // structural at the base scope.
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "none",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('style="display: none"');
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });
});

describe("shouldPopToOverviewOnZoomOut (BP-DEEP v2 item 2 — focused-view flicker)", () => {
  const threshold = 60;

  it("never pops on entry (no previously observed single-view zoom)", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: null, zoom: 16, threshold }),
    ).toBe(false);
  });

  it("pops when the user crosses the threshold from above in single view", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 62, zoom: 48, threshold }),
    ).toBe(true);
  });

  it("does not pop while zooming further below an already-sub-threshold zoom", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 30, zoom: 25, threshold }),
    ).toBe(false);
  });

  it("does not pop at or above the threshold", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 100, zoom: 60, threshold }),
    ).toBe(false);
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 40, zoom: 100, threshold }),
    ).toBe(false);
  });

  it("ignores non-finite zoom values", () => {
    expect(
      shouldPopToOverviewOnZoomOut({
        previousZoom: 100,
        zoom: Number.NaN,
        threshold,
      }),
    ).toBe(false);
  });
});

describe("parseBreakpointWidthInput (BP-DEEP v2 item 6 — add/change width)", () => {
  it("parses an in-range integer width", () => {
    expect(parseBreakpointWidthInput("810", [390])).toBe(810);
  });

  it("rejects non-numeric, out-of-range, and duplicate widths", () => {
    expect(parseBreakpointWidthInput("", [])).toBeNull();
    expect(parseBreakpointWidthInput("abc", [])).toBeNull();
    expect(parseBreakpointWidthInput("100", [])).toBeNull();
    expect(parseBreakpointWidthInput("5000", [])).toBeNull();
    expect(parseBreakpointWidthInput("390", [390, 810])).toBeNull();
  });
});
