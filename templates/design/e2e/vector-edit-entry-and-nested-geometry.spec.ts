import { expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Vector edit source</title></head>
<body style="margin:0;min-height:600px">
  <main data-agent-native-node-id="main" style="position:relative;min-height:600px">
    <div data-agent-native-node-id="frame" data-agent-native-layer-name="Frame" data-an-primitive="frame"
      style="position:absolute;left:40px;top:120px;width:600px;height:400px">
      <div data-agent-native-node-id="nested" data-agent-native-layer-name="Nested"
        style="position:absolute;left:80px;top:70px;width:280px;height:200px;transform:translate(10px,5px)">
        <svg data-agent-native-node-id="nested-path" data-agent-native-layer-name="Nested path" data-an-primitive="path"
          data-an-pen-nodes='[1,[0,0,null,null,null,null],[100,0,null,null,null,null],[100,80,null,null,null,null],[0,80,null,null,null,null]]'
          viewBox="0 0 100 80" preserveAspectRatio="none"
          style="position:absolute;left:15.25px;top:20.5px;width:100px;height:80px;overflow:visible;opacity:0.5;filter:drop-shadow(0 1px 2px #000)">
          <path d="M 0 0 L 100 0 L 100 80 L 0 80 Z" fill="#336699" stroke="none" />
        </svg>
      <div data-agent-native-node-id="editable-ellipse" data-agent-native-layer-name="Editable ellipse" data-an-primitive="ellipse"
        style="position:absolute;left:145px;top:105px;width:48px;height:48px;transform:translate(10px,5px);background-color:rgb(204, 51, 102);border:0;border-radius:50%;opacity:0.6;filter:blur(1px)"></div>
      </div>
    </div>
    <svg data-agent-native-node-id="exterior-handle-path" data-agent-native-layer-name="Exterior handle path" data-an-primitive="path"
      data-an-pen-nodes='[1,[0,0,null,null,-80,-100],[100,0,100,0,null,null]]'
      viewBox="-80 -100 180 100" preserveAspectRatio="none"
      style="position:absolute;left:390px;top:120px;width:180px;height:100px;overflow:visible">
      <path d="M 0 0 C -80 -100 100 0 100 0" fill="none" stroke="#336699" stroke-width="2" />
    </svg>
  </main>
</body></html>`;

type Point = { x: number; y: number };

test.use({ viewport: { width: 1440, height: 1000 } });

async function openFixture(app: App) {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function selectLayer(app: App, name: string) {
  await expandAllLayers(app.page);
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

/**
 * Drags by a whole number of page pixels, so the pointer's integer rounding cancels out,
 * and returns where the dragged point should land in design px.
 */
async function dragBy(app: App, from: Point, by: Point) {
  const start = await app.pagePoint(from.x, from.y);
  const pageDelta = {
    x: Math.round(by.x * start.scale),
    y: Math.round(by.y * start.scale),
  };
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + pageDelta.x, start.y + pageDelta.y, {
    steps: 8,
  });
  await app.page.mouse.up();
  return {
    x: from.x + pageDelta.x / start.scale,
    y: from.y + pageDelta.y / start.scale,
  };
}

/** Each Pen node's anchor and handles where they render, in screen-document px. */
async function renderedPen(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((svg) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM()!;
    const [, ...nodes] = JSON.parse(svg.getAttribute("data-an-pen-nodes")!) as (
      | number
      | null
    )[][];
    const place = (x: number | null, y: number | null) =>
      x === null || y === null
        ? null
        : {
            x: ctm.a * x + ctm.c * y + ctm.e,
            y: ctm.b * x + ctm.d * y + ctm.f,
          };
    return nodes.map(([x, y, inX, inY, outX, outY]) => ({
      anchor: place(x, y)!,
      in: place(inX, inY),
      out: place(outX, outY),
    }));
  });
}

function expectNear(actual: Point | null, expected: Point, label: string) {
  expect(actual, label).not.toBeNull();
  expect(
    Math.hypot(actual!.x - expected.x, actual!.y - expected.y),
    `${label}: at ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(1.5);
}

/** The vector's geometry and styles as written in a screen document's HTML. */
async function vectorIn(app: App, html: string, nodeId: string) {
  return app.page.evaluate(
    ({ source, id }) => {
      const element = new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector(`[data-agent-native-node-id="${id}"]`)!;
      const path = element.querySelector("path");
      return {
        tag: element.tagName.toLowerCase(),
        pen: element.getAttribute("data-an-pen-nodes"),
        viewBox: element.getAttribute("viewBox"),
        style: element.getAttribute("style"),
        d: path?.getAttribute("d") ?? null,
        fill: path?.getAttribute("fill") ?? null,
      };
    },
    { source: html, id: nodeId },
  );
}

async function savedVector(app: App, designId: string, nodeId: string) {
  return vectorIn(app, await app.savedHtml(designId), nodeId);
}

async function liveVector(app: App, nodeId: string) {
  const html = await app
    .node(nodeId)
    .evaluate((element) => element.ownerDocument.documentElement.outerHTML);
  return vectorIn(app, html, nodeId);
}

test("dragging a nested Pen anchor moves only that anchor, in screen space, and keeps the path's styles", async ({
  app,
}) => {
  const id = await openFixture(app);
  await selectLayer(app, "Nested path");
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator("[data-vector-anchor]")).toHaveCount(4);
  const before = await app.savedNodes(id);
  const pen = await renderedPen(app, "nested-path");
  // Frame 40,120 + Nested 80,70 + translate 10,5 + path 15.25,20.5.
  expectNear(pen[0].anchor, { x: 145.25, y: 215.5 }, "precondition: start");

  const target = await dragBy(app, { x: 145.25, y: 215.5 }, { x: -18, y: -14 });

  await expect
    .poll(async () => (await savedVector(app, id, "nested-path")).pen)
    .not.toBe(before.get("nested-path")!.attrs["data-an-pen-nodes"]);
  await app.settled();
  const after = await renderedPen(app, "nested-path");
  expectNear(after[0].anchor, target, "dragged anchor");
  expectNear(after[1].anchor, { x: 245.25, y: 215.5 }, "top-right anchor");
  expectNear(after[2].anchor, { x: 245.25, y: 295.5 }, "bottom-right anchor");
  expectNear(after[3].anchor, { x: 145.25, y: 295.5 }, "bottom-left anchor");
  const saved = await savedVector(app, id, "nested-path");
  expect(saved, "the saved path is the one rendered").toEqual(
    await liveVector(app, "nested-path"),
  );
  expect(saved.style).toContain("opacity: 0.5");
  expect(saved.style).toContain("drop-shadow");
  expectOnlyChanged(before, await app.savedNodes(id), ["nested-path"]);
});

test("selected Pen anchors round independently and survive undo, redo, and reload", async ({
  app,
}) => {
  const id = await openFixture(app);
  const page = app.page;
  await selectLayer(app, "Nested path");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
  const before = await app.savedNodes(id);
  const savedRadii = async () =>
    (
      JSON.parse((await savedVector(app, id, "nested-path")).pen!) as (
        | number
        | null
      )[][]
    )
      .slice(1)
      .map((node) => node[6] ?? null);

  const selectAnchor = async (index: number) => {
    const anchor = page.locator("[data-vector-anchor]").nth(index);
    const box = (await anchor.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(anchor).toHaveClass(/ring-2/);
  };
  const radiusField = page.getByRole("textbox", { name: "Corner radius" });
  const setRadius = async (index: number, radius: number) => {
    await selectAnchor(index);
    await radiusField.fill(String(radius));
    await radiusField.press("Enter");
    await expect(radiusField).toHaveValue(String(radius));
  };

  await setRadius(1, 12);
  await setRadius(3, 18);
  await expect.poll(savedRadii).toEqual([null, 12, null, 18]);
  await selectAnchor(1);
  await expect(radiusField).toHaveValue("12");
  await selectAnchor(3);
  await expect(radiusField).toHaveValue("18");

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect
    .poll(savedRadii, "undo reverts only the last radius")
    .toEqual([null, 12, null, null]);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect.poll(savedRadii).toEqual([null, 12, null, 18]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), ["nested-path"]);

  await page.reload();
  await selectLayer(app, "Nested path");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
  await selectAnchor(1);
  await expect(radiusField).toHaveValue("12");
  await selectAnchor(3);
  await expect(radiusField).toHaveValue("18");
});

// fixme: product bug: Dragging the top anchor does not move it: the saved anchor stays at (309,305) and the drag pulls out vertical handles
test.fixme("Escape leaves an ellipse untouched, and dragging its top anchor converts it to a path in place", async ({
  app,
}) => {
  const id = await openFixture(app);
  const page = app.page;
  await selectLayer(app, "Editable ellipse");
  const before = await app.savedNodes(id);
  expect(await app.designRect("editable-ellipse")).toEqual({
    x: 285,
    y: 305,
    width: 48,
    height: 48,
  });

  await page.keyboard.press("Enter");
  await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await expect(app.node("editable-ellipse")).toHaveJSProperty("tagName", "DIV");

  await page.keyboard.press("Enter");
  await expect(page.locator("[data-vector-anchor]")).toHaveCount(4);
  const target = await dragBy(app, { x: 309, y: 305 }, { x: 0, y: -18 });

  await expect
    .poll(async () => (await savedVector(app, id, "editable-ellipse")).tag)
    .toBe("svg");
  await app.settled();
  const pen = await renderedPen(app, "editable-ellipse");
  const anchors = pen.map((node) => node.anchor).sort((a, b) => a.y - b.y);
  expectNear(anchors[0], target, "dragged top anchor");
  expectNear(anchors[1], { x: 285, y: 329 }, "left anchor");
  expectNear(anchors[2], { x: 333, y: 329 }, "right anchor");
  expectNear(anchors[3], { x: 309, y: 353 }, "bottom anchor");
  const saved = await savedVector(app, id, "editable-ellipse");
  expect(saved, "the saved path is the one rendered").toEqual(
    await liveVector(app, "editable-ellipse"),
  );
  expect(saved.fill).toBe("rgb(204, 51, 102)");
  expect(saved.style).toContain("transform: translate(10px, 5px)");
  expect(saved.style).toContain("opacity: 0.6");
  expect(saved.style).toContain("filter: blur(1px)");
  expectOnlyChanged(before, await app.savedNodes(id), ["editable-ellipse"]);
});

test("a tangent handle outside the curve's bounds can be grabbed and dragged, moving only that handle", async ({
  app,
}) => {
  const id = await openFixture(app);
  await selectLayer(app, "Exterior handle path");
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator("[data-vector-handle]").first()).toBeVisible();
  const before = await app.savedNodes(id);
  // The viewBox origin -80,-100 sits at the path's 390,120 corner.
  const pen = await renderedPen(app, "exterior-handle-path");
  expectNear(pen[0].out, { x: 390, y: 120 }, "precondition: handle");

  const target = await dragBy(app, { x: 390, y: 120 }, { x: 22, y: -18 });

  await expect
    .poll(async () => (await savedVector(app, id, "exterior-handle-path")).pen)
    .not.toBe(before.get("exterior-handle-path")!.attrs["data-an-pen-nodes"]);
  await app.settled();
  const after = await renderedPen(app, "exterior-handle-path");
  expectNear(after[0].out, target, "dragged handle");
  expectNear(after[0].anchor, { x: 470, y: 220 }, "its anchor");
  expectNear(after[1].anchor, { x: 570, y: 220 }, "end anchor");
  expectNear(after[1].in, { x: 570, y: 220 }, "end anchor's handle");
  expect(
    await savedVector(app, id, "exterior-handle-path"),
    "the saved path is the one rendered",
  ).toEqual(await liveVector(app, "exterior-handle-path"));
  expectOnlyChanged(before, await app.savedNodes(id), ["exterior-handle-path"]);
});
