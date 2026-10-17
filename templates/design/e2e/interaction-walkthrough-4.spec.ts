import type { Page } from "@playwright/test";

import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const ICON_PARTS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:900px;height:700px;background:#ffffff">
  <div data-agent-native-node-id="lens" data-agent-native-layer-name="Lens" style="position:absolute;left:100px;top:60px;width:40px;height:40px;border-radius:50%;background:#18181b"></div>
  <div data-agent-native-node-id="handle" data-agent-native-layer-name="Handle" style="position:absolute;left:200px;top:180px;width:12px;height:60px;background:#18181b"></div>
  <div data-agent-native-node-id="bystander" data-agent-native-layer-name="Bystander" style="position:absolute;left:480px;top:60px;width:120px;height:120px;background:#e4e4e7"></div>
</body></html>`;

const HOME = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:900px;height:700px;background:#ffffff">
  <div data-agent-native-node-id="icon-grid" data-agent-native-layer-name="Icon grid" style="position:absolute;left:600px;top:40px;width:24px;height:24px;outline:1px dashed #d4d4d8"></div>
</body></html>`;

const BOARD_IFRAME =
  "[data-board-surface-layer] iframe[data-design-preview-iframe]";

test.use({ viewport: { width: 1600, height: 1000 } });

type Point = { x: number; y: number };

async function clickCentre(
  app: App,
  nodeId: string,
  modifiers: "Shift"[] = [],
) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(point.x, point.y);
  for (const key of modifiers) await app.page.keyboard.up(key);
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

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

/** The "-" shortcut, then waits until the screen stops moving so coordinates read afterwards are final. */
async function zoomOut(app: App) {
  const frame = app.page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first();
  const before = JSON.stringify(await frame.boundingBox());
  await app.page.keyboard.press("-");
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await frame.boundingBox());
        const stable = now === previous && now !== before;
        previous = now;
        return stable;
      },
      {
        intervals: [100],
        message: "the canvas never settled after zooming out",
      },
    )
    .toBe(true);
}

async function savedBoard(app: App, designId: string) {
  return app
    .savedNodes(designId, "__board__.html")
    .catch(() => new Map<string, SavedNode>());
}

function expectNear(actual: number, expected: number, label: string) {
  expect(
    Math.abs(actual - expected),
    `${label}: ${actual}, expected ${expected}`,
  ).toBeLessThanOrEqual(1.5);
}

test("Align vertical centers on two top-level layers centres both on their shared bounding box and saves only their tops", async ({
  app,
}) => {
  const id = await app.seed(ICON_PARTS);
  await app.open(id);
  await app.zoomToFit();
  await clickCentre(app, "lens");
  await clickCentre(app, "handle", ["Shift"]);
  await expect.poll(() => app.selectedLayers()).toEqual(["Handle", "Lens"]);
  const before = await app.savedNodes(id);

  await app.page
    .getByRole("button", { name: "Align vertical centers" })
    .click();

  await expect(app.node("lens")).toHaveCSS("top", "130px");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("lens"))).toEqual({
    ...styleOf(before.get("lens")),
    top: "130px",
  });
  expect(styleOf(after.get("handle"))).toEqual({
    ...styleOf(before.get("handle")),
    top: "120px",
  });
  expectOnlyChanged(before, after, ["lens", "handle"]);
  expect(await app.designRect("lens")).toEqual({
    x: 100,
    y: 130,
    width: 40,
    height: 40,
  });
  expect(await app.designRect("handle")).toEqual({
    x: 200,
    y: 120,
    width: 12,
    height: 60,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Handle", "Lens"]);
});

// fixme: product bug: The board square reparents into the screen, but its saved style loses position/left/top ("width: 110px; height: 110px; background: ..."), so it renders at the screen's top-left. Drawing on the board also intermittently fails with "This screen changed elsewhere. Your last edit was not saved."
test.fixme("a Shift-drawn board square dragged into the screen lands centred on the release point and leaves the board", async ({
  app,
}) => {
  const id = await app.seed(HOME);
  await app.open(id);
  await app.zoomToFit();
  await zoomOut(app);
  const page = app.page;
  const screenBefore = await app.savedNodes(id);
  const boardBefore = await savedBoard(app, id);
  const start = await snappedPagePoint(app, { x: -230, y: 80 });
  const { scale } = await app.pagePoint(0, 0);

  await page.keyboard.press("r");
  await expect(
    page.getByRole("button", { name: "Rectangle", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down("Shift");
  await drag(page, start.page, {
    x: start.page.x + Math.round(70 * scale),
    y: start.page.y + Math.round(111 * scale),
  });
  await page.keyboard.up("Shift");
  await app.settled();

  const board = await savedBoard(app, id);
  const drawn = [...board.values()].filter((node) => !boardBefore.has(node.id));
  expect(
    drawn.map((node) => node.attrs["data-an-primitive"]),
    "one rectangle drawn on the board",
  ).toStrictEqual(["rectangle"]);
  const rectId = drawn[0]!.id;
  const square = styleOf(drawn[0]);
  expect(square.width, "Shift locks the rectangle to a square").toBe(
    square.height,
  );
  expectNear(
    parseFloat(square.width),
    Math.round(111 * scale) / scale,
    "the square follows the longer drag side",
  );
  expectOnlyChanged(screenBefore, await app.savedNodes(id), []);

  const onBoard = (await page
    .locator(BOARD_IFRAME)
    .contentFrame()
    .locator(`[data-agent-native-node-id="${rectId}"]`)
    .boundingBox())!;
  const release = await snappedPagePoint(app, { x: 300, y: 260 });
  await drag(
    page,
    { x: onBoard.x + onBoard.width / 2, y: onBoard.y + onBoard.height / 2 },
    release.page,
  );
  await app.settled();

  const screenAfter = await app.savedNodes(id);
  const body = [...screenAfter.values()].find((node) => node.tag === "body")!;
  const moved = screenAfter.get(rectId);
  expect(moved?.parent, "reparented into the screen body").toBe(body.id);
  expect((await savedBoard(app, id)).has(rectId), "left the board").toBe(false);
  const { style: _boardStyle, ...boardAttrs } = drawn[0]!.attrs;
  const { style: _screenStyle, ...screenAttrs } = moved!.attrs;
  expect(
    screenAttrs,
    "a cross-file move marks the layer as a style-preserving clone root",
  ).toEqual({
    ...boardAttrs,
    "data-agent-native-clone-root": "true",
    "data-agent-native-preserve-styles": "true",
  });
  const landed = styleOf(moved);
  expect({ width: landed.width, height: landed.height }).toEqual({
    width: square.width,
    height: square.height,
  });
  const side = parseFloat(square.width);
  expectNear(
    parseFloat(landed.left),
    release.design.x - side / 2,
    `saved left in "${moved!.attrs.style}"`,
  );
  expectNear(
    parseFloat(landed.top),
    release.design.y - side / 2,
    `saved top in "${moved!.attrs.style}"`,
  );
  expectOnlyChanged(screenBefore, screenAfter, [rectId]);
  const rendered = await app.designRect(rectId);
  expectNear(
    rendered.x + rendered.width / 2,
    release.design.x,
    "rendered centre x",
  );
  expectNear(
    rendered.y + rendered.height / 2,
    release.design.y,
    "rendered centre y",
  );
});
