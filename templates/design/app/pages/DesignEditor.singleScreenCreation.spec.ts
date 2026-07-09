/**
 * DesignEditor.singleScreenCreation.spec.ts
 *
 * P4 (single-screen tool placement) + vector-edit foundations pure-helper
 * coverage:
 *
 * - getSingleScreenCreationTool: maps the editor's active DesignTool + view
 *   mode to the CreationTool DesignCanvas's single-screen click-to-place
 *   overlay understands (or null when it should stay unmounted).
 * - createPrimitiveInsertFromSpec: converts a CreatePrimitiveSpec (screen-
 *   content space, emitted by the single-screen overlay) into the shared
 *   CanvasPrimitiveInsert shape the existing overview commit path already
 *   knows how to persist.
 * - parsePenPathFromSerializedD: the deliberate inverse of pen-path.ts's
 *   serializePenPath, used to recover a structured PenPath (for
 *   data-an-pen-nodes) from the flattened `d` string that is the only pen
 *   geometry MultiScreenCanvas's CanvasPrimitiveInsert carries across the
 *   overview commit boundary. Round-tripped against the real serializer/
 *   pen-path helpers rather than hand-written `d` strings, so this pins the
 *   actual serializePenPath grammar rather than an assumption about it.
 */

import { describe, expect, it } from "vitest";

import {
  clonePenPath,
  createCornerNode,
  createSmoothNode,
  serializePenPath,
  type PenPath,
} from "../../shared/pen-path";
import {
  createPrimitiveInsertFromSpec,
  parsePenPathFromSerializedD,
} from "./design-editor/canvas-primitives";
import { getSingleScreenCreationTool } from "./design-editor/tool-state";

describe("getSingleScreenCreationTool", () => {
  it("returns null in overview mode regardless of tool", () => {
    expect(
      getSingleScreenCreationTool({
        activeTool: "rect",
        viewMode: "overview",
        hasActiveFile: true,
      }),
    ).toBeNull();
  });

  it("returns null in single-screen mode with no active file", () => {
    expect(
      getSingleScreenCreationTool({
        activeTool: "rect",
        viewMode: "single",
        hasActiveFile: false,
      }),
    ).toBeNull();
  });

  it("maps rect to CreationTool's rectangle id", () => {
    expect(
      getSingleScreenCreationTool({
        activeTool: "rect",
        viewMode: "single",
        hasActiveFile: true,
      }),
    ).toBe("rectangle");
  });

  it.each(["ellipse", "line", "arrow", "text", "pen", "frame"] as const)(
    "maps %s to itself",
    (tool) => {
      expect(
        getSingleScreenCreationTool({
          activeTool: tool,
          viewMode: "single",
          hasActiveFile: true,
        }),
      ).toBe(tool);
    },
  );

  it.each([
    "move",
    "polygon",
    "star",
    "hand",
    "comment",
    "draw",
    "scale",
  ] as const)(
    "maps %s (no single-screen placement equivalent) to null",
    (tool) => {
      expect(
        getSingleScreenCreationTool({
          activeTool: tool,
          viewMode: "single",
          hasActiveFile: true,
        }),
      ).toBeNull();
    },
  );
});

describe("createPrimitiveInsertFromSpec", () => {
  it("builds a bare frame insert from a frame-tool gesture (F/A in a focused screen)", () => {
    const result = createPrimitiveInsertFromSpec(
      {
        tool: "frame",
        rect: { x: 10, y: 20, width: 200, height: 150 },
        fromClick: false,
      },
      "node-frame-1",
    );
    expect(result).toEqual({
      kind: "frame",
      nodeId: "node-frame-1",
      geometry: { x: 10, y: 20, width: 200, height: 150 },
      autoSize: undefined,
    });
  });

  it("builds rectangle geometry from a click (default size)", () => {
    const result = createPrimitiveInsertFromSpec(
      {
        tool: "rectangle",
        rect: { x: 10, y: 20, width: 160, height: 100 },
        fromClick: true,
      },
      "node-1",
    );
    expect(result).toEqual({
      kind: "rectangle",
      nodeId: "node-1",
      geometry: { x: 10, y: 20, width: 160, height: 100 },
      autoSize: undefined,
    });
  });

  it("marks click-placed text autoSize true, drag-placed text autoSize false", () => {
    const clicked = createPrimitiveInsertFromSpec(
      {
        tool: "text",
        rect: { x: 0, y: 0, width: 160, height: 32 },
        fromClick: true,
      },
      "node-text-click",
    );
    expect(clicked?.autoSize).toBe(true);

    const dragged = createPrimitiveInsertFromSpec(
      {
        tool: "text",
        rect: { x: 0, y: 0, width: 300, height: 60 },
        fromClick: false,
      },
      "node-text-drag",
    );
    expect(dragged?.autoSize).toBe(false);
  });

  it("builds line/arrow geometry + points from two points", () => {
    const result = createPrimitiveInsertFromSpec(
      {
        tool: "line",
        points: [
          { x: 50, y: 40 },
          { x: 150, y: 100 },
        ],
        fromClick: false,
      },
      "node-line",
    );
    expect(result).toEqual({
      kind: "line",
      nodeId: "node-line",
      geometry: { x: 50, y: 40, width: 100, height: 60 },
      points: [
        { x: 50, y: 40 },
        { x: 150, y: 100 },
      ],
    });
  });

  it("returns null for line/arrow with fewer than 2 points", () => {
    expect(
      createPrimitiveInsertFromSpec(
        { tool: "arrow", points: [{ x: 0, y: 0 }], fromClick: true },
        "node-bad",
      ),
    ).toBeNull();
  });

  it("preserves the complete multi-anchor Bezier path from focused-screen authoring", () => {
    const penPath: PenPath = {
      nodes: [
        createSmoothNode({ x: 30, y: 30 }, { x: 55, y: 10 }),
        createSmoothNode({ x: 150, y: 90 }, { x: 125, y: 110 }),
      ],
      closed: false,
    };
    const result = createPrimitiveInsertFromSpec(
      {
        tool: "pen",
        points: penPath.nodes.map((node) => node.point),
        penPath,
        fromClick: false,
      },
      "node-pen",
    );
    expect(result?.kind).toBe("path");
    expect(result?.nodeId).toBe("node-pen");
    expect(result?.points).toEqual([
      { x: 30, y: 30 },
      { x: 150, y: 90 },
    ]);
    expect(result?.pathData).toBe(serializePenPath(penPath));
    expect(result?.pathData).toContain(" C ");
  });

  it("does not fabricate a path until focused-screen pen authoring has two anchors", () => {
    expect(
      createPrimitiveInsertFromSpec(
        {
          tool: "pen",
          points: [{ x: 0, y: 0 }],
          penPath: {
            nodes: [createCornerNode({ x: 0, y: 0 })],
            closed: false,
          },
          fromClick: true,
        },
        "node-pen-empty",
      ),
    ).toBeNull();
  });

  it("returns null for rectangle/ellipse without a rect", () => {
    expect(
      createPrimitiveInsertFromSpec(
        { tool: "ellipse", fromClick: true },
        "node-no-rect",
      ),
    ).toBeNull();
  });
});

describe("parsePenPathFromSerializedD (inverse of serializePenPath)", () => {
  function expectRoundTrip(path: PenPath) {
    const d = serializePenPath(path);
    const parsed = parsePenPathFromSerializedD(d);
    expect(parsed).not.toBeNull();
    // Re-serializing the parsed-back path must reproduce the exact same `d`
    // string — the real invariant this parser exists for (data-an-pen-nodes
    // round-tripping through commit -> re-hydrate -> re-commit).
    expect(serializePenPath(parsed!)).toBe(d);
    expect(parsed!.closed).toBe(path.closed);
    expect(parsed!.nodes).toHaveLength(path.nodes.length);
  }

  it("round-trips a simple open corner-only path (all L segments)", () => {
    expectRoundTrip({
      nodes: [
        createCornerNode({ x: 0, y: 0 }),
        createCornerNode({ x: 100, y: 0 }),
        createCornerNode({ x: 100, y: 80 }),
      ],
      closed: false,
    });
  });

  it("round-trips an open path with smooth (symmetric-handle) nodes", () => {
    expectRoundTrip({
      nodes: [
        createSmoothNode({ x: 0, y: 0 }, { x: 30, y: -20 }),
        createSmoothNode({ x: 120, y: 40 }, { x: 160, y: 20 }),
        createCornerNode({ x: 200, y: 100 }),
      ],
      closed: false,
    });
  });

  it("round-trips a closed path whose wrap segment is a curve (C before Z)", () => {
    expectRoundTrip(
      closePenPathForTest({
        nodes: [
          createSmoothNode({ x: 0, y: 0 }, { x: 40, y: -10 }),
          createSmoothNode({ x: 100, y: 50 }, { x: 140, y: 60 }),
          createSmoothNode({ x: 50, y: 120 }, { x: 20, y: 140 }),
        ],
        closed: false,
      }),
    );
  });

  it("round-trips a closed path whose wrap segment is a straight line (L before Z)", () => {
    expectRoundTrip(
      closePenPathForTest({
        nodes: [
          createCornerNode({ x: 0, y: 0 }),
          createCornerNode({ x: 100, y: 0 }),
          createCornerNode({ x: 100, y: 100 }),
          createCornerNode({ x: 0, y: 100 }),
        ],
        closed: false,
      }),
    );
  });

  it("round-trips a single-node degenerate path", () => {
    expectRoundTrip({
      nodes: [createCornerNode({ x: 12, y: 34 })],
      closed: false,
    });
  });

  it("returns null for empty input", () => {
    expect(parsePenPathFromSerializedD("")).toBeNull();
    expect(parsePenPathFromSerializedD("   ")).toBeNull();
  });

  it("returns null for malformed input that doesn't start with M", () => {
    expect(parsePenPathFromSerializedD("L 10 10")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parsePenPathFromSerializedD("not a path")).toBeNull();
  });

  // closePenPath (pen-path.ts) requires >1 node to actually close; reimplemented
  // minimally here rather than importing internal test-only behavior twice.
  function closePenPathForTest(path: PenPath): PenPath {
    const cloned = clonePenPath(path);
    return { nodes: cloned.nodes, closed: cloned.nodes.length > 1 };
  }
});
