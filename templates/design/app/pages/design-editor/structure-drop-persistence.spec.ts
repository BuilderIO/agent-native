import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("flow-to-absolute structure drop persistence", () => {
  it("persists absolute-container positioning even when the source node began in flow", () => {
    const implementation = readFileSync(
      new URL("./commands/visual-structure-change.ts", import.meta.url),
      "utf8",
    );
    const overviewWrapper = readFileSync(
      new URL("./commands/screen-visual-structure-change.ts", import.meta.url),
      "utf8",
    );
    const absoluteDropBranches = implementation.match(
      /movedNodeAttrId && details\?\.dropMode === "absolute-container"/g,
    );
    expect(absoluteDropBranches).toHaveLength(1);
    expect(overviewWrapper).toContain("runVisualStructureChange");

    const absoluteDropIndex = implementation.indexOf(
      'details?.dropMode === "absolute-container"',
    );
    const oldPositionIndex = implementation.indexOf(
      "isAbsoluteCodeLayerNode(targetNode)",
    );
    expect(absoluteDropIndex).toBeGreaterThanOrEqual(0);
    expect(oldPositionIndex).toBeGreaterThan(absoluteDropIndex);
    expect(implementation).toContain("setAbsolutePositioningForNodeInHtml(");
    expect(implementation).toContain(
      "removeAbsolutePositioningFromNodeInHtml(",
    );
    expect(implementation).toContain('details?.dropMode === "flow-insert"');
    expect(implementation).toContain("details.forceFlowPositionOverride");
    expect(implementation).toContain(
      "setFlowPositioningOverrideForNodeInHtml(",
    );
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
