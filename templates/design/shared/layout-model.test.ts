import {
  availableSizing,
  canHugContent,
  hasInFlowContent,
  inferFlowArrangement,
  joinFlowPatch,
  layoutPatchesById,
  readLayoutModel,
  readNodeSizing,
  renderedSize,
  writeLayoutChange,
  type LayoutChildrenInput,
  type LayoutNodeInput,
  type LayoutParentInput,
  type LayoutRect,
  type LayoutWrite,
} from "@agent-native/toolkit/canvas-interactions/layout-model";
import { describe, expect, it } from "vitest";

function node(overrides: Partial<LayoutNodeInput> = {}): LayoutNodeInput {
  return { id: "frame", tagName: "div", styles: {}, ...overrides };
}

function child(
  id: string | null,
  rect: LayoutRect | null,
  overrides: Partial<LayoutNodeInput> = {},
): LayoutNodeInput {
  return { id, tagName: "div", styles: {}, rect, ...overrides };
}

function read(children: LayoutNodeInput[], extra = {}): LayoutChildrenInput {
  return {
    status: "read",
    children,
    looseText: false,
    complete: true,
    ...extra,
  };
}

const UNREADABLE: LayoutChildrenInput = {
  status: "unreadable",
  childCount: null,
  hasText: null,
};

function model(
  frame: Partial<LayoutNodeInput>,
  children: LayoutChildrenInput = UNREADABLE,
  parent: LayoutParentInput | null = null,
) {
  return readLayoutModel({ node: node(frame), parent, children });
}

function ok(write: LayoutWrite) {
  if (write.status !== "ok") {
    throw new Error(`expected ok, got ${write.status}: ${write.reason}`);
  }
  return write;
}

const ROW = {
  styles: { display: "flex", flexDirection: "row" },
  declaredSize: { width: "320px", height: "80px" },
  resolvedSize: { horizontal: 320, vertical: 80 },
};

describe("readLayoutModel — the frame", () => {
  it("reads flex direction, wrap, gap, padding, alignment and clipping", () => {
    const { frame } = model({
      styles: {
        display: "flex",
        flexDirection: "column",
        flexWrap: "wrap",
        gap: "12px",
        padding: "8px 16px",
        paddingTop: "4px",
        justifyContent: "space-between",
        alignItems: "center",
        overflow: "hidden",
      },
    });
    expect(frame).toMatchObject({
      mode: "vertical",
      wrap: true,
      gap: 12,
      padding: { top: 4, right: 16, bottom: 8, left: 16 },
      alignment: { main: "start", cross: "center" },
      spacing: "space-between",
      clipContent: true,
    });
  });

  it("reads grid and freeform from display, and flex from utility classes", () => {
    expect(model({ styles: { display: "grid" } }).frame.mode).toBe("grid");
    expect(model({ styles: { display: "block" } }).frame.mode).toBe("none");
    expect(model({ classes: ["flex", "flex-col"] }).frame.mode).toBe(
      "vertical",
    );
  });

  it("reports a gap it cannot read as px as null, not zero", () => {
    expect(model({ styles: { display: "flex", gap: "1rem" } }).frame.gap).toBe(
      null,
    );
  });

  it("keeps the rendered px beside each sizing mode", () => {
    const { frame } = model({
      ...ROW,
      declaredSize: { width: "fit-content", height: "80px" },
      resolvedSize: { horizontal: 212.5, vertical: 80 },
    });
    expect(frame.sizing).toEqual({
      horizontal: { mode: "hug", px: 212.5 },
      vertical: { mode: "fixed", px: 80 },
    });
  });

  it("treats the projection's 0x0 placeholder rect as unmeasured", () => {
    const placeholder = node({ rect: { x: 0, y: 0, width: 0, height: 0 } });
    expect(renderedSize(placeholder, "horizontal")).toBeNull();
    expect(
      renderedSize(node({ resolvedSize: { horizontal: 0 } }), "horizontal"),
    ).toBe(0);
  });
});

describe("readLayoutModel — children", () => {
  it("reads each child's positioning, sizing and pinned edges", () => {
    const { children } = model(
      ROW,
      read([
        child(
          "grow",
          { x: 0, y: 0, width: 200, height: 40 },
          {
            styles: { flexGrow: "1" },
          },
        ),
        child(
          "badge",
          { x: 300, y: 4, width: 12, height: 12 },
          {
            styles: { position: "absolute", right: "4px", top: "4px" },
            declaredSize: { width: "12px", height: "12px" },
          },
        ),
      ]),
    );
    if (children.status !== "read") throw new Error("unreadable");
    expect(children.items[0]).toMatchObject({
      id: "grow",
      positioning: "auto",
      sizing: { horizontal: "fill", vertical: "hug" },
      constraints: null,
    });
    expect(children.items[1]).toMatchObject({
      id: "badge",
      positioning: "absolute",
      sizing: { horizontal: "fixed", vertical: "fixed" },
      constraints: { horizontal: "end", vertical: "start" },
    });
  });

  it("keeps unreadable children distinct from an empty list", () => {
    expect(model({}, UNREADABLE).children.status).toBe("unreadable");
    const empty = model({}, read([]));
    expect(empty.children).toMatchObject({ status: "read", items: [] });
  });
});

describe("readNodeSizing", () => {
  const flexRow: LayoutParentInput = { display: "flex", flexDirection: "row" };

  it("reads Fill from main-axis grow, cross-axis stretch and 100%", () => {
    const grow = node({ styles: { flexGrow: "1" } });
    expect(readNodeSizing(grow, flexRow, "horizontal")).toBe("fill");
    const stretched = node({ declaredSize: { height: "auto" } });
    expect(
      readNodeSizing(
        stretched,
        { ...flexRow, alignItems: "normal" },
        "vertical",
      ),
    ).toBe("fill");
    const full = node({ declaredSize: { width: "100%" } });
    expect(readNodeSizing(full, null, "horizontal")).toBe("fill");
  });

  it("reads Hug from auto, fit-content and max-content", () => {
    for (const width of ["auto", "fit-content", "max-content"]) {
      expect(
        readNodeSizing(
          node({ declaredSize: { width } }),
          { display: "flex", alignItems: "center", flexDirection: "column" },
          "horizontal",
        ),
      ).toBe("hug");
    }
  });

  it("reads a block child's auto width as Fill only in block flow", () => {
    const block = node({ styles: { display: "block" } });
    expect(readNodeSizing(block, { display: "block" }, "horizontal")).toBe(
      "fill",
    );
    expect(readNodeSizing(block, { display: "block" }, "vertical")).toBe("hug");
    const floated = node({ styles: { display: "block", float: "left" } });
    expect(readNodeSizing(floated, { display: "block" }, "horizontal")).toBe(
      "hug",
    );
  });

  it("never reads an absolute child as Fill", () => {
    const absolute = node({
      styles: { position: "absolute", flexGrow: "1" },
    });
    expect(readNodeSizing(absolute, flexRow, "horizontal")).toBe("hug");
  });
});

describe("availability", () => {
  it("offers Hug to auto layout frames and frames with in-flow content", () => {
    expect(
      canHugContent(model({ styles: { display: "flex" } }, read([]))),
    ).toBe(true);
    const freeform = model(
      { primitiveKind: "frame", styles: { display: "block" } },
      read([
        child("a", null, { styles: { position: "absolute" } }),
        child("b", null),
      ]),
    );
    expect(hasInFlowContent(freeform)).toBe(true);
  });

  it("withholds Hug from a freeform frame whose children are all absolute", () => {
    const freeform = model(
      { primitiveKind: "frame", styles: { display: "block" } },
      read([child("a", null, { styles: { position: "absolute" } })]),
    );
    expect(canHugContent(freeform)).toBe(false);
    expect(availableSizing(freeform).horizontal).toEqual(["fixed"]);
  });

  it("does not read an incomplete child list as proof of no flow content", () => {
    const partial = model(
      { styles: { display: "block" } },
      read([child("a", null, { styles: { position: "absolute" } })], {
        complete: false,
      }),
    );
    expect(hasInFlowContent(partial)).toBe(true);
  });

  it("offers Fill only to in-flow children of a layout parent, horizontal in block flow", () => {
    const flexChild = model({}, UNREADABLE, { display: "flex" });
    expect(availableSizing(flexChild).vertical).toContain("fill");
    const blockChild = model({}, UNREADABLE, { display: "block" });
    expect(availableSizing(blockChild).horizontal).toContain("fill");
    expect(availableSizing(blockChild).vertical).not.toContain("fill");
    const absolute = model({ styles: { position: "absolute" } }, UNREADABLE, {
      display: "flex",
    });
    expect(availableSizing(absolute).horizontal).not.toContain("fill");
    expect(availableSizing(model({})).horizontal).not.toContain("fill");
  });

  it("offers Hug on an axis a child fills only while that child can be frozen", () => {
    const frozen = model(
      ROW,
      read([
        child(
          "grow",
          { x: 0, y: 0, width: 80, height: 20 },
          {
            styles: { flexGrow: "1" },
          },
        ),
      ]),
    );
    expect(availableSizing(frozen).horizontal).toContain("hug");
    const unmeasured = model(
      ROW,
      read([child("grow", null, { styles: { flexGrow: "1" } })]),
    );
    expect(availableSizing(unmeasured).horizontal).not.toContain("hug");
    expect(availableSizing(unmeasured).vertical).toContain("hug");
  });

  it("withholds Hug from an auto layout frame whose children could not be read", () => {
    const unread = model(ROW, {
      status: "unreadable",
      childCount: 3,
      hasText: null,
    });
    expect(availableSizing(unread).horizontal).not.toContain("hug");
    expect(
      writeLayoutChange(unread, {
        kind: "sizing",
        sizing: { horizontal: "hug" },
      }).status,
    ).toBe("unreadable");
    const emptyText = model(
      { tagName: "p", styles: { display: "block" } },
      { status: "unreadable", childCount: 0, hasText: true },
    );
    expect(canHugContent(emptyText)).toBe(true);
    expect(availableSizing(emptyText).horizontal).toContain("hug");
  });

  it("withholds Hug from a block container whose children could not be read, since one may be 100% wide", () => {
    const block = model(
      { tagName: "div", styles: { display: "block" } },
      { status: "unreadable", childCount: 2, hasText: null },
    );
    expect(availableSizing(block).horizontal).not.toContain("hug");
    expect(
      writeLayoutChange(block, {
        kind: "sizing",
        sizing: { horizontal: "hug" },
      }).status,
    ).toBe("unreadable");
  });

  it("withholds Hug while the child list was cut short, since a missing child may fill", () => {
    const truncated = model(
      ROW,
      read([child("a", { x: 0, y: 0, width: 80, height: 20 })], {
        complete: false,
      }),
    );
    expect(availableSizing(truncated).horizontal).not.toContain("hug");
    expect(
      writeLayoutChange(truncated, {
        kind: "sizing",
        sizing: { horizontal: "hug" },
      }).status,
    ).toBe("unreadable");
  });
});

describe("writeLayoutChange — sizing", () => {
  it("writes whole px for Fixed from the rendered size", () => {
    const write = ok(
      writeLayoutChange(
        model({ resolvedSize: { horizontal: 119.6 } }, UNREADABLE, {
          display: "flex",
          flexDirection: "row",
        }),
        { kind: "sizing", sizing: { horizontal: "fixed" } },
      ),
    );
    expect(write.frame).toEqual({
      width: "120px",
      flexGrow: "0",
      flexShrink: "0",
      flexBasis: "auto",
    });
  });

  it("refuses Fixed for a layer that was never measured", () => {
    const write = writeLayoutChange(model({}), {
      kind: "sizing",
      sizing: { vertical: "fixed" },
    });
    expect(write).toEqual({
      status: "unreadable",
      reason: "unmeasured",
      nodeIds: ["frame"],
    });
  });

  it("writes Fill per parent layout: grow, stretch, or 100%", () => {
    const fill = (
      parent: LayoutParentInput | null,
      axis: "horizontal" | "vertical",
    ) =>
      ok(
        writeLayoutChange(model({}, UNREADABLE, parent), {
          kind: "sizing",
          sizing: { [axis]: "fill" },
        }),
      ).frame;
    expect(fill({ display: "flex" }, "horizontal")).toEqual({
      flexGrow: "1",
      flexShrink: "0",
      flexBasis: "0",
      width: "auto",
    });
    expect(fill({ display: "grid" }, "horizontal")).toEqual({
      justifySelf: "stretch",
      width: "auto",
    });
    expect(fill({ display: "block" }, "horizontal")).toEqual({
      width: "100%",
    });
  });

  it("Hug on a parent axis flips that axis of Fill children to Fixed at their rendered px", () => {
    const write = ok(
      writeLayoutChange(
        model(
          ROW,
          read([
            child(
              "grow",
              { x: 0, y: 0, width: 199.7, height: 40 },
              {
                styles: { flexGrow: "1" },
              },
            ),
            child(
              "stretch",
              { x: 208, y: 0, width: 40, height: 80 },
              {
                styles: { alignSelf: "stretch" },
              },
            ),
            child(
              "tall",
              { x: 256, y: 0, width: 40, height: 80 },
              {
                declaredSize: { height: "100%" },
              },
            ),
          ]),
        ),
        { kind: "sizing", sizing: { horizontal: "hug", vertical: "hug" } },
      ),
    );
    expect(write.frame).toEqual({
      width: "fit-content",
      height: "fit-content",
    });
    expect(Object.fromEntries(write.children)).toEqual({
      grow: {
        width: "200px",
        flexGrow: "0",
        flexShrink: "0",
        flexBasis: "auto",
      },
      tall: { height: "80px", alignSelf: "auto" },
    });
    expect(Object.fromEntries(layoutPatchesById(write, "frame")).frame).toEqual(
      write.frame,
    );
  });

  it("refuses Hug when a filling child has no measured size to freeze at", () => {
    const write = writeLayoutChange(
      model(ROW, read([child("grow", null, { styles: { flexGrow: "1" } })])),
      { kind: "sizing", sizing: { horizontal: "hug" } },
    );
    expect(write).toMatchObject({ status: "unreadable", nodeIds: ["grow"] });
  });
});

describe("writeLayoutChange — freeform to auto layout", () => {
  const card = () =>
    model(
      {
        styles: { display: "block", position: "absolute" },
        resolvedSize: { horizontal: 200, vertical: 136 },
      },
      read([
        child(
          "second",
          { x: 16, y: 76, width: 168, height: 44 },
          {
            styles: { position: "absolute", left: "16px", top: "76px" },
          },
        ),
        child(
          "first",
          { x: 16, y: 16, width: 168, height: 44 },
          {
            styles: { position: "absolute", left: "16px", top: "16px" },
          },
        ),
        child(
          "panel",
          { x: 24, y: 24, width: 152, height: 0.4 },
          {
            styles: { position: "absolute", inset: "24px" },
          },
        ),
      ]),
    );

  it("orders children by their on-canvas position and infers padding and gap in the frame's own space", () => {
    const write = ok(
      writeLayoutChange(
        model(
          {
            styles: { display: "block" },
            resolvedSize: { horizontal: 200, vertical: 136 },
          },
          read([
            child("second", { x: 16, y: 76, width: 168, height: 44 }),
            child("first", { x: 16, y: 16, width: 168, height: 44 }),
          ]),
        ),
        { kind: "enable-auto-layout" },
      ),
    );
    expect(write.order).toEqual(["first", "second"]);
    expect(write.frame).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px 16px 16px 16px",
    });
  });

  it("keeps a fixed content-box frame's size when it takes the inferred padding", () => {
    const frame = (boxSizing: string) =>
      ok(
        writeLayoutChange(
          model(
            {
              styles: { display: "block", boxSizing },
              declaredSize: { width: "200px", height: "136px" },
              resolvedSize: { horizontal: 200, vertical: 136 },
            },
            read([
              child("second", { x: 16, y: 76, width: 168, height: 44 }),
              child("first", { x: 16, y: 16, width: 168, height: 44 }),
            ]),
          ),
          { kind: "enable-auto-layout" },
        ),
      ).frame;

    expect(frame("content-box")).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px 16px 16px 16px",
      width: "168px",
      height: "104px",
    });
    expect(frame("border-box")).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "16px 16px 16px 16px",
    });
  });

  it("replaces padding and alignment a frame kept from an earlier layout, zero included", () => {
    const write = ok(
      writeLayoutChange(
        model(
          {
            styles: {
              display: "block",
              boxSizing: "content-box",
              padding: "16px",
              justifyContent: "center",
              alignItems: "center",
            },
            declaredSize: { width: "168px", height: "104px" },
            resolvedSize: { horizontal: 200, vertical: 136 },
          },
          read([
            child("first", { x: 0, y: 0, width: 200, height: 60 }),
            child("second", { x: 0, y: 76, width: 120, height: 60 }),
          ]),
        ),
        { kind: "enable-auto-layout" },
      ),
    );
    expect(write.frame).toEqual({
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "0px 0px 0px 0px",
      width: "200px",
      height: "136px",
      alignItems: "flex-start",
      justifyContent: "flex-start",
    });
  });

  it("writes centred or end alignment, never stretch", () => {
    const centred = ok(
      writeLayoutChange(
        model(
          {
            styles: { display: "block", position: "relative" },
            resolvedSize: { horizontal: 200, vertical: 140 },
          },
          read([
            child("a", { x: 40, y: 16, width: 120, height: 44 }),
            child("b", { x: 60, y: 76, width: 80, height: 44 }),
          ]),
        ),
        { kind: "enable-auto-layout" },
      ),
    );
    expect(centred.frame.alignItems).toBe("center");
  });

  it("takes children out of absolute positioning, keeping inset-sized ones at their rendered size", () => {
    const write = ok(
      writeLayoutChange(card(), {
        kind: "enable-auto-layout",
        frame: { display: "flex" },
      }),
    );
    expect(write.frame).toEqual({ display: "flex" });
    expect(write.children.get("first")).toEqual({
      position: null,
      left: null,
      top: null,
      right: null,
      bottom: null,
      inset: null,
    });
    expect(write.children.get("panel")).toMatchObject({
      inset: null,
      width: "152px",
      height: "0px",
    });
  });

  it("changing direction, gap or alignment never touches absolute children", () => {
    const write = ok(
      writeLayoutChange(
        model(
          { styles: { display: "flex", flexDirection: "column" } },
          read([
            child(
              "badge",
              { x: 0, y: 0, width: 12, height: 12 },
              {
                styles: { position: "absolute", right: "4px" },
              },
            ),
          ]),
        ),
        { kind: "enable-auto-layout", frame: { flexDirection: "row" } },
      ),
    );
    expect(write.frame).toEqual({ flexDirection: "row" });
    expect(write.children.size).toBe(0);
  });

  it("refuses when it cannot read the children it would move", () => {
    expect(
      writeLayoutChange(model({ styles: { display: "block" } }), {
        kind: "enable-auto-layout",
      }).status,
    ).toBe("unreadable");
  });
});

describe("writeLayoutChange — auto layout to freeform", () => {
  it("freezes children at their measured rects and holds the frame at its size", () => {
    const write = ok(
      writeLayoutChange(
        model(
          {
            styles: { display: "flex", minHeight: "200px", minWidth: "10px" },
            resolvedSize: { horizontal: 88.4, vertical: 20 },
          },
          read([
            child("a", { x: 0, y: 0, width: 40, height: 20 }),
            child("b", { x: 48.4, y: 0, width: 39.6, height: 20 }),
            child(null, { x: 0, y: 0, width: 1, height: 1 }),
          ]),
        ),
        { kind: "disable-auto-layout" },
      ),
    );
    expect(write.frame).toEqual({
      display: "block",
      position: "relative",
      width: "88px",
      height: "20px",
    });
    expect(write.children.get("b")).toEqual({
      boxSizing: "border-box",
      margin: "0",
      position: "absolute",
      left: "48px",
      top: "0px",
      width: "40px",
      height: "20px",
    });
    expect(write.children.size).toBe(2);
  });

  it("keeps an authored containing block", () => {
    const write = ok(
      writeLayoutChange(
        model(
          {
            styles: { display: "flex", position: "absolute" },
            resolvedSize: { horizontal: 10, vertical: 10 },
          },
          read([]),
        ),
        { kind: "disable-auto-layout" },
      ),
    );
    expect(write.frame.position).toBeUndefined();
  });

  it("refuses a frame with neither measured children nor a measured size", () => {
    expect(
      writeLayoutChange(
        model({ styles: { display: "flex" } }, read([child("a", null)])),
        { kind: "disable-auto-layout" },
      ),
    ).toMatchObject({ status: "unreadable", reason: "unmeasured" });
  });
});

describe("writeLayoutChange — child positioning", () => {
  const frame = () =>
    model(
      { styles: { display: "flex" } },
      read([
        child("a", { x: 8.2, y: 4, width: 40, height: 20 }),
        child("b", null, { styles: { position: "absolute", left: "0" } }),
      ]),
    );

  it("toggling a child to absolute freezes its current position and size", () => {
    const write = ok(
      writeLayoutChange(frame(), {
        kind: "child-positioning",
        childId: "a",
        positioning: "absolute",
      }),
    );
    expect(write.frame).toEqual({ position: "relative" });
    expect(write.children.get("a")).toMatchObject({
      position: "absolute",
      left: "8px",
      top: "4px",
    });
  });

  it("toggling a child back to auto drops its offsets", () => {
    const write = ok(
      writeLayoutChange(frame(), {
        kind: "child-positioning",
        childId: "b",
        positioning: "auto",
      }),
    );
    expect(write.children.get("b")).toMatchObject({
      position: null,
      left: null,
    });
  });

  it("refuses an unknown or unmeasured child", () => {
    expect(
      writeLayoutChange(frame(), {
        kind: "child-positioning",
        childId: "missing",
        positioning: "absolute",
      }),
    ).toMatchObject({ status: "unreadable", reason: "unknown-child" });
    expect(
      writeLayoutChange(frame(), {
        kind: "child-positioning",
        childId: "b",
        positioning: "absolute",
      }),
    ).toMatchObject({ status: "unreadable", reason: "unmeasured" });
  });
});

describe("joinFlowPatch", () => {
  it("leaves a child that sizes itself alone apart from its offsets", () => {
    expect(
      joinFlowPatch(
        child(
          "a",
          { x: 0, y: 0, width: 50, height: 50 },
          {
            styles: {
              position: "absolute",
              left: "0",
              right: "0",
              width: "50px",
            },
          },
        ),
      ),
    ).not.toHaveProperty("width");
  });

  it("pins an inset-sized child's measured size as a border box", () => {
    expect(
      joinFlowPatch(
        child(
          "panel",
          { x: 24, y: 24, width: 272, height: 152 },
          { styles: { position: "absolute", inset: "24px", padding: "16px" } },
        ),
      ),
    ).toMatchObject({
      boxSizing: "border-box",
      width: "272px",
      height: "152px",
    });
  });

  it("keeps the other axis's explicit content-box size when switching to border-box", () => {
    expect(
      joinFlowPatch(
        child(
          "bar",
          { x: 0, y: 180, width: 320, height: 52 },
          {
            styles: {
              position: "absolute",
              left: "0",
              right: "0",
              height: "20px",
              padding: "16px",
            },
          },
        ),
      ),
    ).toMatchObject({
      boxSizing: "border-box",
      width: "320px",
      height: "52px",
    });
  });

  it("refuses when the other axis has a relative size, since neither box sizing keeps both axes", () => {
    expect(
      joinFlowPatch(
        child(
          "bar",
          { x: 0, y: 180, width: 320, height: 52 },
          {
            styles: {
              position: "absolute",
              left: "0",
              right: "0",
              height: "10%",
              padding: "16px",
            },
          },
        ),
      ),
    ).toBeNull();
  });

  it.each([
    ["is already border-box", { boxSizing: "border-box" }, undefined],
    [
      "measures as border-box",
      {},
      { sizing: "border-box", edges: { width: 32, height: 32 } },
    ],
    [
      "has no padding or border along the relative axis",
      {},
      { sizing: "content-box", edges: { width: 32, height: 0 } },
    ],
  ] as const)(
    "keeps a relative size on the other axis when the child %s",
    (_label, extraStyles, box) => {
      const patch = joinFlowPatch(
        child(
          "bar",
          { x: 0, y: 180, width: 320, height: 52 },
          {
            styles: {
              position: "absolute",
              left: "0",
              right: "0",
              height: "10vh",
              ...extraStyles,
            },
            box,
          },
        ),
      );
      expect(patch).toMatchObject({ width: "320px", boxSizing: "border-box" });
      expect(patch).not.toHaveProperty("height");
    },
  );

  it.each(["10%", "calc(100% - 20px)", "var(--bar-height)"])(
    "refuses %s on the other axis even under border-box, since flow resolves it against the parent's content box",
    (height) => {
      expect(
        joinFlowPatch(
          child(
            "bar",
            { x: 0, y: 180, width: 320, height: 20 },
            {
              styles: {
                position: "absolute",
                left: "0",
                right: "0",
                height,
                boxSizing: "border-box",
              },
              box: { sizing: "border-box", edges: { width: 0, height: 0 } },
            },
          ),
        ),
      ).toBeNull();
    },
  );

  it("refuses a measured content-box child with padding along the relative axis", () => {
    expect(
      joinFlowPatch(
        child(
          "bar",
          { x: 0, y: 180, width: 320, height: 52 },
          {
            styles: {
              position: "absolute",
              left: "0",
              right: "0",
              height: "10%",
            },
            box: { sizing: "content-box", edges: { width: 0, height: 32 } },
          },
        ),
      ),
    ).toBeNull();
  });

  it("refuses to join flow when an inset-sized child was never measured", () => {
    expect(
      joinFlowPatch(
        child("panel", null, {
          styles: { position: "absolute", left: "0", right: "0" },
        }),
      ),
    ).toBeNull();
    const freeform = model(
      { styles: { display: "block", position: "relative" } },
      read([
        child("panel", null, {
          styles: { position: "absolute", left: "0", right: "0" },
        }),
      ]),
    );
    expect(
      writeLayoutChange(freeform, { kind: "enable-auto-layout" }).status,
    ).toBe("unreadable");
  });

  it("keeps an in-flow relative child's visible offset", () => {
    expect(
      joinFlowPatch(
        child(
          "nudged",
          { x: 12, y: 6, width: 50, height: 20 },
          { styles: { position: "relative", left: "12px", top: "6px" } },
        ),
      ),
    ).toEqual({});
  });

  it("zeroes an absolute child's margins, which its measured box already includes", () => {
    expect(
      joinFlowPatch(
        child(
          "badge",
          { x: 30, y: 30, width: 40, height: 20 },
          {
            styles: {
              position: "absolute",
              left: "20px",
              top: "20px",
              margin: "10px",
              width: "40px",
              height: "20px",
            },
          },
        ),
      ),
    ).toMatchObject({ position: null, left: null, top: null, margin: "0" });
  });
});

describe("inferFlowArrangement", () => {
  const at = (id: string, x: number, y: number, width = 50, height = 50) => ({
    id,
    rect: { x, y, width, height },
  });

  it("infers Hug only where opposite paddings balance, not from padding measured off the container", () => {
    const lopsided = inferFlowArrangement(
      { x: 0, y: 0, width: 300, height: 70 },
      [at("a", 10, 10), at("b", 80, 10)],
    );
    expect(lopsided?.hugs).toEqual({ horizontal: false, vertical: true });
  });

  it("keeps layer order for children that start at the same point", () => {
    const result = inferFlowArrangement(
      { x: 0, y: 0, width: 300, height: 200 },
      [
        at("title", 0, 0, 120, 47),
        at("sub", 0, 0, 200, 22),
        at("body", 0, 0, 280, 19),
      ],
    );
    expect(result?.order).toEqual(["title", "sub", "body"]);
  });

  it("infers a row when children spread wider than tall", () => {
    const result = inferFlowArrangement(
      { x: 0, y: 0, width: 300, height: 100 },
      [at("a", 10, 10), at("b", 80, 10), at("c", 150, 10)],
    );
    expect(result).toMatchObject({
      direction: "horizontal",
      gap: 20,
      padding: { top: 10, left: 10 },
    });
  });

  it("keeps a stack of rows wider than the stack is tall in column flow", () => {
    const result = inferFlowArrangement(
      { x: 0, y: 0, width: 424, height: 176 },
      [
        at("a", 12, 12, 400, 40),
        at("b", 12, 64, 400, 40),
        at("c", 12, 116, 400, 40),
      ],
    );
    expect(result?.direction).toBe("vertical");
    expect(result?.gap).toBe(12);
  });

  it("keeps a right-aligned stack of unequal rows in column flow", () => {
    const result = inferFlowArrangement(
      { x: 0, y: 0, width: 400, height: 140 },
      [at("a", 0, 0, 400, 40), at("b", 360, 60, 40, 40)],
    );
    expect(result?.direction).toBe("vertical");
    expect(result?.alignItems).toBe("flex-end");
  });

  it("uses the median gap when gaps vary", () => {
    const result = inferFlowArrangement(
      { x: 0, y: 0, width: 400, height: 100 },
      [at("a", 0, 0), at("b", 60, 0), at("c", 130, 0), at("d", 220, 0)],
    );
    expect(result?.gap).toBe(20);
  });

  it("returns null with nothing measured, not a default arrangement", () => {
    expect(
      inferFlowArrangement({ x: 0, y: 0, width: 10, height: 10 }, []),
    ).toBeNull();
  });
});
