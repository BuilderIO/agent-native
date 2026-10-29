// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  disableSlideGroupAutoLayout,
  enableSlideGroupAutoLayout,
  fixSlideLayoutSizing,
  isAutoLayoutSlideGroup,
  moveSlideFlowMember,
  readSlideAutoLayoutFrame,
  readSlideLayoutSizing,
  resolveSlideFlowInsertionIndex,
  setSlideLayoutSizing,
  slideAutoLayoutGroupOf,
  updateSlideAutoLayoutFrame,
  type SlideLayoutMeasure,
} from "./slide-auto-layout";
import { SLIDE_OBJECT_GROUP_CLASS } from "./slide-object-interactions";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createGroup(box: Box): HTMLElement {
  const group = document.createElement("div");
  group.className = SLIDE_OBJECT_GROUP_CLASS;
  group.setAttribute("data-slide-group", "true");
  group.setAttribute("data-slide-object-id", "group");
  group.style.position = "absolute";
  group.style.left = `${box.x}px`;
  group.style.top = `${box.y}px`;
  group.style.width = `${box.width}px`;
  group.style.height = `${box.height}px`;
  group.style.boxSizing = "border-box";
  document.body.append(group);
  return group;
}

function createMember(
  id: string,
  box: Box,
  { text }: { text?: string } = {},
): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-slide-object-id", id);
  element.style.position = "absolute";
  element.style.left = `${box.x}px`;
  element.style.top = `${box.y}px`;
  element.style.width = `${box.width}px`;
  if (text === undefined) element.style.height = `${box.height}px`;
  else element.textContent = text;
  return element;
}

/** Layout boxes by element, as the browser would measure them. */
function measureFrom(boxes: Map<HTMLElement, Box | null>): SlideLayoutMeasure {
  return (element) => {
    const box = boxes.get(element);
    return box === undefined ? null : box;
  };
}

/** A group of three members side by side, deliberately out of DOM order. */
function rowFixture() {
  const group = createGroup({ x: 100, y: 50, width: 360, height: 80 });
  const third = createMember("third", {
    x: 250,
    y: 20,
    width: 100,
    height: 40,
  });
  const first = createMember("first", { x: 10, y: 20, width: 100, height: 40 });
  const second = createMember("second", {
    x: 130,
    y: 20,
    width: 100,
    height: 40,
  });
  group.append(third, first, second);
  const boxes = new Map<HTMLElement, Box | null>([
    [group, { x: 100, y: 50, width: 360, height: 80 }],
    [first, { x: 10, y: 20, width: 100, height: 40 }],
    [second, { x: 130, y: 20, width: 100, height: 40 }],
    [third, { x: 250, y: 20, width: 100, height: 40 }],
  ]);
  return { group, first, second, third, boxes, measure: measureFrom(boxes) };
}

describe("enableSlideGroupAutoLayout", () => {
  it("orders members by position and infers gap and padding so nothing moves", () => {
    const { group, first, second, third, measure } = rowFixture();

    expect(enableSlideGroupAutoLayout(group, measure)).toEqual({
      status: "applied",
    });

    expect(isAutoLayoutSlideGroup(group)).toBe(true);
    expect(Array.from(group.children)).toEqual([first, second, third]);
    expect(group.style.display).toBe("flex");
    expect(group.style.flexDirection).toBe("row");
    expect(group.style.gap).toBe("20px");
    expect(group.style.padding).toBe("20px 10px");
    expect(group.style.alignItems).toBe("flex-start");
    // The group keeps its box; only its members change.
    expect(group.style.width).toBe("360px");
    expect(group.style.position).toBe("absolute");
    for (const member of [first, second, third]) {
      expect(member.style.position).toBe("");
      expect(member.style.left).toBe("");
      expect(member.style.top).toBe("");
      expect(member.style.width).toBe("100px");
      expect(slideAutoLayoutGroupOf(member)).toBe(group);
    }
  });

  it("stacks a column and writes whole pixels from fractional measurements", () => {
    const group = createGroup({ x: 0, y: 0, width: 200, height: 200 });
    const top = createMember("top", {
      x: 20,
      y: 10.4,
      width: 160.6,
      height: 50,
    });
    const bottom = createMember("bottom", {
      x: 20,
      y: 72.3,
      width: 160.6,
      height: 50,
    });
    group.append(bottom, top);
    const measure = measureFrom(
      new Map([
        [group, { x: 0, y: 0, width: 200, height: 200 }],
        [top, { x: 20, y: 10.4, width: 160.6, height: 50 }],
        [bottom, { x: 20, y: 72.3, width: 160.6, height: 50 }],
      ]),
    );

    expect(enableSlideGroupAutoLayout(group, measure).status).toBe("applied");

    expect(Array.from(group.children)).toEqual([top, bottom]);
    expect(group.style.flexDirection).toBe("column");
    expect(group.style.gap).toBe("12px");
    expect(group.style.padding).toBe("10px 19px 78px 20px");
    // A width the author wrote keeps its value; the model only rounds what
    // it writes itself.
    expect(top.style.width).toBe("160.6px");
  });

  it("refuses and writes nothing when a member cannot be measured", () => {
    const { group, second, boxes } = rowFixture();
    boxes.set(second, null);
    const before = group.outerHTML;

    expect(enableSlideGroupAutoLayout(group, measureFrom(boxes))).toEqual({
      status: "refused",
      reason: "unmeasured",
      objectIds: ["second"],
    });
    expect(group.outerHTML).toBe(before);
  });

  it("refuses a group with a member nothing can address", () => {
    const { group, measure } = rowFixture();
    group.append(document.createElement("div"));
    const before = group.outerHTML;

    expect(enableSlideGroupAutoLayout(group, measure)).toMatchObject({
      status: "refused",
      reason: "unidentified-children",
    });
    expect(group.outerHTML).toBe(before);
  });

  it("refuses an inset-sized member whose size was never read", () => {
    const { group, second, boxes } = rowFixture();
    second.style.removeProperty("width");
    second.style.right = "130px";
    boxes.set(second, { x: 130, y: 20, width: 0, height: 0 });

    const result = enableSlideGroupAutoLayout(group, measureFrom(boxes));

    // A 0x0 box is what an unmeasured node looks like: pinning it at that
    // size would collapse it, so the group is left as it was.
    expect(result).toEqual({
      status: "refused",
      reason: "unmeasured",
      objectIds: ["second"],
    });
    expect(isAutoLayoutSlideGroup(group)).toBe(false);
  });

  it("does nothing to a group that already lays out", () => {
    const { group, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    const after = group.outerHTML;

    expect(enableSlideGroupAutoLayout(group, measure)).toEqual({
      status: "unchanged",
    });
    expect(group.outerHTML).toBe(after);
  });
});

describe("disableSlideGroupAutoLayout", () => {
  it("pins each member where it renders", () => {
    const { group, first, second, third, boxes, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    boxes.set(second, { x: 130.4, y: 20, width: 100, height: 40 });

    expect(disableSlideGroupAutoLayout(group, measure)).toEqual({
      status: "applied",
    });

    expect(isAutoLayoutSlideGroup(group)).toBe(false);
    expect(group.style.display).toBe("block");
    expect(Array.from(group.children)).toEqual([first, second, third]);
    expect(second.style.position).toBe("absolute");
    expect(second.style.left).toBe("130px");
    expect(second.style.top).toBe("20px");
    expect(second.style.width).toBe("100px");
    expect(second.style.height).toBe("40px");
    expect(first.style.left).toBe("10px");
    expect(third.style.left).toBe("250px");
  });

  it("leaves a text box that sizes to its text without a height", () => {
    const group = createGroup({ x: 0, y: 0, width: 300, height: 120 });
    const title = createMember(
      "title",
      { x: 0, y: 0, width: 300, height: 40 },
      { text: "Quarterly results" },
    );
    title.classList.add("fmd-text-box");
    const body = createMember("body", { x: 0, y: 60, width: 300, height: 60 });
    group.append(title, body);
    const boxes = new Map<HTMLElement, Box | null>([
      [group, { x: 0, y: 0, width: 300, height: 120 }],
      [title, { x: 0, y: 0, width: 300, height: 40 }],
      [body, { x: 0, y: 60, width: 300, height: 60 }],
    ]);
    enableSlideGroupAutoLayout(group, measureFrom(boxes));

    disableSlideGroupAutoLayout(group, measureFrom(boxes));

    expect(title.style.position).toBe("absolute");
    expect(title.style.top).toBe("0px");
    expect(title.style.height).toBe("");
    expect(body.style.top).toBe("60px");
    expect(body.style.height).toBe("60px");
  });

  it("pins a Hug axis at its rendered size", () => {
    const { group, boxes, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    setSlideLayoutSizing(group, "horizontal", "hug", measure);
    expect(group.style.width).toBe("fit-content");
    boxes.set(group, { x: 100, y: 50, width: 340, height: 80 });

    disableSlideGroupAutoLayout(group, measureFrom(boxes));

    expect(group.style.width).toBe("340px");
  });
});

describe("auto layout sizing", () => {
  it("offers Hug for a group whose members are in flow, and Fixed only before", () => {
    const { group, measure } = rowFixture();
    expect(readSlideLayoutSizing(group, measure)).toBeNull();

    enableSlideGroupAutoLayout(group, measure);

    expect(readSlideLayoutSizing(group, measure)).toEqual({
      sizing: { horizontal: "fixed", vertical: "fixed" },
      available: {
        horizontal: ["fixed", "hug"],
        vertical: ["fixed", "hug"],
      },
    });
  });

  it("hugs a placed group without writing flex sizing from the slide layer", () => {
    const { group, measure } = rowFixture();
    document.body.style.display = "flex";
    enableSlideGroupAutoLayout(group, measure);

    setSlideLayoutSizing(group, "horizontal", "hug", measure);

    expect(group.style.width).toBe("fit-content");
    expect(group.style.flexGrow).toBe("");
    expect(group.style.alignSelf).toBe("");
    document.body.style.removeProperty("display");
  });

  it("offers Hug to a text member but not to an empty shape", () => {
    const group = createGroup({ x: 0, y: 0, width: 300, height: 120 });
    const label = createMember(
      "label",
      { x: 0, y: 0, width: 120, height: 40 },
      { text: "Revenue" },
    );
    const swatch = createMember("swatch", {
      x: 140,
      y: 0,
      width: 40,
      height: 40,
    });
    group.append(label, swatch);
    const measure = measureFrom(
      new Map([
        [group, { x: 0, y: 0, width: 300, height: 120 }],
        [label, { x: 0, y: 0, width: 120, height: 40 }],
        [swatch, { x: 140, y: 0, width: 40, height: 40 }],
      ]),
    );
    enableSlideGroupAutoLayout(group, measure);

    expect(readSlideLayoutSizing(label, measure)?.available.horizontal).toEqual(
      ["fixed", "hug", "fill"],
    );
    expect(
      readSlideLayoutSizing(swatch, measure)?.available.horizontal,
    ).toEqual(["fixed", "fill"]);
    expect(setSlideLayoutSizing(swatch, "horizontal", "hug", measure)).toEqual({
      status: "refused",
      reason: "not-in-layout",
      objectIds: [],
    });
  });

  it("fills the main axis with flex grow and the cross axis with stretch", () => {
    const { group, second, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);

    expect(setSlideLayoutSizing(second, "horizontal", "fill", measure)).toEqual(
      { status: "applied" },
    );
    expect(second.style.flexGrow).toBe("1");
    expect(second.style.flexBasis).toBe("0px");
    expect(second.style.width).toBe("auto");
    expect(readSlideLayoutSizing(second, measure)?.sizing.horizontal).toBe(
      "fill",
    );

    setSlideLayoutSizing(second, "vertical", "fill", measure);
    expect(second.style.alignSelf).toBe("stretch");
    expect(second.style.height).toBe("auto");

    setSlideLayoutSizing(second, "horizontal", "fixed", measure);
    expect(second.style.width).toBe("100px");
    expect(second.style.flexGrow).toBe("0");
  });

  it("freezes a filling member when the group starts to hug it", () => {
    const { group, second, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    setSlideLayoutSizing(second, "horizontal", "fill", measure);

    setSlideLayoutSizing(group, "horizontal", "hug", measure);

    expect(group.style.width).toBe("fit-content");
    expect(second.style.width).toBe("100px");
    expect(second.style.flexGrow).toBe("0");
  });

  it("makes a resized member Fixed and drops the insets the resize wrote", () => {
    const { group, second, boxes, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    setSlideLayoutSizing(second, "horizontal", "fill", measure);
    second.style.left = "140px";
    second.style.top = "20px";
    boxes.set(second, { x: 130, y: 20, width: 150.6, height: 40 });

    fixSlideLayoutSizing(second, ["horizontal"], measureFrom(boxes));

    expect(second.style.left).toBe("");
    expect(second.style.top).toBe("");
    expect(second.style.width).toBe("151px");
    expect(second.style.flexGrow).toBe("0");
  });
});

describe("auto layout frame settings", () => {
  it("reads and writes direction, gap, padding and alignment", () => {
    const { group, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);

    updateSlideAutoLayoutFrame(
      group,
      {
        direction: "vertical",
        gap: 8.6,
        padding: { left: 24 },
        alignment: { main: "center", cross: "end" },
      },
      measure,
    );

    expect(group.style.flexDirection).toBe("column");
    expect(group.style.gap).toBe("9px");
    expect(group.style.padding).toBe("20px 10px 20px 24px");
    expect(group.style.justifyContent).toBe("center");
    expect(group.style.alignItems).toBe("flex-end");
    expect(readSlideAutoLayoutFrame(group, measure)).toMatchObject({
      mode: "vertical",
      gap: 9,
      padding: { top: 20, right: 10, bottom: 20, left: 24 },
      alignment: { main: "center", cross: "end" },
    });
  });

  it("refuses frame settings on a freeform group", () => {
    const { group, measure } = rowFixture();
    expect(updateSlideAutoLayoutFrame(group, { gap: 4 }, measure)).toEqual({
      status: "refused",
      reason: "not-in-layout",
      objectIds: [],
    });
  });
});

describe("reordering members in flow", () => {
  function stubRects(boxes: Map<HTMLElement, Box | null>) {
    for (const [element, box] of boxes) {
      if (!box) continue;
      element.getBoundingClientRect = () =>
        ({
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          right: box.x + box.width,
          bottom: box.y + box.height,
        }) as DOMRect;
    }
  }

  it("finds the slot under the pointer along the group's direction", () => {
    const { group, first, boxes, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    stubRects(boxes);

    expect(resolveSlideFlowInsertionIndex(group, first, { x: 0, y: 40 })).toBe(
      0,
    );
    expect(
      resolveSlideFlowInsertionIndex(group, first, { x: 200, y: 40 }),
    ).toBe(1);
    expect(
      resolveSlideFlowInsertionIndex(group, first, { x: 400, y: 40 }),
    ).toBe(2);
  });

  it("moves a member among the others and reports whether order changed", () => {
    const { group, first, second, third, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);

    expect(moveSlideFlowMember(group, first, 0)).toBe(false);
    expect(moveSlideFlowMember(group, first, 2)).toBe(true);
    expect(Array.from(group.children)).toEqual([second, third, first]);
    expect(moveSlideFlowMember(group, first, 1)).toBe(true);
    expect(Array.from(group.children)).toEqual([second, first, third]);
  });

  it("keeps an absolutely placed member out of the flow order", () => {
    const { group, first, second, third, measure } = rowFixture();
    enableSlideGroupAutoLayout(group, measure);
    const badge = createMember("badge", { x: 0, y: 0, width: 10, height: 10 });
    group.prepend(badge);

    expect(slideAutoLayoutGroupOf(badge)).toBeNull();
    expect(moveSlideFlowMember(group, third, 0)).toBe(true);
    expect(Array.from(group.children)).toEqual([badge, third, first, second]);
  });
});
