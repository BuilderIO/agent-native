import * as t from "@babel/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSlideSource: vi.fn(),
  updateSlideSource: vi.fn(),
  getCurrentRequestBrowserTabId: vi.fn(),
  readAppStateForCurrentTab: vi.fn(),
}));

vi.mock("./get-slide-source.js", () => ({
  default: { run: mocks.getSlideSource },
}));

vi.mock("./update-slide-source.js", () => ({
  default: { run: mocks.updateSlideSource },
}));

vi.mock("./_tab-state.js", () => ({
  getCurrentRequestBrowserTabId: mocks.getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
}));

import {
  parseSource,
  walkJsx,
} from "../server/lib/slide-source-editing/babel-walk.js";
import { applyEditBatch } from "../server/lib/slide-source-editing/batch-edit.js";
import {
  planSlideObjectTransform,
  slideObjectTransformOperationSchema,
} from "./transform-slide-objects.js";
import action from "./transform-slide-objects.js";

const source = `export default function Slide() {
  return (
    <div style={{ width: "1920px", height: "1080px" }}>
      <div data-slide-object-id="a" style={{ position: "absolute", left: "100px", top: "100px", width: "100px", height: "50px", zIndex: 0 }} />
      <div data-slide-object-id="b" style={{ position: "absolute", left: "300px", top: "100px", width: "100px", height: "50px", zIndex: 2 }} />
      <div data-slide-object-id="c" style={{ position: "absolute", left: "600px", top: "100px", width: "100px", height: "50px", zIndex: 1 }} />
    </div>
  );
}`;

function locatorFor(sourceText: string, objectId: string) {
  const ast = parseSource(sourceText);
  if (!ast) throw new Error("test source failed to parse");
  let locator: { line: number; column: number } | undefined;
  walkJsx(ast, (node) => {
    if (!t.isJSXElement(node)) return;
    const id = node.openingElement.attributes.find(
      (attribute) =>
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name, { name: "data-slide-object-id" }) &&
        t.isStringLiteral(attribute.value),
    );
    if (
      t.isJSXAttribute(id) &&
      t.isStringLiteral(id.value) &&
      id.value.value === objectId &&
      node.loc
    ) {
      locator = { line: node.loc.start.line, column: node.loc.start.column };
    }
  });
  if (!locator) throw new Error(`missing locator for ${objectId}`);
  return locator;
}

function locatorAt(sourceText: string, value: string) {
  const offset = sourceText.indexOf(value);
  if (offset < 0) throw new Error(`missing source value ${value}`);
  const before = sourceText.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

function styleOps(
  plan: ReturnType<typeof planSlideObjectTransform>,
  id: string,
) {
  if (plan.mode !== "edits") throw new Error("expected source-located edits");
  const locator = locatorFor(source, id);
  return plan.edits.find(
    (edit) => edit.line === locator.line && edit.column === locator.column,
  )?.ops;
}

function styleValue(
  plan: ReturnType<typeof planSlideObjectTransform>,
  id: string,
  key: string,
) {
  return styleOps(plan, id)?.find((op) => op.key === key)?.value;
}

describe("transform-slide-objects planning", () => {
  it("plans a move against the exact source locators", () => {
    const plan = planSlideObjectTransform(source, {
      op: "move",
      targets: [locatorFor(source, "a"), locatorFor(source, "b")],
      dx: 12,
      dy: -7,
    });

    expect(plan).toMatchObject({ mode: "edits", targetCount: 2 });
    expect(styleValue(plan, "a", "left")).toBe("112px");
    expect(styleValue(plan, "a", "top")).toBe("93px");
    expect(styleValue(plan, "b", "left")).toBe("312px");

    if (plan.mode !== "edits") throw new Error("expected source-located edits");
    const applied = applyEditBatch(source, plan.edits);
    expect(applied.results.every((result) => result.ok)).toBe(true);
    expect(parseSource(applied.source)).not.toBeNull();
    expect(applied.source).toContain("left: '112px', top: '93px'");
  });

  it("plans resize, rotation, and slide alignment in canvas coordinates", () => {
    const targets = [locatorFor(source, "a"), locatorFor(source, "b")];
    const resize = planSlideObjectTransform(source, {
      op: "resize",
      targets,
      bounds: { x: 200, y: 200, width: 600, height: 100 },
      preserveAspectRatio: false,
    });
    expect(styleValue(resize, "a", "left")).toBe("200px");
    expect(styleValue(resize, "a", "width")).toBe("200px");
    expect(styleValue(resize, "b", "left")).toBe("600px");

    const rotate = planSlideObjectTransform(source, {
      op: "rotate",
      targets,
      deltaDegrees: 90,
    });
    expect(styleValue(rotate, "a", "left")).toBe("200px");
    expect(styleValue(rotate, "a", "top")).toBe("0px");
    expect(styleValue(rotate, "a", "rotate")).toBe("90deg");

    const align = planSlideObjectTransform(source, {
      op: "align",
      targets,
      alignment: "right",
      reference: "slide",
    });
    expect(styleValue(align, "a", "left")).toBe("1820px");
    expect(styleValue(align, "b", "left")).toBe("1820px");
  });

  it("plans equal-gap distribution and stable same-parent z-order", () => {
    const targets = ["a", "b", "c"].map((id) => locatorFor(source, id));
    const distribute = planSlideObjectTransform(source, {
      op: "distribute",
      targets,
      axis: "horizontal",
    });
    expect(styleValue(distribute, "a", "left")).toBe("100px");
    expect(styleValue(distribute, "b", "left")).toBe("350px");
    expect(styleValue(distribute, "c", "left")).toBe("600px");

    const zOrder = planSlideObjectTransform(source, {
      op: "z-order",
      targets: [locatorFor(source, "a"), locatorFor(source, "b")],
      target: "front",
    });
    expect(styleValue(zOrder, "c", "zIndex")).toBe("0");
    expect(styleValue(zOrder, "a", "zIndex")).toBe("1");
    expect(styleValue(zOrder, "b", "zIndex")).toBe("2");
  });

  it("groups adjacent source siblings and can ungroup the generated container", () => {
    const grouped = planSlideObjectTransform(source, {
      op: "group",
      targets: [locatorFor(source, "a"), locatorFor(source, "b")],
    });
    expect(grouped.mode).toBe("source");
    if (grouped.mode !== "source")
      throw new Error("expected source replacement");
    expect(parseSource(grouped.sourceTsx)).not.toBeNull();
    expect(grouped.sourceTsx).toContain('data-slide-group="true"');
    expect(grouped.sourceTsx).toContain("left: '0px', top: '0px'");
    expect(grouped.sourceTsx).toContain("left: '200px', top: '0px'");

    const ungrouped = planSlideObjectTransform(grouped.sourceTsx, {
      op: "ungroup",
      target: locatorFor(grouped.sourceTsx, grouped.createdObjectId!),
    });
    expect(ungrouped.mode).toBe("source");
    if (ungrouped.mode !== "source")
      throw new Error("expected source replacement");
    expect(parseSource(ungrouped.sourceTsx)).not.toBeNull();
    expect(ungrouped.sourceTsx).not.toContain('data-slide-group="true"');
    expect(ungrouped.sourceTsx).toContain("left: '100px', top: '100px'");
    expect(ungrouped.sourceTsx).toContain("left: '300px', top: '100px'");
  });

  it("preserves child paint order and the group stack level when ungrouping", () => {
    const groupedSource = `export default function Slide() {
  return (
    <div style={{ width: "1920px", height: "1080px" }}>
      <div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="group" style={{ position: "absolute", left: "100px", top: "100px", width: "100px", height: "50px", zIndex: 4 }}>
        <div data-slide-object-id="front-first" style={{ position: "absolute", left: "50px", top: "0px", width: "40px", height: "30px", zIndex: 4 }} />
        <div data-slide-object-id="back-second" style={{ position: "absolute", left: "0px", top: "0px", width: "40px", height: "30px", zIndex: 1 }} />
      </div>
      <div data-slide-object-id="outside" style={{ position: "absolute", left: "300px", top: "100px", width: "40px", height: "30px", zIndex: 4 }} />
    </div>
  );
}`;

    const ungrouped = planSlideObjectTransform(groupedSource, {
      op: "ungroup",
      target: locatorFor(groupedSource, "group"),
    });

    expect(ungrouped.mode).toBe("source");
    if (ungrouped.mode !== "source")
      throw new Error("expected source replacement");
    const backSecond = ungrouped.sourceTsx.indexOf(
      'data-slide-object-id="back-second"',
    );
    const frontFirst = ungrouped.sourceTsx.indexOf(
      'data-slide-object-id="front-first"',
    );
    const outside = ungrouped.sourceTsx.indexOf(
      'data-slide-object-id="outside"',
    );
    expect(backSecond).toBeGreaterThanOrEqual(0);
    expect(backSecond).toBeLessThan(frontFirst);
    expect(frontFirst).toBeLessThan(outside);
    expect(ungrouped.sourceTsx.match(/zIndex: '4'/g)).toHaveLength(2);
    expect(parseSource(ungrouped.sourceTsx)).not.toBeNull();

    const autoStackSource = groupedSource.replace(
      'height: "50px", zIndex: 4 }}>',
      'height: "50px", zIndex: "auto" }}>',
    );
    const autoUngrouped = planSlideObjectTransform(autoStackSource, {
      op: "ungroup",
      target: locatorFor(autoStackSource, "group"),
    });
    expect(autoUngrouped.mode).toBe("source");
    if (autoUngrouped.mode !== "source")
      throw new Error("expected source replacement");
    expect(
      autoUngrouped.sourceTsx.indexOf('data-slide-object-id="back-second"'),
    ).toBeLessThan(
      autoUngrouped.sourceTsx.indexOf('data-slide-object-id="front-first"'),
    );
    expect(autoUngrouped.sourceTsx.match(/zIndex: 'auto'/g)).toHaveLength(2);
  });

  it("preserves negative stack position and requires stable object IDs", () => {
    const negativeZSource = source
      .replace("zIndex: 0", "zIndex: -3")
      .replace("zIndex: 2", "zIndex: -2");
    const grouped = planSlideObjectTransform(negativeZSource, {
      op: "group",
      targets: [
        locatorFor(negativeZSource, "a"),
        locatorFor(negativeZSource, "b"),
      ],
    });
    expect(grouped.mode).toBe("source");
    if (grouped.mode !== "source")
      throw new Error("expected source replacement");
    expect(grouped.sourceTsx).toContain('boxSizing: "border-box", zIndex: -2');

    const withoutStableId = source.replace(' data-slide-object-id="a"', "");
    expect(() =>
      planSlideObjectTransform(withoutStableId, {
        op: "group",
        targets: [locatorFor(source, "a"), locatorFor(source, "b")],
      }),
    ).toThrow(/static data-slide-object-id/);
  });

  it("plans insert, duplicate, and delete as source replacements", () => {
    const inserted = planSlideObjectTransform(source, {
      op: "insert",
      kind: "text",
      geometry: { left: 20, top: 30, width: 240, height: 80 },
      text: "Agent object",
    });
    expect(inserted.mode).toBe("source");
    if (inserted.mode !== "source") throw new Error("expected source write");
    expect(inserted.createdObjectId).toBe("slides2-text-1");
    expect(inserted.createdLocator).toBeDefined();
    expect(inserted.sourceTsx).toContain('id="slides2-text-1"');
    expect(parseSource(inserted.sourceTsx)).not.toBeNull();
    if (!inserted.createdLocator)
      throw new Error("insert did not return locator");

    const duplicated = planSlideObjectTransform(inserted.sourceTsx, {
      op: "duplicate",
      target: inserted.createdLocator,
    });
    expect(duplicated.mode).toBe("source");
    if (duplicated.mode !== "source") throw new Error("expected source write");
    expect(duplicated.createdObjectId).toBe("slides2-text-2");
    expect(duplicated.createdLocator).toBeDefined();
    expect(duplicated.sourceTsx.match(/id="slides2-text-\d+"/g)).toHaveLength(
      2,
    );
    if (!duplicated.createdLocator)
      throw new Error("duplicate did not return locator");

    const deleted = planSlideObjectTransform(duplicated.sourceTsx, {
      op: "delete",
      target: duplicated.createdLocator,
    });
    expect(deleted.mode).toBe("source");
    if (deleted.mode !== "source") throw new Error("expected source write");
    expect(deleted.sourceTsx).not.toContain('id="slides2-text-2"');
    expect(deleted.sourceTsx).toContain('id="slides2-text-1"');
    expect(parseSource(deleted.sourceTsx)).not.toBeNull();
  });

  it("rejects flow, computed, and spread geometry instead of guessing", () => {
    const flowSource = source.replace('position: "absolute", ', "");
    expect(() =>
      planSlideObjectTransform(flowSource, {
        op: "move",
        targets: [locatorFor(flowSource, "a")],
        dx: 1,
        dy: 1,
      }),
    ).toThrow(/flow layout/);

    const dynamicSource = source.replace('left: "100px"', "left: x");
    expect(() =>
      planSlideObjectTransform(dynamicSource, {
        op: "move",
        targets: [locatorFor(dynamicSource, "a")],
        dx: 1,
        dy: 1,
      }),
    ).toThrow(/dynamic or missing left geometry/);

    const scaledSource = source.replace(
      'position: "absolute", left: "100px"',
      'position: "absolute", scale: "1.25", left: "100px"',
    );
    expect(() =>
      planSlideObjectTransform(scaledSource, {
        op: "align",
        targets: [locatorFor(scaledSource, "a")],
        alignment: "center",
        reference: "slide",
      }),
    ).toThrow(/non-identity CSS scale value/);

    const spreadSource = source.replace(
      'position: "absolute", ',
      '...positionStyle, position: "absolute", ',
    );
    expect(() =>
      planSlideObjectTransform(spreadSource, {
        op: "move",
        targets: [locatorFor(spreadSource, "a")],
        dx: 1,
        dy: 1,
      }),
    ).toThrow(/spread or computed property/);

    const crossParentSource = `export default function Slide() {
  return (
    <div>
      <section><div data-slide-object-id="a" style={{ position: "absolute", left: "10px", top: "10px", width: "40px", height: "40px" }} /></section>
      <section><div data-slide-object-id="b" style={{ position: "absolute", left: "80px", top: "10px", width: "40px", height: "40px" }} /></section>
    </div>
  );
}`;
    expect(() =>
      planSlideObjectTransform(crossParentSource, {
        op: "move",
        targets: [
          locatorFor(crossParentSource, "a"),
          locatorFor(crossParentSource, "b"),
        ],
        dx: 1,
        dy: 1,
      }),
    ).toThrow(/direct siblings in the same JSX parent/);
  });

  it("exposes every canvas operation in the action schema", () => {
    const targets = [locatorFor(source, "a"), locatorFor(source, "b")];
    const operations = [
      { op: "move", targets, dx: 1, dy: 1 },
      {
        op: "resize",
        targets,
        bounds: { x: 0, y: 0, width: 300, height: 100 },
      },
      { op: "rotate", targets, deltaDegrees: 15 },
      { op: "align", targets, alignment: "center" },
      {
        op: "distribute",
        targets: [...targets, locatorFor(source, "c")],
        axis: "vertical",
      },
      { op: "group", targets },
      { op: "ungroup", target: targets[0] },
      { op: "z-order", targets, target: "backward" },
      { op: "insert", kind: "rectangle" },
      { op: "duplicate", target: targets[0] },
      { op: "delete", target: targets[0] },
    ];

    expect(
      operations.map(
        (operation) =>
          slideObjectTransformOperationSchema.safeParse(operation).success,
      ),
    ).toEqual(operations.map(() => true));
    expect(
      slideObjectTransformOperationSchema.safeParse({
        op: "insert",
        kind: "rectangle",
        text: "not text content",
      }).success,
    ).toBe(false);
  });
});

describe("transform-slide-objects action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentRequestBrowserTabId.mockReturnValue("tab-1");
    mocks.readAppStateForCurrentTab.mockResolvedValue(null);
    mocks.getSlideSource.mockResolvedValue({
      slide: { sourceTsx: source, revision: 3, sourceHash: "a".repeat(64) },
    });
    mocks.updateSlideSource.mockResolvedValue({
      revision: 4,
      sourceHash: "b".repeat(64),
      notificationStatus: "sent",
    });
  });

  it("reads and updates through the revision-checked source action", async () => {
    const context = {
      caller: "frontend",
      actionName: "transform-slide-objects",
    };
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "move",
          targets: [locatorFor(source, "a")],
          dx: 10,
          dy: 5,
        },
      } as never,
      context as never,
    );

    expect(mocks.getSlideSource).toHaveBeenCalledWith(
      { deckId: "deck-1", slideId: "slide-1" },
      context,
    );
    expect(mocks.updateSlideSource).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        edits: [
          expect.objectContaining({
            line: locatorFor(source, "a").line,
            column: locatorFor(source, "a").column,
            ops: expect.arrayContaining([
              { kind: "set-style", key: "left", value: "110px" },
              { kind: "set-style", key: "top", value: "105px" },
            ]),
          }),
        ],
      }),
      context,
    );
    expect(result).toMatchObject({
      revision: 4,
      operation: "move",
      targetCount: 1,
    });
  });

  it("saves object insertion through the revision-checked source action", async () => {
    const result = await action.run(
      {
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "insert",
          kind: "rectangle",
          geometry: { left: 40, top: 60, width: 200, height: 100 },
        },
      } as never,
      { caller: "frontend", actionName: "transform-slide-objects" } as never,
    );

    expect(mocks.updateSlideSource).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        sourceTsx: expect.stringContaining('id="slides2-rectangle-1"'),
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({
      revision: 4,
      operation: "insert",
      targetCount: 1,
      createdObjectId: "slides2-rectangle-1",
      createdLocator: {
        line: expect.any(Number),
        column: expect.any(Number),
      },
    });
  });

  it("saves exact-locator duplicate and delete operations with source CAS", async () => {
    const sourceWithoutEditorIds = `export default function Slide() {
  return <div><p>Selected</p><p>Keep</p></div>;
}`;
    const target = locatorAt(sourceWithoutEditorIds, "<p>Selected</p>");
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-1",
      sourceRevision: 3,
      sourceHash: "a".repeat(64),
      items: [
        {
          sourceLine: target.line,
          sourceColumn: target.column,
          instanceIndex: 0,
          instanceCount: 1,
        },
      ],
    });

    for (const operation of [
      { op: "duplicate", target },
      { op: "delete", target },
    ] as const) {
      mocks.getSlideSource.mockResolvedValueOnce({
        slide: {
          sourceTsx: sourceWithoutEditorIds,
          revision: 3,
          sourceHash: "a".repeat(64),
        },
      });

      await action.run(
        {
          deckId: "deck-1",
          slideId: "slide-1",
          expectedRevision: 3,
          expectedSourceHash: "a".repeat(64),
          operation,
        } as never,
        { caller: "frontend", actionName: "transform-slide-objects" } as never,
      );

      expect(mocks.updateSlideSource).toHaveBeenLastCalledWith(
        expect.objectContaining({
          deckId: "deck-1",
          slideId: "slide-1",
          expectedRevision: 3,
          expectedSourceHash: "a".repeat(64),
          sourceTsx: expect.any(String),
        }),
        expect.anything(),
      );
    }

    expect(mocks.readAppStateForCurrentTab).toHaveBeenCalledWith(
      "slides-2:slides-selection",
      { fallbackToGlobal: false },
    );
  });

  it("requires duplicate and delete to match the current tab selection", async () => {
    const sourceWithoutEditorIds = `export default function Slide() {
  return <div><p>Selected</p><p>Keep</p></div>;
}`;
    const target = locatorAt(sourceWithoutEditorIds, "<p>Selected</p>");

    for (const operation of [
      { op: "duplicate", target },
      { op: "delete", target },
    ] as const) {
      await expect(
        action.run(
          {
            deckId: "deck-1",
            slideId: "slide-1",
            expectedRevision: 3,
            expectedSourceHash: "a".repeat(64),
            operation,
          } as never,
          {
            caller: "frontend",
            actionName: "transform-slide-objects",
          } as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "slide_transform_selection_required",
      });
    }

    expect(mocks.readAppStateForCurrentTab).toHaveBeenCalledTimes(2);
    expect(mocks.getSlideSource).not.toHaveBeenCalled();
    expect(mocks.updateSlideSource).not.toHaveBeenCalled();
  });

  it.each([
    ["missing rendered-instance metadata", {}],
    ["a shared rendered callsite", { instanceIndex: 0, instanceCount: 2 }],
  ])("rejects duplicate and delete with %s", async (_case, metadata) => {
    const sourceWithoutEditorIds = `export default function Slide() {
  return <div><p>Selected</p><p>Keep</p></div>;
}`;
    const target = locatorAt(sourceWithoutEditorIds, "<p>Selected</p>");
    mocks.readAppStateForCurrentTab.mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-1",
      sourceRevision: 3,
      sourceHash: "a".repeat(64),
      items: [
        {
          sourceLine: target.line,
          sourceColumn: target.column,
          ...metadata,
        },
      ],
    });

    for (const operation of [
      { op: "duplicate", target },
      { op: "delete", target },
    ] as const) {
      await expect(
        action.run(
          {
            deckId: "deck-1",
            slideId: "slide-1",
            expectedRevision: 3,
            expectedSourceHash: "a".repeat(64),
            operation,
          } as never,
          {
            caller: "frontend",
            actionName: "transform-slide-objects",
          } as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "slide_transform_selection_required",
      });
    }

    expect(mocks.getSlideSource).not.toHaveBeenCalled();
    expect(mocks.updateSlideSource).not.toHaveBeenCalled();
  });

  it.each([
    ["deck", { deckId: "deck-2" }],
    ["slide", { slideId: "slide-2" }],
    ["revision", { sourceRevision: 2 }],
    ["source hash", { sourceHash: "b".repeat(64) }],
    ["locator", { items: [{ sourceLine: 1, sourceColumn: 0 }] }],
  ])(
    "rejects duplicate when the request-tab selection has a different %s",
    async (_, override) => {
      const sourceWithoutEditorIds = `export default function Slide() {
  return <div><p>Selected</p><p>Keep</p></div>;
}`;
      const target = locatorAt(sourceWithoutEditorIds, "<p>Selected</p>");
      mocks.readAppStateForCurrentTab.mockResolvedValue({
        deckId: "deck-1",
        slideId: "slide-1",
        sourceRevision: 3,
        sourceHash: "a".repeat(64),
        items: [
          {
            sourceLine: target.line,
            sourceColumn: target.column,
            instanceIndex: 0,
            instanceCount: 1,
          },
        ],
        ...override,
      });

      await expect(
        action.run(
          {
            deckId: "deck-1",
            slideId: "slide-1",
            expectedRevision: 3,
            expectedSourceHash: "a".repeat(64),
            operation: { op: "duplicate", target },
          } as never,
          {
            caller: "frontend",
            actionName: "transform-slide-objects",
          } as never,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "slide_transform_selection_required",
      });

      expect(mocks.getSlideSource).not.toHaveBeenCalled();
      expect(mocks.updateSlideSource).not.toHaveBeenCalled();
    },
  );

  it("requires a request browser tab for duplicate and delete", async () => {
    const target = locatorFor(source, "a");
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);

    await expect(
      action.run(
        {
          deckId: "deck-1",
          slideId: "slide-1",
          expectedRevision: 3,
          expectedSourceHash: "a".repeat(64),
          operation: { op: "delete", target },
        } as never,
        { caller: "frontend", actionName: "transform-slide-objects" } as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "slide_transform_selection_required",
    });

    expect(mocks.readAppStateForCurrentTab).not.toHaveBeenCalled();
    expect(mocks.getSlideSource).not.toHaveBeenCalled();
    expect(mocks.updateSlideSource).not.toHaveBeenCalled();
  });

  it("fails before writing when the selected source revision is stale", async () => {
    mocks.getSlideSource.mockResolvedValue({
      slide: { sourceTsx: source, revision: 4, sourceHash: "b".repeat(64) },
    });

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "move",
          targets: [locatorFor(source, "a")],
          dx: 10,
          dy: 5,
        },
      } as never),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "slide_source_conflict",
      details: { revision: 4, sourceHash: "b".repeat(64) },
    });
    expect(mocks.updateSlideSource).not.toHaveBeenCalled();
  });

  it("reports legacy HTML as unsupported by this source-backed action", async () => {
    mocks.getSlideSource.mockRejectedValue(
      Object.assign(new Error("source missing"), {
        errorCode: "slide_source_missing",
      }),
    );

    await expect(
      action.run({
        deckId: "deck-1",
        slideId: "slide-1",
        expectedRevision: 3,
        expectedSourceHash: "a".repeat(64),
        operation: {
          op: "move",
          targets: [locatorFor(source, "a")],
          dx: 10,
          dy: 5,
        },
      } as never),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "slide_transform_legacy_unsupported",
    });
    expect(mocks.updateSlideSource).not.toHaveBeenCalled();
  });
});
