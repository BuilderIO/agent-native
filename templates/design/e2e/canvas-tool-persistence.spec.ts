import { appPath, selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body data-agent-native-node-id="page" style="margin:0;width:800px;height:600px;background:#ffffff">
  <h1 data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="position:absolute;left:40px;top:40px;margin:0;font:600 32px system-ui">Hero</h1>
  <p data-agent-native-node-id="copy" data-agent-native-layer-name="Copy" style="position:absolute;left:40px;top:160px;margin:0;font:16px system-ui">Copy</p>
</body></html>`;

async function openScreen(app: App) {
  const id = await app.seed(SCREEN_HTML);
  const { files } = await app.savedRecord(id);
  const screenId = files.find((file) => file.filename === "index.html")!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", screenId],
            value: { sourceType: "inline", width: 800, height: 600 },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId],
            value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function drawBox(
  app: App,
  box: { x: number; y: number; width: number; height: number },
) {
  const start = await app.pagePoint(box.x, box.y);
  const end = await app.pagePoint(box.x + box.width, box.y + box.height);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 10 });
  await app.page.mouse.up();
  await app.settled();
}

async function clickCentre(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter(
    (node) =>
      !before.has(node.id) && node.tag !== "html" && node.tag !== "body",
  );
}

/** Pointer input lands on whole page pixels, so a dragged edge can be off by one page pixel in design px. */
async function expectSavedBox(app: App, node: SavedNode, expected: number[]) {
  const style = styleOf(node);
  const actual = ["left", "top", "width", "height"].map((key) =>
    Number.parseFloat(style[key]!),
  );
  const tolerance = Math.max(
    1,
    Math.ceil(1 / (await app.pagePoint(0, 0)).scale),
  );
  const off = actual.filter(
    (value, index) => Math.abs(value - expected[index]!) > tolerance,
  );
  expect(
    off,
    `${node.id}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} ±${tolerance}`,
  ).toEqual([]);
}

// oracle: none — verifies which shape the Shapes button keeps arming, not parity with a design reference.
test("after choosing Ellipse in the Shapes menu, the Shapes button draws ellipses again on its next use", async ({
  app,
}) => {
  const id = await openScreen(app);
  const before = await app.savedNodes(id);
  const toolbar = app.page.locator("[data-design-bottom-toolbar]");

  await selectTool(app.page, "Ellipse");
  await drawBox(app, { x: 300, y: 300, width: 90, height: 70 });
  const first = await app.savedNodes(id);
  expect(
    added(before, first).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["ellipse"]);

  const shapeButton = toolbar.getByRole("button", {
    name: "Ellipse",
    exact: true,
  });
  // Drawing hands the pointer back to Move, but the button still offers an Ellipse.
  await expect(shapeButton).toHaveAttribute("aria-pressed", "false");
  await shapeButton.click();
  await expect(shapeButton).toHaveAttribute("aria-pressed", "true");
  await drawBox(app, { x: 500, y: 300, width: 90, height: 70 });

  const after = await app.savedNodes(id);
  const ellipses = added(before, after);
  expect(
    ellipses.map((node) => [
      node.attrs["data-an-primitive"],
      styleOf(node)["border-radius"],
    ]),
  ).toEqual([
    ["ellipse", "50%"],
    ["ellipse", "50%"],
  ]);
  await expectSavedBox(app, ellipses[0]!, [300, 300, 90, 70]);
  await expectSavedBox(app, ellipses[1]!, [500, 300, 90, 70]);
  expectOnlyChanged(
    before,
    after,
    ellipses.map((node) => node.id),
  );
});

test("the Scale tool stays armed when a canvas click changes the selection, and the click edits nothing", async ({
  app,
}) => {
  const id = await openScreen(app);
  await clickCentre(app, "hero");
  await expect.poll(() => app.selectedLayers()).toEqual(["Hero"]);
  const before = await app.savedNodes(id);
  const toolbar = app.page.locator("[data-design-bottom-toolbar]");

  await app.page.keyboard.press("k");
  await expect(
    toolbar.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await clickCentre(app, "copy");

  await expect.poll(() => app.selectedLayers()).toEqual(["Copy"]);
  await expect(
    toolbar.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
});
