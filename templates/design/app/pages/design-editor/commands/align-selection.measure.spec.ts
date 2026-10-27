// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planAlignSelection } from "@/pages/design-editor/commands/align-selection";
import {
  measureAlignNodes,
  type MeasuredAlignNode,
} from "@/pages/design-editor/layout-operations";

type Box = { x: number; y: number; width: number; height: number };

/** jsdom has no layout, so each test places elements where a browser would. */
function place(element: Element, box: Box | null) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      left: box?.x ?? 0,
      top: box?.y ?? 0,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      right: (box?.x ?? 0) + (box?.width ?? 0),
      bottom: (box?.y ?? 0) + (box?.height ?? 0),
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => ({ length: box ? 1 : 0 }),
  });
}

function mount(html: string) {
  document.body.innerHTML = html;
  const byId = (id: string) => {
    const element = document.querySelector(
      `[data-agent-native-node-id="${id}"]`,
    );
    if (!element) throw new Error(`fixture element ${id} not found`);
    return element;
  };
  return byId;
}

function measure(
  ids: string[],
  byId: (id: string) => Element,
  options: { screenIsAlignable?: boolean; checkNestedLayers?: boolean } = {},
) {
  const result = measureAlignNodes(
    window,
    ids.map((id) => ({ id, element: byId(id) })),
    {
      screenIsAlignable: options.screenIsAlignable ?? true,
      checkNestedLayers: options.checkNestedLayers ?? false,
    },
  );
  return result;
}

function measured(
  ids: string[],
  byId: (id: string) => Element,
  options?: Parameters<typeof measure>[2],
): MeasuredAlignNode[] {
  const result = measure(ids, byId, options);
  if (result.status !== "measured") {
    throw new Error(`unmeasurable: ${result.nodeId} ${result.reason}`);
  }
  return result.nodes;
}

// Chromium's Typed OM, which jsdom lacks: computed values keep `auto`.
beforeEach(() => {
  Object.defineProperty(Element.prototype, "computedStyleMap", {
    configurable: true,
    value(this: HTMLElement) {
      return {
        get: (property: string) =>
          this.style.getPropertyValue(property) || "auto",
      };
    },
  });
});

afterEach(() => {
  delete (Element.prototype as { computedStyleMap?: unknown }).computedStyleMap;
  document.body.innerHTML = "";
});

describe("measureAlignNodes", () => {
  it("puts layers under different parents in one shared space", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="width:600px;height:200px;box-sizing:border-box;padding:20px">
        <div data-agent-native-node-id="a" style="margin-left:30px">A</div>
      </div>
      <div data-agent-native-node-id="wrapper" style="position:relative;width:300px;height:300px">
        <div data-agent-native-node-id="b" style="position:absolute;left:40px;top:10px;width:120px;height:60px">B</div>
      </div>`);
    place(byId("frame"), { x: 40, y: 40, width: 600, height: 200 });
    place(byId("a"), { x: 90, y: 60, width: 100, height: 40 });
    place(byId("wrapper"), { x: 700, y: 0, width: 300, height: 300 });
    place(byId("b"), { x: 740, y: 10, width: 120, height: 60 });

    const nodes = measured(["a", "b"], byId);
    expect(nodes.map((node) => node.rect)).toEqual([
      { x: 90, y: 60, width: 100, height: 40 },
      { x: 740, y: 10, width: 120, height: 60 },
    ]);

    const plan = planAlignSelection(nodes, "left");
    if (plan.kind !== "offsets") throw new Error(plan.kind);
    // a is the left edge. b's left resolves against its wrapper at 700, so it
    // moves by the shared distance (90 - 740), not to the shared x itself.
    expect(plan.patches.get("a")).toBeUndefined();
    expect(plan.patches.get("b")).toEqual([["left", "-610px"]]);
  });

  it("measures a parent's padding box inside its borders", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="position:relative;width:800px;height:600px;box-sizing:border-box;border:10px solid #999;padding:20px">
        <div data-agent-native-node-id="chip" style="position:absolute;left:300px;top:250px;width:120px;height:60px">Chip</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 800, height: 600 });
    place(byId("chip"), { x: 310, y: 260, width: 120, height: 60 });

    const [chip] = measured(["chip"], byId);
    expect(chip!.parentBox).toEqual({ x: 10, y: 10, width: 780, height: 580 });
    const plan = planAlignSelection([chip!], "right");
    if (plan.kind !== "offsets") throw new Error(plan.kind);
    expect(plan.patches.get("chip")).toEqual([["left", "660px"]]);
  });

  it("maps offsets through a scaled parent", () => {
    const byId = mount(`
      <div data-agent-native-node-id="scaled" style="position:relative;width:800px;height:600px;box-sizing:border-box;transform:matrix(2, 0, 0, 0.5, 0, 0)">
        <div data-agent-native-node-id="inner" style="position:absolute;left:100px;top:100px;width:120px;height:60px">Inner</div>
      </div>`);
    place(byId("scaled"), { x: 0, y: 0, width: 1600, height: 300 });
    place(byId("inner"), { x: 200, y: 50, width: 240, height: 30 });

    const [inner] = measured(["inner"], byId);
    expect(inner!.offsetToShared).toEqual({ a: 2, b: 0, c: 0, d: 0.5 });
    expect(inner!.parentBox).toEqual({ x: 0, y: 0, width: 1600, height: 300 });
    const right = planAlignSelection([inner!], "right");
    const bottom = planAlignSelection([inner!], "bottom");
    if (right.kind !== "offsets" || bottom.kind !== "offsets") {
      throw new Error("expected offsets");
    }
    expect(right.patches.get("inner")).toEqual([["left", "680px"]]);
    expect(bottom.patches.get("inner")).toEqual([["top", "540px"]]);
  });

  it("aligns what is painted, so a translated layer lands visually on the edge", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="position:relative;width:800px;height:600px;box-sizing:border-box">
        <div data-agent-native-node-id="shifted" style="position:absolute;left:100px;top:300px;width:120px;height:60px;transform:matrix(1, 0, 0, 1, 20, 0)">Shifted</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 800, height: 600 });
    place(byId("shifted"), { x: 120, y: 300, width: 120, height: 60 });

    const plan = planAlignSelection(measured(["shifted"], byId), "right");
    if (plan.kind !== "offsets") throw new Error(plan.kind);
    expect(plan.patches.get("shifted")).toEqual([["left", "660px"]]);
  });

  it("refuses a layer that is not rendered instead of measuring it as zero", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="width:600px;height:200px">
        <div data-agent-native-node-id="a">A</div>
        <div data-agent-native-node-id="hidden" style="display:none">Hidden</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 600, height: 200 });
    place(byId("a"), { x: 300, y: 0, width: 100, height: 40 });
    place(byId("hidden"), null);

    expect(measure(["a", "hidden"], byId)).toEqual({
      status: "unmeasurable",
      nodeId: "hidden",
      reason: "not-rendered",
    });
  });

  it("measures a top-level layer against the screen, and a board layer against nothing", () => {
    const byId = mount(
      `<div data-agent-native-node-id="card" style="width:400px;height:300px">Card</div>`,
    );
    place(byId("card"), { x: 0, y: 0, width: 400, height: 300 });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 760,
    });

    const [onScreen] = measured(["card"], byId);
    expect(onScreen!.parentBox).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 760,
    });
    const [onBoard] = measured(["card"], byId, { screenIsAlignable: false });
    expect(onBoard!.parentBox).toBeNull();
  });

  it("classifies in-flow children of flex and grid frames as auto layout children", () => {
    const byId = mount(`
      <div data-agent-native-node-id="row" style="display:flex;flex-direction:row-reverse;width:400px;height:100px">
        <div data-agent-native-node-id="item" style="width:80px;height:40px">Item</div>
        <div data-agent-native-node-id="pinned" style="position:absolute;left:0;top:0;width:10px;height:10px">Pinned</div>
      </div>`);
    place(byId("row"), { x: 0, y: 0, width: 400, height: 100 });
    place(byId("item"), { x: 320, y: 0, width: 80, height: 40 });
    place(byId("pinned"), { x: 0, y: 0, width: 10, height: 10 });

    const [item, pinned] = measured(["item", "pinned"], byId);
    expect(item!.layout).toMatchObject({
      kind: "auto-layout-child",
      parent: { display: "flex", flexDirection: "row-reverse" },
    });
    expect(pinned!.layout).toMatchObject({
      kind: "offset",
      position: "absolute",
    });
  });

  it("reads whether an inset is authored from Typed OM, not from used values", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="position:relative;width:400px;height:300px">
        <div data-agent-native-node-id="chip" style="position:absolute;left:280px;top:0;width:120px;height:60px">Chip</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 400, height: 300 });
    place(byId("chip"), { x: 280, y: 0, width: 120, height: 60 });
    const computed: Record<string, string> = {
      left: "auto",
      right: "0px",
      width: "auto",
      top: "0px",
      bottom: "auto",
      height: "60px",
    };
    Object.defineProperty(byId("chip"), "computedStyleMap", {
      configurable: true,
      value: () => ({ get: (property: string) => computed[property] }),
    });

    const [chip] = measured(["chip"], byId);
    expect(chip!.layout).toMatchObject({
      x: { start: "auto", end: "set", size: "auto", sizePx: 120 },
      y: { start: "set", end: "auto", size: "set" },
    });
    const plan = planAlignSelection([chip!], "left");
    if (plan.kind !== "offsets") throw new Error(plan.kind);
    expect(plan.patches.get("chip")).toEqual([
      ["left", "0px"],
      ["right", "auto"],
      ["width", "120px"],
    ]);
  });

  it("without Typed OM, neutralizes the end inset and keeps the size rather than guess", () => {
    delete (Element.prototype as { computedStyleMap?: unknown })
      .computedStyleMap;
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="position:relative;width:400px;height:300px">
        <div data-agent-native-node-id="chip" style="position:absolute;left:100px;top:0;width:120px;height:60px">Chip</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 400, height: 300 });
    place(byId("chip"), { x: 100, y: 0, width: 120, height: 60 });

    const plan = planAlignSelection(measured(["chip"], byId), "right");
    if (plan.kind !== "offsets") throw new Error(plan.kind);
    expect(plan.patches.get("chip")).toEqual([
      ["left", "280px"],
      ["right", "auto"],
      ["width", "120px"],
    ]);
  });

  it("records the nearest selected ancestor", () => {
    const byId = mount(`
      <div data-agent-native-node-id="outer" style="width:600px;height:400px">
        <div data-agent-native-node-id="middle" style="width:300px;height:200px">
          <div data-agent-native-node-id="leaf" style="width:100px;height:50px">Leaf</div>
        </div>
      </div>`);
    for (const id of ["outer", "middle", "leaf"]) {
      place(byId(id), { x: 0, y: 0, width: 100, height: 50 });
    }

    const nodes = measured(["leaf", "outer", "middle"], byId);
    expect(
      Object.fromEntries(
        nodes.map((node) => [node.id, node.selectedAncestorId]),
      ),
    ).toEqual({ leaf: "middle", outer: null, middle: "outer" });
  });

  it("flags a static layer whose absolute descendants would re-anchor to it", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="position:relative;width:600px;height:400px">
        <div data-agent-native-node-id="card" style="width:300px;height:200px">
          <div style="position:absolute;left:0;top:0;width:10px;height:10px"></div>
        </div>
        <div data-agent-native-node-id="safe" style="width:300px;height:200px">
          <div style="position:relative;width:50px;height:50px">
            <div style="position:absolute;left:0;top:0;width:10px;height:10px"></div>
          </div>
        </div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 600, height: 400 });
    place(byId("card"), { x: 0, y: 0, width: 300, height: 200 });
    place(byId("safe"), { x: 0, y: 200, width: 300, height: 200 });

    const nodes = measured(["card", "safe"], byId, { checkNestedLayers: true });
    expect(nodes.map((node) => node.movesNestedLayers)).toEqual([true, false]);
  });

  it("marks sticky layers unsupported", () => {
    const byId = mount(`
      <div data-agent-native-node-id="frame" style="width:600px;height:400px">
        <div data-agent-native-node-id="bar" style="position:sticky;top:0">Bar</div>
      </div>`);
    place(byId("frame"), { x: 0, y: 0, width: 600, height: 400 });
    place(byId("bar"), { x: 0, y: 0, width: 600, height: 40 });

    expect(measured(["bar"], byId)[0]!.layout).toEqual({ kind: "unsupported" });
  });
});
