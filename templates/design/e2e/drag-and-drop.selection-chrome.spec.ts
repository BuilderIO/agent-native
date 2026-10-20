import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const BOXES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Boxes</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
         style="position:absolute;left:100px;top:100px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
         style="position:absolute;left:400px;top:100px;width:120px;height:80px;background:#22c55e"></div>
  </body>
</html>`;

const BOX_A = { x: 100, y: 100, width: 120, height: 80 };

async function openSeeded(app: App) {
  const id = await app.seed(BOXES);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function clickBoxA(app: App) {
  const centre = await app.pagePoint(160, 140);
  await app.page.mouse.click(centre.x, centre.y);
  return centre;
}

/** The selection outline drawn in the Screen, in design px. */
async function selectionOutline(app: App) {
  return app.page
    .locator(LIVE_SCREEN)
    .contentFrame()
    .locator('[data-agent-native-edit-overlay="selection"]')
    .evaluate((overlay) => {
      const r = overlay.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

async function savedFrames(app: App, id: string) {
  const { data } = await app.savedRecord(id);
  return (data as { canvasFrames: Record<string, unknown> }).canvasFrames;
}

test.describe("selection chrome", () => {
  test("handles wrap the selected element, not the screen", async ({ app }) => {
    await openSeeded(app);
    await clickBoxA(app);

    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    await expect.poll(() => selectionOutline(app)).toEqual(BOX_A);
    await expect(
      app.page
        .locator(LIVE_SCREEN)
        .contentFrame()
        .locator('[data-agent-native-edit-overlay="size-badge"]'),
    ).toHaveText("120 × 80");
  });

  test("a selected screen still lets you click an element inside it", async ({
    app,
  }) => {
    await openSeeded(app);
    await app.page.locator("[data-frame-label]").click();
    await expect(
      app.page.locator('[role="treeitem"][aria-selected="true"]'),
      "precondition: the label click selects the Screen",
    ).toContainText("Home");
    await app.zoomToFit();

    await clickBoxA(app);

    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    await expect.poll(() => selectionOutline(app)).toEqual(BOX_A);
  });

  test("a layer row selection leaves the screen frame unselected", async ({
    app,
  }) => {
    const id = await openSeeded(app);
    const nodesBefore = await app.savedNodes(id);
    const screenId = (await app.savedRecord(id)).files.find(
      (file) => file.filename === "index.html",
    )!.id;
    const screenFrames = {
      [screenId]: { x: 0, y: 736, width: 1440, height: 1024 },
    };
    expect(await savedFrames(app, id)).toStrictEqual(screenFrames);
    await app.page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Expand layer" })
      .first()
      .click();
    await app.page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Box A" })
      .click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);

    const from = await app.pagePoint(160, 140);
    const to = await app.pagePoint(260, 200);
    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 12 });
    await app.page.mouse.up();
    await app.settled();

    expect(
      await savedFrames(app, id),
      "the drag after a Layers pick moves the layer, not the whole Screen",
    ).toStrictEqual(screenFrames);
    const nodesAfter = await app.savedNodes(id);
    expectOnlyChanged(nodesBefore, nodesAfter, ["box-a"]);
    expect(styleOf(nodesAfter.get("box-a"))).toMatchObject({
      left: "200px",
      top: "160px",
    });
  });
});
