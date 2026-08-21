import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// setFlowPositioningOverrideForNodeInHtml/setAbsolutePositioningForNodeInHtml
// live in html-layer-positioning.ts (extracted from DesignEditor.tsx as a
// pure, non-closure module-scope helper module); the second test below
// inspects that helper's own definition text.
const htmlLayerPositioningSource = readFileSync(
  new URL("./html-layer-positioning.ts", import.meta.url),
  "utf8",
);

describe("flow-to-absolute structure drop persistence", () => {
  it("persists absolute-container positioning even when the source node began in flow", () => {
    const structureChangeSources = [
      "visual-structure-change",
      "screen-visual-structure-change",
    ].map((name) =>
      readFileSync(new URL(`./commands/${name}.ts`, import.meta.url), "utf8"),
    );
    const absoluteDropBranches = structureChangeSources.flatMap(
      (text) =>
        text.match(
          /movedNodeAttrId && details\?\.dropMode === "absolute-container"/g,
        ) ?? [],
    );
    expect(absoluteDropBranches).toHaveLength(2);

    // Both active-screen and overview-screen handlers must apply the absolute
    // style before consulting the old source node's positioning. This is what
    // makes flow -> root/absolute-container survive reload instead of reverting
    // after the bridge's optimistic DOM move.
    for (const commandModule of [
      "visual-structure-change",
      "screen-visual-structure-change",
    ]) {
      const section = readFileSync(
        new URL(`./commands/${commandModule}.ts`, import.meta.url),
        "utf8",
      );
      const absoluteDropIndex = section.indexOf(
        'details?.dropMode === "absolute-container"',
      );
      const oldPositionIndex = section.indexOf(
        "isAbsoluteCodeLayerNode(targetNode)",
      );
      expect(absoluteDropIndex).toBeGreaterThanOrEqual(0);
      expect(oldPositionIndex).toBeGreaterThan(absoluteDropIndex);
      expect(section).toContain("setAbsolutePositioningForNodeInHtml(");
      expect(section).toContain("removeAbsolutePositioningFromNodeInHtml(");
      expect(section).toContain('details?.dropMode === "flow-insert"');
      expect(section).toContain("details.forceFlowPositionOverride");
      expect(section).toContain("setFlowPositioningOverrideForNodeInHtml(");
    }
  });

  it("persists an important static override only for the explicit stylesheet fallback signal", () => {
    const helperStart = htmlLayerPositioningSource.indexOf(
      "function setFlowPositioningOverrideForNodeInHtml",
    );
    const helperEnd = htmlLayerPositioningSource.indexOf(
      "function setAbsolutePositioningForNodeInHtml",
      helperStart,
    );
    const helper = htmlLayerPositioningSource.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helper).toContain(
      'element.style.setProperty("position", "static", "important")',
    );
    expect(helper).toContain("ABS_POSITION_PROPS");
  });

  it("keeps the source update on the existing local history/optimistic-preview path", () => {
    const section = readFileSync(
      new URL("./commands/visual-structure-change.ts", import.meta.url),
      "utf8",
    );

    expect(section).toContain("applyLocalContentUpdate(");
    expect(section.match(/applyLocalContentUpdate\(/g)).toHaveLength(1);
    expect(section).toContain("{ skipPreview: true }");
    expect(section).not.toContain("recordHistory: false");
  });
});
