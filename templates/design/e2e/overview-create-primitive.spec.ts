import { selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#ffffff">
  <h1 data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="position:absolute;left:40px;top:48px;margin:0;font:600 32px system-ui">Hero</h1>
</body></html>`;

const BOX = { x: 300, y: 200, width: 240, height: 160 };

async function drawRectangle(app: App) {
  await selectTool(app.page, "Rectangle");
  const start = await app.pagePoint(BOX.x, BOX.y);
  const end = await app.pagePoint(BOX.x + BOX.width, BOX.y + BOX.height);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 10 });
  await app.page.mouse.up();
  await app.settled();
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

/** Pointer input lands on whole page pixels, so a dragged edge can be off by one page pixel in design px. */
async function expectBox(app: App, label: string, actual: number[]) {
  const expected = [BOX.x, BOX.y, BOX.width, BOX.height];
  const tolerance = Math.max(
    1,
    Math.ceil(1 / (await app.pagePoint(0, 0)).scale),
  );
  const off = actual.filter(
    (value, index) => Math.abs(value - expected[index]!) > tolerance,
  );
  expect(
    off,
    `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} ±${tolerance}`,
  ).toEqual([]);
}

function savedBox(node: SavedNode) {
  const style = styleOf(node);
  return ["left", "top", "width", "height"].map((key) =>
    Number.parseFloat(style[key]!),
  );
}

function paintOf(node: SavedNode) {
  const {
    left: _left,
    top: _top,
    width: _width,
    height: _height,
    ...rest
  } = styleOf(node);
  return rest;
}

async function layerRows(app: App) {
  return app.page
    .locator('[role="treeitem"]')
    .evaluateAll((rows) =>
      rows.map((row) => [
        (row as HTMLElement).innerText.trim(),
        row.getAttribute("aria-selected") === "true",
      ]),
    );
}

test("drawing a rectangle on a screen in overview saves exactly the dragged box and selects the rectangle, not the screen", async ({
  app,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);

  await drawRectangle(app);

  await expect.poll(() => app.selectedLayers()).toEqual(["Rectangle"]);
  await expect(app.page.locator("[data-frame-selection-box]")).toHaveCount(0);
  const after = await app.savedNodes(id);
  const drawn = added(before, after);
  expect(
    drawn.map((node) => [
      node.tag,
      node.parent,
      node.attrs["data-an-primitive"],
    ]),
  ).toEqual([["div", "page", "rectangle"]]);
  const rectangle = drawn[0]!;
  expect(paintOf(rectangle)).toEqual({
    position: "absolute",
    background: "rgb(217, 217, 217)",
    border: "0px solid transparent",
    "border-radius": "0px",
  });
  await expectBox(app, "saved", savedBox(rectangle));
  const rendered = await app.designRect(rectangle.id);
  await expectBox(app, "rendered", [
    rendered.x,
    rendered.y,
    rendered.width,
    rendered.height,
  ]);
  expectOnlyChanged(before, after, [rectangle.id]);
});

test("Cmd+D right after drawing duplicates the rectangle in place and selects the copy, leaving the screen single", async ({
  app,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const seeded = await app.savedNodes(id);
  await drawRectangle(app);
  const drawn = await app.savedNodes(id);
  const original = added(seeded, drawn);
  expect(
    original.map((node) => node.attrs["data-an-primitive"]),
    "the draw must save one rectangle",
  ).toEqual(["rectangle"]);

  await app.page.keyboard.press("ControlOrMeta+d");
  await app.settled();

  const after = await app.savedNodes(id);
  const copies = added(drawn, after);
  expect(
    copies.map((node) => [
      node.tag,
      node.parent,
      node.attrs["data-an-primitive"],
    ]),
  ).toEqual([["div", "page", "rectangle"]]);
  const copy = copies[0]!;
  expect(styleOf(copy)).toEqual(styleOf(original[0]));
  expect(after.get(copy.id)!.index).toBe(after.get(original[0]!.id)!.index + 1);
  expectOnlyChanged(drawn, after, [copy.id]);
  await expect
    .poll(() => layerRows(app))
    .toEqual([
      ["Home", false],
      ["Rectangle", true],
      ["Rectangle", false],
      ["Hero", false],
    ]);
  const { files } = await app.savedRecord(id);
  expect(files.map((file) => file.filename)).toStrictEqual([
    "index.html",
    "__board__.html",
  ]);
  expect(await app.designRect(copy.id)).toEqual(
    await app.designRect(original[0]!.id),
  );
});
