import { describe, expect, it } from "vitest";

import { applyVisualEdit } from "./code-layer";

/**
 * Three siblings stacked in DOM order back->front: red (bottom), green
 * (middle), blue (top) — later source position paints on top for plain
 * siblings with no z-index. Matches e2e/parity-group-frame.spec.ts's
 * "non-adjacent selection" fixture.
 */
const THREE_SIBLINGS = `<body>
  <div data-agent-native-node-id="red" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="green" style="position:absolute;left:60px;top:60px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="blue" style="position:absolute;left:100px;top:100px;width:100px;height:80px"></div>
</body>`;

describe("applyWrapNodes (Cmd+G group)", () => {
  it("places the group at the TOPMOST selected child's z-position, not the bottommost, for a non-adjacent selection", () => {
    // Select red (bottom) + blue (top), skipping green (middle). Figma
    // places the resulting group at blue's stacking position, so green
    // ends up BELOW the group, not above it.
    const patch = applyVisualEdit(THREE_SIBLINGS, {
      kind: "wrapNodes",
      targetIds: ["red", "blue"],
    });

    expect(patch.result.status).toBe("applied");
    const groupIdx = patch.content.indexOf(
      'data-agent-native-layer-name="Group',
    );
    const greenIdx = patch.content.indexOf('data-agent-native-node-id="green"');
    expect(groupIdx, "group wrapper not found").toBeGreaterThan(-1);
    expect(greenIdx, "green not found").toBeGreaterThan(-1);
    expect(
      groupIdx,
      "the group must land AFTER green in source order (Blue's z-position), not before it (Red's)",
    ).toBeGreaterThan(greenIdx);
  });

  it("keeps the selected children in their relative source order inside the wrapper", () => {
    const patch = applyVisualEdit(THREE_SIBLINGS, {
      kind: "wrapNodes",
      targetIds: ["red", "blue"],
    });

    expect(patch.result.status).toBe("applied");
    const redIdx = patch.content.indexOf('data-agent-native-node-id="red"');
    const blueIdx = patch.content.indexOf('data-agent-native-node-id="blue"');
    expect(redIdx).toBeGreaterThan(-1);
    expect(blueIdx).toBeGreaterThan(redIdx);
  });
});
