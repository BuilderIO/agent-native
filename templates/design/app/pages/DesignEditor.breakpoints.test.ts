import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBreakpointWidthInput } from "@/components/design/BreakpointBar";

import {
  applyScopedVisualStyleEdit,
  formatPendingVisualStylePrompt,
  shouldPopToOverviewOnZoomOut,
} from "./DesignEditor";

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
    // Base font size keeps rendering at wider viewports.
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
    expect(patch.content).toContain("left: 137px;");
    // The element's inline style is untouched.
    expect(patch.content).not.toContain('style="');
  });

  it("scoped failures do not silently fall back to base writes", () => {
    // "display" only accepts a known-value list, so a bogus raw value fails
    // the media path — the failure must surface instead of mutating base.
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
    // Bug repro: adding/replacing an image fill while a non-base breakpoint
    // is active used to fall through the deterministic scoped path (url()
    // was rejected outright) into the legacy base-inline fallback, so both
    // breakpoint frames changed together. `url("...")` is not a Tailwind
    // utility, so a safe reference must land in the managed @media block,
    // scoped to the active bound — never as a plain inline style.
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
      'background-image: url("https://example.com/fill.png") center / cover no-repeat;',
    );
    // The element's inline style must be untouched — a base write here would
    // clobber every breakpoint frame instead of just the active one.
    expect(patch.content).not.toContain('style="');
  });

  it("tolerates the image-fill fit marker comment in a scoped backgroundImage write", () => {
    // imageFillToBackgroundStyles embeds a `/* agent-native-image-fit:<mode> */`
    // marker directly in the committed backgroundImage value so the fit mode
    // round-trips. That marker must not be treated as a comment-breakout risk.
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
    // Base-breakpoint behavior must stay byte-identical to before this fix.
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
    expect(patch.content).toContain("background-color: #ffffff;");
    // The base inline style must be untouched — a plain inline write here
    // would clobber every breakpoint frame, not just the active one.
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
    // Mirrors the fillIsMixed branch's commitStylePatch call, which batches
    // three properties into one commit. If ANY property in that batch fails
    // the scoped path, the whole commit must fail loud (per commitVisualStyles'
    // all-or-nothing reduce) rather than one property silently landing base
    // while a breakpoint is active.
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
    expect(content).toContain("color: #000000;");
    expect(content).toContain("background-color: #ffffff;");
    expect(content).toContain("background-image: none;");
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
    expect(patch.content).toContain("display: none;");
    // The element itself (and its base classes) must still be in the
    // document — this is a scoped override, not a structural removal.
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

describe("DesignEditor breakpoint wiring (source assertions)", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");

  it("routes every style-commit path through the scoped write helper", () => {
    // commitVisualStyles + commitStylesToSelectedLayers +
    // commitRelativeStyleDeltaToSelectedLayers all call the single
    // class-vs-media routing helper instead of raw kind:"style" patches.
    const calls = source.match(/applyScopedVisualStyleEdit\(\{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("BP-DEEP v2: breakpoint targeting lives ONLY in the inspector-header segmented control — no canvas bar, no chrome row", () => {
    // History: a floating BreakpointBar overlay covered the top of the
    // focused screen; its chrome-row replacement bumped the whole canvas
    // down. Both are gone — the unified BreakpointDeviceControl renders in
    // the right-inspector header slot the old device-preview dropdown used.
    expect(source).toContain('from "@/components/design/BreakpointBar"');
    expect(source.match(/<BreakpointBar\b/g) ?? []).toHaveLength(0);
    const mounts = source.match(/<BreakpointDeviceControl\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    // The old standalone device-preview dropdown is fully replaced.
    expect(source).not.toContain('t("designEditor.devicePreview")');
  });

  it("switches the editing viewport AND the persisted edit scope on segment click", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointBarSelect"),
      source.indexOf("// Item 9 — agent→UI breakpoint sync"),
    );
    expect(handler).toContain("setActiveBreakpointWidthState(widthPx)");
    expect(handler).toContain("setActiveBreakpointMutation");
  });

  it("BP-DEEP item 5: every overview click-to-target path returns the edit scope to Base", () => {
    // Escape (priority branch), base-frame pick, element select/clear inside
    // the base frame's content, and empty-canvas selection clears all route
    // through the same handleBreakpointBarSelect(undefined) reset.
    const resets =
      source.match(/handleBreakpointBarSelect\(undefined\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(5);
    // Escape's reset is gated on the latest-ref mirror, not stale state.
    const escape = source.slice(
      source.indexOf("const handleEscapeHotkey"),
      source.indexOf("const SINGLE_MODE_TEXT_TAGS"),
    );
    expect(escape).toContain(
      "activeBreakpointWidthStateRef.current !== undefined",
    );
    expect(escape).toContain("handleBreakpointBarSelect(undefined)");
  });

  it("BP-DEEP v2 item 6: change-width swaps through add + re-target + remove (add-first, orphan-proof)", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointChangeWidth"),
      source.indexOf("const handleOverviewAddBreakpoint"),
    );
    expect(handler).toContain("removeBreakpointMutation.mutateAsync");
    expect(handler).toContain("addBreakpointMutation.mutateAsync");
    expect(handler).toContain(
      "if (wasActive) handleBreakpointBarSelect(widthPx)",
    );
    // Orphan-proof ordering: the add call must appear before the remove call
    // (add-then-remove, not remove-then-add), so a failed/slow add never
    // leaves the active edit scope pointed at a width with no backing
    // breakpoint.
    const addIndex = handler.indexOf("addBreakpointMutation.mutateAsync");
    const removeIndex = handler.indexOf("removeBreakpointMutation.mutateAsync");
    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(addIndex);
    // The re-target call must happen between add and remove, so the UI's
    // edit scope follows the new width before the old breakpoint is torn
    // down (success path: active target follows the width change).
    const retargetIndex = handler.indexOf(
      "if (wasActive) handleBreakpointBarSelect(widthPx)",
    );
    expect(retargetIndex).toBeGreaterThan(addIndex);
    expect(retargetIndex).toBeLessThan(removeIndex);
  });

  it("BP-DEEP v2 item 6: an add failure aborts before touching the old breakpoint (failure path — old breakpoint stays intact and targeted)", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointChangeWidth"),
      source.indexOf("const handleOverviewAddBreakpoint"),
    );
    // The add call is wrapped in its own try/catch that returns early,
    // before the re-target or remove calls run — so a rejected add never
    // reaches handleBreakpointBarSelect or removeBreakpointMutation, leaving
    // the old breakpoint (and, if it was active, the active target) fully
    // intact.
    const tryIndex = handler.indexOf("try {");
    const addIndex = handler.indexOf("addBreakpointMutation.mutateAsync");
    const catchIndex = handler.indexOf("} catch {", addIndex);
    const returnIndex = handler.indexOf("return;", catchIndex);
    const retargetIndex = handler.indexOf(
      "if (wasActive) handleBreakpointBarSelect(widthPx)",
    );
    expect(tryIndex).toBeGreaterThanOrEqual(0);
    expect(tryIndex).toBeLessThan(addIndex);
    expect(catchIndex).toBeGreaterThan(addIndex);
    expect(returnIndex).toBeGreaterThan(catchIndex);
    expect(returnIndex).toBeLessThan(retargetIndex);
  });

  it("gates overview side-by-side frames on the show-all toggle", () => {
    expect(source).toContain("!breakpointFramesHidden &&");
    expect(source).toContain("breakpointFramesHidden,");
  });

  it("stamps the active breakpoint scope onto pending gesture edits", () => {
    const recorder = source.slice(
      source.indexOf("const recordPendingVisualStyleEdit"),
      source.indexOf("const activeProjectionContent"),
    );
    expect(recorder).toContain("breakpoint: {");
    expect(recorder).toContain("activeWidthPx: activeBreakpointWidthState");
    expect(recorder).toContain("upperBoundPx: activeBreakpointUpperBoundPx");
  });

  it("derives the Framer bound from breakpoints + the base frame width", () => {
    expect(source).toContain("const activeBreakpointUpperBoundPx");
    expect(source).toContain("breakpointUpperBoundPx(");
    expect(source).toContain("activeScreenBaseWidthPx");
  });

  it("never falls back to a base inline write while a breakpoint is active", () => {
    // On scoped-patch failure the legacy selector-based fallback would
    // clobber every viewport width — the commit must fail loud instead.
    const start = source.indexOf("const resolvedNextContentBeforeFontLink");
    expect(start).toBeGreaterThanOrEqual(0);
    const fallback = source.slice(start, start + 400);
    expect(fallback).toContain("activeBreakpointUpperBoundPx != null");
  });

  it("item 7b: Delete routes through a display:none scoped write, not structural removal, while a breakpoint is active", () => {
    const start = source.indexOf("const handleDeleteSelection = useCallback");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(
      "// Wrap the current multi-layer selection into a new group container.",
    );
    expect(end).toBeGreaterThan(start);
    const handler = source.slice(start, end);
    expect(handler).toContain("useBreakpointScopedDelete");
    expect(handler).toContain('property: "display"');
    expect(handler).toContain('value: "none"');
    expect(handler).toContain("applyScopedVisualStyleEdit");
    // Structural removal (removeCodeLayerNodeFromHtml / removeElementFromHtml)
    // must still be present for the base-editing (non-scoped) case — this is
    // an added branch, not a replacement.
    expect(handler).toContain("removeCodeLayerNodeFromHtml");
    expect(handler).toContain("removeElementFromHtml");
  });

  it("item 8b: overview breakpoint frame '…' menu and full-view callbacks are wired to MultiScreenCanvas", () => {
    expect(source).toContain("onRemoveBreakpoint={");
    expect(source).toContain("onChangeBreakpointWidth={");
    expect(source).toContain("onEditBreakpoint={handleOverviewEditBreakpoint}");
    const remover = source.slice(
      source.indexOf("const handleOverviewRemoveBreakpoint"),
      source.indexOf("const handleOverviewChangeBreakpointWidth"),
    );
    expect(remover).toContain("handleBreakpointBarRemove(bp.id)");
    const changer = source.slice(
      source.indexOf("const handleOverviewChangeBreakpointWidth"),
      source.indexOf("const handleOverviewEditBreakpoint"),
    );
    expect(changer).toContain(
      "handleBreakpointChangeWidth(bp.id, nextWidthPx)",
    );
    const editor = source.slice(
      source.indexOf("const handleOverviewEditBreakpoint"),
      source.indexOf("// Hooks must not be called conditionally"),
    );
    expect(editor).toContain("enterSingleScreen(screenId)");
  });

  it("item 8b: single-view already renders at the active breakpoint's width on entry", () => {
    // previewWidthPx is passed straight from activeBreakpointWidthState, and
    // BreakpointPreviewRow's activateThisFrame (MultiScreenCanvas.tsx) sets
    // that state BEFORE onEditBreakpoint/enterSingleScreen fires — so no
    // separate wiring is needed here for full view to land at the right
    // width; this just guards against a future refactor silently dropping
    // the prop.
    expect(source).toContain("previewWidthPx={activeBreakpointWidthState}");
  });
});

describe("shouldPopToOverviewOnZoomOut (BP-DEEP v2 item 2 — full-view flicker)", () => {
  const threshold = 60;

  it("never pops on entry (no previously observed single-view zoom)", () => {
    // enterSingleScreen restoring a remembered sub-threshold zoom was the
    // "Full view flashes then bounces back to overview" bug: the old
    // level-triggered check fired on the entry-restored value itself.
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
    // Entering at 30% is a legitimate focused view; continuing to 25% is not
    // a fresh "zoom out of the screen" gesture.
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
    expect(parseBreakpointWidthInput("100", [])).toBeNull(); // < 320
    expect(parseBreakpointWidthInput("5000", [])).toBeNull(); // > 3840
    expect(parseBreakpointWidthInput("390", [390, 810])).toBeNull();
  });

  it("accepts a width equal to the one being changed when the caller excludes it", () => {
    // Change-width callers filter the breakpoint's own current width out of
    // existingWidths so re-typing the same number is a no-op, not an error.
    expect(parseBreakpointWidthInput("810", [390])).toBe(810);
  });
});
