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

describe("applyWrapNodes (Shift+A auto-layout wrap)", () => {
  // A named leaf so the fixture's own fallback layer-naming (a plain,
  // childless <div> defaults to "Frame") can't coincidentally satisfy this
  // assertion regardless of what the wrap itself names its wrapper.
  const NAMED_LEAF = `<body>
  <div data-agent-native-node-id="label" data-agent-native-layer-name="Label" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
</body>`;

  it("names the wrapper 'Frame', not 'Group', when autoLayout is set", () => {
    const patch = applyVisualEdit(NAMED_LEAF, {
      kind: "wrapNodes",
      targetIds: ["label"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('data-agent-native-layer-name="Frame"');
    expect(patch.content).not.toContain('data-agent-native-layer-name="Group"');
  });

  it("still names a plain (non-auto-layout) wrap 'Group'", () => {
    const patch = applyVisualEdit(NAMED_LEAF, {
      kind: "wrapNodes",
      targetIds: ["label"],
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('data-agent-native-layer-name="Group"');
  });
});

describe("applyWrapNodes (Cmd+Opt+G frame selection, sizeHints fallback)", () => {
  // A Text-tool-created node has position/left/top but no explicit
  // width/height (it's sized by its content, not an authored box) — the
  // real shape that made computeAbsoluteUnionBounds return null and left the
  // Frame with no geometry at all (a zero-area position:static div that
  // doesn't enclose its own content, and whose selection chrome then can't
  // be dragged — see the item-2 cross-screen investigation).
  const AUTO_SIZED_TEXT = `<body>
  <div data-agent-native-node-id="label" style="position:absolute;left:20px;top:40px;color:#fff">Save</div>
</body>`;

  it("without a size hint, a target missing width/height gets no geometry (previous behavior, unchanged)", () => {
    const patch = applyVisualEdit(AUTO_SIZED_TEXT, {
      kind: "wrapNodes",
      targetIds: ["label"],
      wrapperKind: "frame",
    });

    expect(patch.result.status).toBe("applied");
    const wrapperId = (patch.result as { wrapperNodeId?: string })
      .wrapperNodeId;
    expect(wrapperId).toBeTruthy();
    const wrapperOpenTag = patch.content.slice(
      0,
      patch.content.indexOf(`data-agent-native-node-id="${wrapperId}"`) + 1,
    );
    // No style attribute at all — the degenerate case this fix targets.
    expect(wrapperOpenTag).not.toContain("position: absolute");
  });

  it("with a live-rendered size hint, gives the wrapper real enclosing geometry instead of none", () => {
    const patch = applyVisualEdit(AUTO_SIZED_TEXT, {
      kind: "wrapNodes",
      targetIds: ["label"],
      wrapperKind: "frame",
      sizeHints: { label: { width: 35, height: 19 } },
    });

    expect(patch.result.status).toBe("applied");
    const wrapperId = (patch.result as { wrapperNodeId?: string })
      .wrapperNodeId;
    const wrapperOpenTagEnd = patch.content.indexOf(
      ">",
      patch.content.indexOf(`data-agent-native-node-id="${wrapperId}"`),
    );
    const wrapperOpenTag = patch.content.slice(0, wrapperOpenTagEnd);
    expect(wrapperOpenTag).toContain("position: absolute");
    expect(wrapperOpenTag).toContain("left: 20px");
    expect(wrapperOpenTag).toContain("top: 40px");
    expect(wrapperOpenTag).toContain("width: 35px");
    expect(wrapperOpenTag).toContain("height: 19px");
  });

  it("never overrides an explicit width/height with a hint", () => {
    const explicit = `<body>
  <div data-agent-native-node-id="box" style="position:absolute;left:0px;top:0px;width:100px;height:80px"></div>
</body>`;
    const patch = applyVisualEdit(explicit, {
      kind: "wrapNodes",
      targetIds: ["box"],
      wrapperKind: "frame",
      sizeHints: { box: { width: 9999, height: 9999 } },
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("width: 100px");
    expect(patch.content).toContain("height: 80px");
    expect(patch.content).not.toContain("9999");
  });
});
