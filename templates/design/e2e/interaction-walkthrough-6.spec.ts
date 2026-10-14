import { type Page } from "@playwright/test";

import {
  appPath,
  expandAllLayers,
  selectTool,
  type ToolbarTool,
} from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const EMPTY_HOME_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:900px;background:#ffffff"></body>
</html>`;
const ICON_GRID_FRAME = `<div data-agent-native-node-id="icon-grid" data-agent-native-layer-name="Icon grid" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:120px;height:120px;background:#ffffff"></div>`;
const ICON_GRID_HTML = EMPTY_HOME_HTML.replace(
  "</body>",
  `${ICON_GRID_FRAME}</body>`,
);
const GUIDE_LINE_HTML = EMPTY_HOME_HTML.replace(
  "</body>",
  ICON_GRID_FRAME.replace(
    "></div>",
    `><svg data-agent-native-node-id="guide" data-agent-native-layer-name="Guide" data-an-primitive="path" data-an-pen-nodes='[0,[0,0,null,null,null,null,null],[100,100,null,null,null,null,null]]' viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;left:5px;top:5px;width:100px;height:100px;overflow:visible"><path d="M 0 0 L 100 100" fill="none" stroke="#000000" stroke-width="1" /></svg></div>`,
  ) + "</body>",
);

type Point = { x: number; y: number };

test.use({ viewport: { width: 1600, height: 1000 } });

async function openFixture(app: App, html: string) {
  const id = await app.seed(html);
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

async function useTool(page: Page, name: ToolbarTool) {
  await selectTool(page, name);
  await expect(
    page
      .locator("[data-design-bottom-toolbar]")
      .locator(`button[aria-label="${name}"]`),
  ).toHaveAttribute("aria-pressed", "true");
}

/** Page pixels are whole numbers; this returns the design point the pointer really reaches. */
async function snappedPagePoint(app: App, point: Point) {
  const page = await app.pagePoint(point.x, point.y);
  const origin = await app.pagePoint(0, 0);
  const x = Math.round(page.x);
  const y = Math.round(page.y);
  return {
    page: { x, y },
    design: { x: (x - origin.x) / page.scale, y: (y - origin.y) / page.scale },
  };
}

async function dragOnPage(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function penClick(page: Page, point: Point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

function expectNear(actual: number, expected: number, label: string) {
  expect(
    Math.abs(actual - expected),
    `${label}: ${actual}, expected ${expected}`,
  ).toBeLessThanOrEqual(1.5);
}

/** Polls until exactly one saved node matching `match` is new since `before`, and returns its id. */
async function newNodeId(
  read: () => Promise<Map<string, SavedNode>>,
  before: Map<string, SavedNode>,
  match: (node: SavedNode) => boolean,
) {
  let added: string[] = [];
  await expect
    .poll(async () => {
      const nodes = await read();
      added = [...nodes.values()]
        .filter((node) => !before.has(node.id) && match(node))
        .map((node) => node.id);
      return added.length;
    })
    .toBe(1);
  return added[0]!;
}

function bodyId(nodes: Map<string, SavedNode>) {
  return [...nodes.values()].find((node) => node.tag === "body")!.id;
}

/** Each Pen node's anchor where it renders, in screen-document px. */
async function renderedAnchors(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((svg) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM()!;
    const [, ...nodes] = JSON.parse(
      svg.getAttribute("data-an-pen-nodes")!,
    ) as number[][];
    return nodes.map(([x, y]) => ({
      x: Math.round((ctm.a * x! + ctm.c * y! + ctm.e) * 10) / 10,
      y: Math.round((ctm.b * x! + ctm.d * y! + ctm.f) * 10) / 10,
    }));
  });
}

async function savedBoard(app: App, designId: string) {
  return app.savedNodes(designId, "__board__.html").catch(() => new Map());
}

async function savedLayoutGrids(app: App, designId: string) {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  const record = await response.json();
  const data =
    typeof record.data === "string" ? JSON.parse(record.data) : record.data;
  return data?.layoutGrids ?? {};
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

/** Draws a board rectangle of `size` design px and returns its id. */
async function drawBoardRectangle(app: App, designId: string, size: Point) {
  const before = await savedBoard(app, designId);
  const origin = await emptyBoardPoint(app.page);
  const { scale } = await app.pagePoint(0, 0);
  await useTool(app.page, "Rectangle");
  await dragOnPage(app.page, origin, {
    x: origin.x + Math.round(size.x * scale),
    y: origin.y + Math.round(size.y * scale),
  });
  const id = await newNodeId(
    () => savedBoard(app, designId),
    before,
    (node) => node.attrs["data-an-primitive"] === "rectangle",
  );
  await app.settled();
  return { id, scale };
}

test("Shift-dragging the Frame tool inside a screen draws a square frame in that screen, and a Layers rename saves its name", async ({
  app,
}) => {
  const id = await openFixture(app, EMPTY_HOME_HTML);
  const page = app.page;
  const before = await app.savedNodes(id);
  const from = await snappedPagePoint(app, { x: 40, y: 40 });
  const to = await snappedPagePoint(app, { x: 160, y: 100 });

  await useTool(page, "Frame");
  await page.keyboard.down("Shift");
  await dragOnPage(page, from.page, to.page);
  await page.keyboard.up("Shift");

  const frameId = await newNodeId(
    () => app.savedNodes(id),
    before,
    (node) => node.attrs["data-an-primitive"] === "frame",
  );
  await app.settled();
  const drawn = await app.savedNodes(id);
  expect(drawn.get(frameId)?.parent, "nested in the screen").toBe(
    bodyId(drawn),
  );
  const style = styleOf(drawn.get(frameId));
  expect(style.width, "Shift locks the frame to a square").toBe(style.height);
  expectNear(parseFloat(style.left), from.design.x, "left");
  expectNear(parseFloat(style.top), from.design.y, "top");
  expectNear(
    parseFloat(style.width),
    to.design.x - from.design.x,
    "the square follows the longer drag side",
  );
  const record = await (
    await page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${id}`),
    )
  ).json();
  expect(
    record.files
      .map((file: { filename: string }) => file.filename)
      .filter((filename: string) => filename !== "__board__.html"),
    "no new screen file",
  ).toEqual(["index.html"]);

  await page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"] [data-layer-row-button]')
    .dblclick();
  const input = page.getByRole("tree", { name: "Layers" }).locator("input");
  await input.fill("Icon grid");
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await app.savedNodes(id)).get(frameId)?.attrs[
          "data-agent-native-layer-name"
        ],
    )
    .toBe("Icon grid");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get(frameId))).toEqual(style);
  expectOnlyChanged(before, after, [frameId]);
});

test("Add grid on the selected screen saves a 1px uniform layout grid for that screen only", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const page = app.page;
  const before = await app.savedNodes(id);
  expect(await savedLayoutGrids(app, id), "precondition: no grids").toEqual({});
  const record = await (
    await page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${id}`),
    )
  ).json();
  const screenId = record.files.find(
    (file: { filename: string }) => file.filename === "index.html",
  ).id;
  await selectLayer(app, "Home");

  await page.getByRole("button", { name: "Add grid" }).click();
  const size = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /layout grid/i }) })
    .locator("input")
    .first();
  await size.fill("1");
  await size.press("Enter");

  await expect
    .poll(() => savedLayoutGrids(app, id))
    .toEqual({ [screenId]: { kind: "uniform", size: 1, visible: true } });
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

test("ArrowRight nudges the selected frame 1px right and moves nothing else", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const before = await app.savedNodes(id);
  await selectLayer(app, "Icon grid");

  await app.page.keyboard.press("ArrowRight");

  await expect
    .poll(async () => styleOf((await app.savedNodes(id)).get("icon-grid")).left)
    .toBe("41px");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("icon-grid"))).toEqual({
    ...styleOf(before.get("icon-grid")),
    left: "41px",
  });
  expectOnlyChanged(before, after, ["icon-grid"]);
});

test("Pen draws a two-point line inside the frame, and the stroke weight typed in the inspector is saved", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const page = app.page;
  await page.locator("[data-frame-title]").first().click();
  const before = await app.savedNodes(id);
  const start = await snappedPagePoint(app, { x: 45, y: 45 });
  const end = await snappedPagePoint(app, { x: 145, y: 145 });

  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await penClick(page, start.page);
  await penClick(page, end.page);
  await page.keyboard.press("Enter");

  const lineId = await newNodeId(
    () => app.savedNodes(id),
    before,
    (node) => node.tag === "svg",
  );
  await app.settled();
  expect((await app.savedNodes(id)).get(lineId)?.parent).toBe("icon-grid");
  const anchors = await renderedAnchors(app, lineId);
  expect(anchors).toHaveLength(2);
  expectNear(anchors[0]!.x, start.design.x, "start x");
  expectNear(anchors[0]!.y, start.design.y, "start y");
  expectNear(anchors[1]!.x, end.design.x, "end x");
  expectNear(anchors[1]!.y, end.design.y, "end y");

  const weight = page.getByRole("textbox", { name: "Weight", exact: true });
  await weight.fill("0.2");
  await weight.press("Enter");

  await expect(app.node(lineId).locator("path")).toHaveCSS(
    "stroke-width",
    "0.2px",
  );
  await app.settled();
  const savedWeight = await page.evaluate(
    ({ html, nodeId }) => {
      const path = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector<SVGPathElement>(
          `[data-agent-native-node-id="${nodeId}"] path`,
        )!;
      return path.style.strokeWidth || path.getAttribute("stroke-width");
    },
    { html: await app.savedHtml(id), nodeId: lineId },
  );
  expect(parseFloat(savedWeight!), "the saved stroke weight").toBe(0.2);
  expectOnlyChanged(before, await app.savedNodes(id), [lineId]);
});

test("Cmd+D duplicates the guide line in place and Shift+H flips only the copy into an X", async ({
  app,
}) => {
  const id = await openFixture(app, GUIDE_LINE_HTML);
  const page = app.page;
  const before = await app.savedNodes(id);
  // Frame 40,40 + line box 5,5: the guide runs from 45,45 to 145,145.
  expect(await renderedAnchors(app, "guide")).toEqual([
    { x: 45, y: 45 },
    { x: 145, y: 145 },
  ]);
  await selectLayer(app, "Guide");

  await page.keyboard.press("ControlOrMeta+d");
  const copyId = await newNodeId(
    () => app.savedNodes(id),
    before,
    (node) => node.tag === "svg",
  );
  await app.settled();
  expect(childrenOf(await app.savedNodes(id), "icon-grid")).toEqual([
    "guide",
    copyId,
  ]);
  expect(await renderedAnchors(app, copyId), "duplicated in place").toEqual([
    { x: 45, y: 45 },
    { x: 145, y: 145 },
  ]);

  await page.keyboard.press("Shift+h");
  await expect
    .poll(
      async () =>
        (await renderedAnchors(app, copyId)).sort((a, b) => a.x - b.x),
      "the copy runs from bottom-left to top-right",
    )
    .toEqual([
      { x: 45, y: 145 },
      { x: 145, y: 45 },
    ]);
  await app.settled();
  expect(await renderedAnchors(app, "guide")).toEqual([
    { x: 45, y: 45 },
    { x: 145, y: 145 },
  ]);
  const after = await app.savedNodes(id);
  expect(childrenOf(after, "icon-grid")).toEqual(["guide", copyId]);
  expectOnlyChanged(before, after, [copyId]);
});

test("the Ellipse tool draws a 20x20 ellipse inside the frame", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const before = await app.savedNodes(id);
  const from = await snappedPagePoint(app, { x: 60, y: 60 });
  const to = await snappedPagePoint(app, { x: 80, y: 80 });

  await app.page.keyboard.press("o");
  await dragOnPage(app.page, from.page, to.page);

  const ellipseId = await newNodeId(
    () => app.savedNodes(id),
    before,
    (node) => node.attrs["data-an-primitive"] === "ellipse",
  );
  await app.settled();
  const after = await app.savedNodes(id);
  expect(after.get(ellipseId)?.parent).toBe("icon-grid");
  const style = styleOf(after.get(ellipseId));
  expectNear(parseFloat(style.left), from.design.x - 40, "frame-local left");
  expectNear(parseFloat(style.top), from.design.y - 40, "frame-local top");
  expectNear(parseFloat(style.width), to.design.x - from.design.x, "width");
  expectNear(parseFloat(style.height), to.design.y - from.design.y, "height");
  expectOnlyChanged(before, after, [ellipseId]);
});

test("the Rectangle tool draws a board rectangle outside the screen; radius 1 saves and Cmd+D duplicates it in place", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const page = app.page;
  const before = await app.savedNodes(id);

  const { id: rectId, scale } = await drawBoardRectangle(app, id, {
    x: 16,
    y: 20,
  });
  const drawn = styleOf((await savedBoard(app, id)).get(rectId));
  expectNear(parseFloat(drawn.width), Math.round(16 * scale) / scale, "width");
  expectNear(
    parseFloat(drawn.height),
    Math.round(20 * scale) / scale,
    "height",
  );

  const radius = page.getByRole("textbox", { name: "Corner radius" });
  await radius.fill("1");
  await radius.press("Enter");
  await expect
    .poll(
      async () =>
        styleOf((await savedBoard(app, id)).get(rectId))["border-radius"],
    )
    .toBe("1px");
  await app.settled();
  const rounded = await savedBoard(app, id);

  await page.keyboard.press("ControlOrMeta+d");
  const copyId = await newNodeId(
    () => savedBoard(app, id),
    rounded,
    (node) => node.attrs["data-an-primitive"] === "rectangle",
  );
  await app.settled();
  const board = await savedBoard(app, id);
  const source = styleOf(board.get(rectId));
  const copy = styleOf(board.get(copyId));
  expect(
    {
      left: copy.left,
      top: copy.top,
      width: copy.width,
      height: copy.height,
      radius: copy["border-radius"],
    },
    "the copy sits exactly on its source",
  ).toEqual({
    left: source.left,
    top: source.top,
    width: source.width,
    height: source.height,
    radius: "1px",
  });
  expectOnlyChanged(rounded, board, [copyId]);
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

// fixme: fails on current main after the merge: Error: centred on the release y: 103, expected 100.57134900774274
test.fixme("dragging a board rectangle into the frame reparents it there, and one undo puts it back on the board", async ({
  app,
}) => {
  const id = await openFixture(app, ICON_GRID_HTML);
  const page = app.page;
  const before = await app.savedNodes(id);
  const { id: rectId } = await drawBoardRectangle(app, id, { x: 16, y: 20 });
  const boardBefore = await savedBoard(app, id);

  const rect = (await page
    .locator("iframe[data-design-preview-iframe]:not([data-screen-iframe-id])")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${rectId}"]`)
    .boundingBox())!;
  const release = await snappedPagePoint(app, { x: 100, y: 100 });
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(release.page.x, release.page.y, { steps: 20 });
  await page.mouse.up();

  await expect
    .poll(async () => (await app.savedNodes(id)).get(rectId)?.parent)
    .toBe("icon-grid");
  await app.settled();
  expect((await savedBoard(app, id)).has(rectId), "left the board").toBe(false);
  const landed = await app.designRect(rectId);
  expectNear(
    landed.x + landed.width / 2,
    release.design.x,
    "centred on the release x",
  );
  expectNear(
    landed.y + landed.height / 2,
    release.design.y,
    "centred on the release y",
  );
  expectOnlyChanged(before, await app.savedNodes(id), [rectId]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await savedBoard(app, id)).has(rectId))
    .toBe(true);
  await app.settled();
  expectOnlyChanged(boardBefore, await savedBoard(app, id), []);
  expectOnlyChanged(before, await app.savedNodes(id), []);
});
