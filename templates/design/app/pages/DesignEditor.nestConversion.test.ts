import { applyVisualEdit } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  applyScopedVisualStyleEdit,
  getFreshScreenContent,
} from "./DesignEditor";

/**
 * Nest-into-plain-rect auto-layout conversion regression (host-side drop of
 * the bridge's conversion message).
 *
 * On a nest-drop into a plain block container, editor-chrome.bridge.ts's
 * applyAutoLayoutConversionForDrop posts a normal `visual-style-change` for
 * the CONTAINER (display:flex + inferred flex-direction/gap, kebab-case)
 * immediately BEFORE the moved element's `visual-structure-change`. For a
 * NON-ACTIVE overview screen (and the board file) both messages land in the
 * same task burst: the style handler persisted the conversion through
 * applyFileContentUpdate → pendingLocalFileContentsRef, but the structure
 * handler's base read (`getScreenContent` → the render-memoized
 * fileContentById map) could not see that same-tick write, so the move was
 * rebased off PRE-conversion content and its own write clobbered the
 * conversion — the container stayed display:block in persisted content.
 *
 * The fix threads the synchronous pending write into getFreshScreenContent
 * (`pendingContent`), mirroring the latest/lastLocal refs the ACTIVE file
 * already composes through. These specs pin both layers:
 *   1. the conversion styles apply to a plain block div via nodeId target
 *      exactly as the bridge sends them (kebab-case properties);
 *   2. compose order: moveNode over the CONVERTED content keeps the
 *      conversion, moveNode over the stale base drops it (the old bug);
 *   3. getFreshScreenContent prefers the same-tick pending write for
 *      non-active screens.
 */

const containerScreenHtml = [
  "<html><head></head><body>",
  '<div data-agent-native-node-id="container" style="position: absolute; left: 40px; top: 40px; width: 240px; height: 180px; background: #eeeeee;">',
  '<span data-agent-native-node-id="existing-child">Existing</span>',
  "</div>",
  '<p data-agent-native-node-id="moved-text" style="position: absolute; left: 400px; top: 60px;">Drag me</p>',
  "</body></html>",
].join("");

// The exact message payload shape applyAutoLayoutConversionForDrop posts:
// kebab-case properties, one styles record targeting the container.
const conversionStyles: Array<[property: string, value: string]> = [
  ["display", "flex"],
  ["flex-direction", "column"],
  ["gap", "10px"],
];

function applyConversion(content: string): string {
  // Mirrors handleScreenVisualStyleChange's per-property reduce over
  // applyScopedVisualStyleEdit with a nodeId target and no breakpoint scope.
  return conversionStyles.reduce((current, [property, value]) => {
    const patch = applyScopedVisualStyleEdit({
      content: current,
      target: { nodeId: "container" },
      property,
      value,
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    return patch.content;
  }, content);
}

function moveTextIntoContainer(content: string): string {
  const patch = applyVisualEdit(content, {
    kind: "moveNode",
    target: { nodeId: "moved-text" },
    anchor: { nodeId: "container" },
    placement: "inside",
  });
  expect(patch.result.status).toBe("applied");
  return patch.content;
}

function expectNestedInsideContainer(content: string) {
  const containerOpenIdx = content.indexOf(
    'data-agent-native-node-id="container"',
  );
  const containerCloseIdx = content.indexOf("</div>", containerOpenIdx);
  const movedTextIdx = content.indexOf("Drag me");
  expect(containerOpenIdx).toBeGreaterThan(-1);
  expect(containerCloseIdx).toBeGreaterThan(-1);
  expect(movedTextIdx).toBeGreaterThan(containerOpenIdx);
  expect(movedTextIdx).toBeLessThan(containerCloseIdx);
}

describe("nest-drop auto-layout conversion (bridge visual-style-change on the container)", () => {
  it("applies display:flex + flex-direction + gap to a plain block div via nodeId target, kebab-case as posted", () => {
    const converted = applyConversion(containerScreenHtml);
    expect(converted).toContain("display: flex");
    expect(converted).toContain("flex-direction: column");
    expect(converted).toContain("gap: 10px");
    // The conversion targets the container, not the moved element.
    const containerTag = converted.slice(
      converted.indexOf('data-agent-native-node-id="container"'),
      converted.indexOf(
        ">",
        converted.indexOf('data-agent-native-node-id="container"'),
      ),
    );
    expect(containerTag).toContain("display: flex");
  });

  it("conversion survives the drop's moveNode when the move rebases off the converted (same-tick fresh) content", () => {
    const converted = applyConversion(containerScreenHtml);
    const composed = moveTextIntoContainer(converted);
    expect(composed).toContain("display: flex");
    expect(composed).toContain("flex-direction: column");
    expect(composed).toContain("gap: 10px");
    expectNestedInsideContainer(composed);
  });

  it("documents the clobber: moveNode rebased off the STALE pre-conversion base drops the conversion entirely", () => {
    // This is what the non-active-screen handler chain did before the fix:
    // the structure change read the render-memoized content (no conversion)
    // and its write became the final persisted value.
    const staleCompose = moveTextIntoContainer(containerScreenHtml);
    expectNestedInsideContainer(staleCompose);
    expect(staleCompose).not.toContain("display: flex");
    expect(staleCompose).not.toContain("flex-direction: column");
  });
});

describe("getFreshScreenContent — same-tick pending write preference (the fixed seam)", () => {
  const fileContentById = new Map<string, string>([
    ["screen-a", "<div>state copy</div>"],
    ["screen-b", "<div>other screen</div>"],
  ]);

  it("prefers the synchronous pending write over the render-memoized map for a NON-ACTIVE screen", () => {
    expect(
      getFreshScreenContent({
        screenId: "screen-a",
        activeFileId: "screen-b",
        freshActiveContentFileId: "screen-b",
        freshActiveContent: "<div>active content</div>",
        fileContentById,
        pendingContent: "<div>converted, not yet rendered</div>",
      }),
    ).toBe("<div>converted, not yet rendered</div>");
  });

  it("falls back to the memoized map when there is no pending write", () => {
    expect(
      getFreshScreenContent({
        screenId: "screen-a",
        activeFileId: "screen-b",
        freshActiveContentFileId: "screen-b",
        freshActiveContent: "<div>active content</div>",
        fileContentById,
        pendingContent: null,
      }),
    ).toBe("<div>state copy</div>");
  });

  it("keeps the ACTIVE screen on freshActiveContent (the latest/lastLocal ref path) even when a pending entry exists", () => {
    expect(
      getFreshScreenContent({
        screenId: "screen-b",
        activeFileId: "screen-b",
        freshActiveContentFileId: "screen-b",
        freshActiveContent: "<div>active content</div>",
        fileContentById,
        pendingContent: "<div>pending for active</div>",
      }),
    ).toBe("<div>active content</div>");
  });

  it("returns empty string for an unknown screen with no pending write", () => {
    expect(
      getFreshScreenContent({
        screenId: "missing",
        activeFileId: "screen-b",
        freshActiveContentFileId: "screen-b",
        freshActiveContent: "<div>active content</div>",
        fileContentById,
        pendingContent: null,
      }),
    ).toBe("");
  });
});
