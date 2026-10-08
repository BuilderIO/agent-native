import { describe, expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer";

const THREE_SIBLINGS = `<body>
  <div data-agent-native-node-id="red" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="green" style="position:absolute;left:60px;top:60px;width:100px;height:80px"></div>
  <div data-agent-native-node-id="blue" style="position:absolute;left:100px;top:100px;width:100px;height:80px"></div>
</body>`;

describe("applyWrapNodes (Cmd+G group)", () => {
  it("ungroup rebases measured in-flow children back to world coordinates", () => {
    const content = `<body style="display:flex;flex-direction:column;gap:20px">
  <div data-agent-native-node-id="first" style="width:100px;height:40px">First</div>
  <div data-agent-native-node-id="second" style="width:100px;height:40px">Second</div>
</body>`;
    const grouped = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["first", "second"],
      sizeHints: {
        first: { width: 100, height: 40, left: 12, top: 80 },
        second: { width: 100, height: 40, left: 12, top: 140 },
      },
    });

    expect(grouped.result.status).toBe("applied");
    const ungrouped = applyVisualEdit(grouped.content, {
      kind: "unwrap",
      targetId: grouped.result.wrapperNodeId ?? "",
    });
    expect(ungrouped.result.status).toBe("applied");
    expect(ungrouped.content).toContain("left: 12px");
    expect(ungrouped.content).toContain("top: 80px");
    expect(ungrouped.content).toContain("top: 140px");
  });

  it("ungroup rebases absolute children from the group origin", () => {
    const content = `<body><div data-agent-native-node-id="red" style="position:absolute;left:20px;top:20px;width:100px;height:80px"></div><div data-agent-native-node-id="green" style="position:absolute;left:60px;top:60px;width:100px;height:80px"></div></body>`;
    const grouped = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["red", "green"],
    });
    const ungrouped = applyVisualEdit(grouped.content, {
      kind: "unwrap",
      targetId: grouped.result.wrapperNodeId ?? "",
    });
    expect(ungrouped.content).toContain("left: 20px");
    expect(ungrouped.content).toContain("top: 20px");
    expect(ungrouped.content).toContain("left: 60px");
  });

  it("places the group at the TOPMOST selected child's z-position, not the bottommost, for a non-adjacent selection", () => {
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

  it("uses measured flow geometry for an intrinsic text child", () => {
    const content = `<body style="display:flex;flex-direction:column;width:43.6px">
  <div data-agent-native-node-id="title" style="width:max-content;height:auto;display:inline-block;margin:3px 4px 5px 6px;inset:2px">Title</div>
</body>`;
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["title"],
      sizeHints: { title: { width: 25, height: 14.4, left: 6, top: 3 } },
    });

    expect(patch.result.status).toBe("applied");
    const projection = buildCodeLayerProjection(patch.content);
    const wrapper = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-group-wrapper"] === "true",
    );
    const child = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "title",
    );
    expect(wrapper?.style).toMatchObject({
      position: "relative",
      width: "25px",
      height: "14.4px",
    });
    expect(child?.style).toMatchObject({
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "max-content",
      height: "auto",
    });
    expect(child?.style.margin).toBeUndefined();
    expect(child?.style.inset).toBeUndefined();
  });

  it("rebases multiple measured flow children from the union origin", () => {
    const content = `<body style="display:flex;flex-direction:column">
  <div data-agent-native-node-id="first" style="display:inline-block;width:max-content">First</div>
  <div data-agent-native-node-id="second" style="display:inline-block;width:max-content">Second</div>
</body>`;
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["first", "second"],
      sizeHints: {
        first: { width: 25, height: 14, left: 8, top: 10 },
        second: { width: 35, height: 18, left: 12, top: 32 },
      },
    });

    expect(patch.result.status).toBe("applied");
    const projection = buildCodeLayerProjection(patch.content);
    const wrapper = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-group-wrapper"] === "true",
    );
    const first = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "first",
    );
    const second = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "second",
    );
    expect(wrapper?.style).toMatchObject({
      position: "relative",
      width: "39px",
      height: "40px",
    });
    expect(first?.style).toMatchObject({ left: "0px", top: "0px" });
    expect(second?.style).toMatchObject({ left: "4px", top: "22px" });
  });

  it("keeps the source-only flow wrapper when a measured offset is missing", () => {
    const content = `<body style="display:flex;flex-direction:column">
  <div data-agent-native-node-id="title" style="display:inline-block;width:max-content">Title</div>
</body>`;
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["title"],
      sizeHints: { title: { width: 25, height: 14 } },
    });

    expect(patch.result.status).toBe("applied");
    const wrapper = buildCodeLayerProjection(patch.content).nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-group-wrapper"] === "true",
    );
    expect(wrapper?.style).toEqual({});
  });
});

describe("applyWrapNodes (Shift+A selection background promotion)", () => {
  const OVERLAPPING_TEXT = `<body>
  <div data-agent-native-node-id="rectangle" data-agent-native-layer-name="Rectangle" data-an-primitive="rectangle" style="position:absolute;left:80px;top:80px;width:240px;height:140px;background-color:#D9D9D9"></div>
  <div data-agent-native-node-id="text" data-agent-native-layer-name="Oracle Text" data-an-primitive="text" style="position:absolute;left:104px;top:132px;width:187px;height:38px">Oracle Text</div>
</body>`;

  it("promotes a containing painted rectangle in place and preserves exact geometry", () => {
    const patch = applyVisualEdit(OVERLAPPING_TEXT, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.wrapperNodeId).toBe("rectangle");
    const projection = buildCodeLayerProjection(patch.content);
    const frame = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "rectangle",
    );
    const child = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    expect(frame).toBeDefined();
    expect(child).toBeDefined();
    expect(frame?.dataAttributes["data-an-primitive"]).toBe("frame");
    expect(frame?.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Frame 1",
    );
    expect(frame?.style).toMatchObject({
      position: "absolute",
      left: "80px",
      top: "80px",
      width: "240px",
      height: "140px",
      "background-color": "#D9D9D9",
      display: "flex",
      "flex-direction": "row",
      gap: "10px",
      "align-items": "center",
      "justify-content": "center",
      "box-sizing": "border-box",
      padding: "52px 29px 50px 24px",
    });
    expect(frame?.children).toEqual([child?.id]);
    expect(
      projection.nodes.filter(
        (node) => node.dataAttributes["data-an-primitive"] === "rectangle",
      ),
    ).toHaveLength(0);
    expect(child?.style).toMatchObject({
      width: "187px",
      height: "38px",
    });
    expect(child?.style.position).toBeUndefined();
    expect(child?.style.left).toBeUndefined();
    expect(child?.style.top).toBeUndefined();
  });

  it("retains the promoted source identity when the same edit is replayed", () => {
    const first = applyVisualEdit(OVERLAPPING_TEXT, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
    });
    const replay = applyVisualEdit(OVERLAPPING_TEXT, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
    });

    expect(first.result.status).toBe("applied");
    expect(replay.result.status).toBe("applied");
    expect(first.result.wrapperNodeId).toBe("rectangle");
    expect(replay.result.wrapperNodeId).toBe("rectangle");
    expect(
      buildCodeLayerProjection(replay.content).nodes.filter(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] === "rectangle",
      ),
    ).toHaveLength(1);
  });

  it("uses live size hints for an auto-sized overlapping text child", () => {
    const content = OVERLAPPING_TEXT.replace(
      "width:187px;height:38px",
      "width:max-content;height:auto",
    );
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
      sizeHints: { text: { width: 187, height: 38, left: 104, top: 132 } },
    });

    expect(patch.result.status).toBe("applied");
    const projection = buildCodeLayerProjection(patch.content);
    const frame = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "rectangle",
    );
    const child = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "text",
    );
    expect(frame?.style).toMatchObject({
      left: "80px",
      top: "80px",
      width: "240px",
      height: "140px",
      padding: "52px 29px 50px 24px",
    });
    expect(child?.style).toMatchObject({
      width: "max-content",
      height: "auto",
    });
  });

  it("keeps the promoted frame at the topmost selected z-position and defaults asymmetric content to top-left", () => {
    const content = `<body>
  <div data-agent-native-node-id="background" data-an-primitive="rectangle" style="position:absolute;left:80px;top:80px;width:424px;height:282px;background-color:#D9D9D9"></div>
  <div data-agent-native-node-id="unselected" data-an-primitive="rectangle" style="position:absolute;left:120px;top:120px;width:80px;height:80px;background-color:#00FF00"></div>
  <div data-agent-native-node-id="child" data-an-primitive="rectangle" style="position:absolute;left:221px;top:179px;width:141px;height:70px;background-color:#0000FF"></div>
</body>`;
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["background", "child"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    const projection = buildCodeLayerProjection(patch.content);
    const frame = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "background",
    );
    expect(frame?.style).toMatchObject({
      "flex-direction": "column",
      "align-items": "flex-start",
      "justify-content": "flex-start",
      padding: "99px 142px 113px 141px",
    });
    expect(
      patch.content.indexOf('data-agent-native-node-id="unselected"'),
    ).toBeLessThan(
      patch.content.indexOf('data-agent-native-node-id="background"'),
    );
  });

  it("keeps partial overlaps on the generic wrapper path", () => {
    const partial = OVERLAPPING_TEXT.replace(
      "width:240px;height:140px",
      "width:100px;height:100px",
    );
    const patch = applyVisualEdit(partial, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.wrapperNodeId).not.toBe("rectangle");
    const projection = buildCodeLayerProjection(patch.content);
    const rectangle = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "rectangle",
    );
    expect(rectangle?.dataAttributes["data-an-primitive"]).toBe("rectangle");
    expect(
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-node-id"] ===
          patch.result.wrapperNodeId,
      )?.dataAttributes["data-an-primitive"],
    ).toBe("frame");
  });

  it.each([
    ["authored component", 'data-agent-native-component="Card"'],
    ["authored group", 'data-agent-native-group="true"'],
  ])("preserves an %s rectangle as a child", (_label, marker) => {
    const marked = OVERLAPPING_TEXT.replace(
      'data-agent-native-layer-name="Rectangle"',
      `data-agent-native-layer-name="Rectangle" ${marker}`,
    );
    const patch = applyVisualEdit(marked, {
      kind: "wrapNodes",
      targetIds: ["rectangle", "text"],
      autoLayout: true,
    });

    expect(patch.result.status).toBe("applied");
    expect(patch.result.wrapperNodeId).not.toBe("rectangle");
    expect(patch.content).toContain('data-an-primitive="rectangle"');
  });
});

describe("applyWrapNodes (Shift+A auto-layout wrap)", () => {
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

  it("persists the measured origin for an in-flow Frame Selection wrapper", () => {
    const content = `<body><div data-agent-native-node-id="label">Save</div></body>`;
    const patch = applyVisualEdit(content, {
      kind: "wrapNodes",
      targetIds: ["label"],
      wrapperKind: "frame",
      sizeHints: {
        label: { width: 35, height: 19, left: 24, top: 48 },
      },
    });

    expect(patch.result.status).toBe("applied");
    const wrapperId = (patch.result as { wrapperNodeId?: string })
      .wrapperNodeId;
    const wrapperStart = patch.content.indexOf(
      `data-agent-native-node-id="${wrapperId}"`,
    );
    const wrapperOpenTagEnd = patch.content.indexOf(">", wrapperStart);
    const wrapperOpenTag = patch.content.slice(wrapperStart, wrapperOpenTagEnd);
    expect(wrapperOpenTag).toContain(
      'data-agent-native-group-origin-left="24px"',
    );
    expect(wrapperOpenTag).toContain(
      'data-agent-native-group-origin-top="48px"',
    );
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

  it("maps size hints by exact projection identity when authored ids repeat", () => {
    const duplicated = `<body>
  <div data-agent-native-node-id="label" style="position:absolute;left:20px;top:40px">First</div>
  <div data-agent-native-node-id="label" style="position:absolute;left:80px;top:100px">Second</div>
</body>`;
    const targets = buildCodeLayerProjection(duplicated).nodes.filter(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    expect(targets).toHaveLength(2);
    expect(targets[0]?.id).not.toBe(targets[1]?.id);

    const patch = applyVisualEdit(duplicated, {
      kind: "wrapNodes",
      targetIds: targets.map((node) => node.id),
      wrapperKind: "frame",
      sizeHints: {
        [targets[0]!.id]: { width: 35, height: 19 },
        [targets[1]!.id]: { width: 90, height: 45 },
      },
    });

    expect(patch.result.status).toBe("applied");
    const wrapperId = (patch.result as { wrapperNodeId?: string })
      .wrapperNodeId;
    const wrapperOpenTagEnd = patch.content.indexOf(
      ">",
      patch.content.indexOf(`data-agent-native-node-id="${wrapperId}"`),
    );
    const wrapperOpenTag = patch.content.slice(0, wrapperOpenTagEnd);
    expect(wrapperOpenTag).toContain("left: 20px");
    expect(wrapperOpenTag).toContain("top: 40px");
    expect(wrapperOpenTag).toContain("width: 150px");
    expect(wrapperOpenTag).toContain("height: 105px");
  });

  it("ignores an ambiguous raw authored-id hint instead of sizing a duplicate", () => {
    const duplicated = `<body>
  <div data-agent-native-node-id="label" style="position:absolute;left:20px;top:40px">First</div>
  <div data-agent-native-node-id="label" style="position:absolute;left:80px;top:100px">Second</div>
</body>`;
    const duplicateTargets = buildCodeLayerProjection(duplicated).nodes.filter(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    const secondTarget = duplicateTargets[1];
    expect(duplicateTargets).toHaveLength(2);
    expect(secondTarget).toBeDefined();

    const patch = applyVisualEdit(duplicated, {
      kind: "wrapNodes",
      targetIds: [secondTarget!.id],
      wrapperKind: "frame",
      sizeHints: { label: { width: 999, height: 999 } },
    });

    expect(patch.result.status).toBe("applied");
    const wrapperId = (patch.result as { wrapperNodeId?: string })
      .wrapperNodeId;
    const wrapperStart = patch.content.indexOf(
      `data-agent-native-node-id="${wrapperId}"`,
    );
    const wrapperOpenTagEnd = patch.content.indexOf(">", wrapperStart);
    const wrapperOpenTag = patch.content.slice(wrapperStart, wrapperOpenTagEnd);
    expect(wrapperOpenTag).not.toContain("position: absolute");
    expect(patch.content).not.toContain("999px");
  });

  it.each(["group", "frame"] as const)(
    "refuses to wrap an authored-stylesheet out-of-flow target as a %s",
    (wrapperKind) => {
      const content = `<body><style>.floating{position:absolute;left:20px;top:40px}</style><div class="floating" data-agent-native-node-id="label">Label</div></body>`;
      const patch = applyVisualEdit(content, {
        kind: "wrapNodes",
        targetIds: ["label"],
        wrapperKind,
        sizeHints: {
          label: {
            width: 80,
            height: 20,
            left: 20,
            top: 40,
            outOfFlow: true,
          },
        },
      });

      expect(patch.result.status).toBe("unsupported");
      expect(patch.content).toBe(content);
    },
  );
});
