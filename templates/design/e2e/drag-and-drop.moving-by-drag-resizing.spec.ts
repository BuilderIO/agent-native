import { appPath } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const BOXES = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;width:800px;height:600px;background:#ffffff">
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#f97316"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:400px;top:300px;width:100px;height:60px;background:#2563eb"></div>
</body></html>`;

async function openBoxes(app: App) {
  const id = await app.seed(BOXES);
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
  const centre = await app.pagePoint(100, 80);
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
  await app.settled();
  return { id, before: await app.savedNodes(id) };
}

async function drag(
  app: App,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 14 });
  await app.page.mouse.up();
  await app.settled();
}

function savedBox(node: SavedNode | undefined) {
  const style = styleOf(node);
  return ["left", "top", "width", "height"].map((key) =>
    Number.parseFloat(style[key]!),
  );
}

/** Pointer input lands on whole page pixels, so a dragged edge can be off by one page pixel in design px. */
async function expectWithinAPagePixel(
  app: App,
  actual: number[],
  expected: number[],
  label: string,
) {
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

test.describe("moving by drag", () => {
  test("dragging a box by (90,70) moves only that box by exactly (90,70)", async ({
    app,
  }) => {
    const { id, before } = await openBoxes(app);

    await drag(app, { x: 100, y: 80 }, { x: 190, y: 150 });

    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      savedBox(after.get("box-a")),
      [130, 110, 120, 80],
      "saved Box A",
    );
    expectOnlyChanged(before, after, ["box-a"]);
    const rendered = await app.designRect("box-a");
    await expectWithinAPagePixel(
      app,
      [rendered.x, rendered.y, rendered.width, rendered.height],
      [130, 110, 120, 80],
      "rendered Box A",
    );
  });

  test("one undo after a drag restores the exact document, and redo re-applies the drop", async ({
    app,
  }) => {
    const { id, before } = await openBoxes(app);
    await drag(app, { x: 100, y: 80 }, { x: 190, y: 150 });
    const dropped = await app.savedNodes(id);
    expect(
      styleOf(dropped.get("box-a")).left,
      "the drag must move Box A first",
    ).not.toBe("40px");

    await app.page.keyboard.press("ControlOrMeta+z");
    await expect(app.node("box-a")).toHaveCSS("left", "40px");
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);

    await app.page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(app.node("box-a")).not.toHaveCSS("left", "40px");
    await app.settled();
    expect((await app.savedNodes(id)).get("box-a")).toEqual(
      dropped.get("box-a"),
    );
  });
});

test.describe("resizing", () => {
  test("dragging the bottom-right corner by (100,60) grows the box to 220x140 and keeps its top-left corner", async ({
    app,
  }) => {
    const { id, before } = await openBoxes(app);

    await drag(app, { x: 160, y: 120 }, { x: 260, y: 180 });

    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      savedBox(after.get("box-a")),
      [40, 40, 220, 140],
      "saved Box A",
    );
    expect(
      [styleOf(after.get("box-a")).left, styleOf(after.get("box-a")).top],
      "the top-left corner stays put",
    ).toEqual(["40px", "40px"]);
    expectOnlyChanged(before, after, ["box-a"]);
    const rendered = await app.designRect("box-a");
    await expectWithinAPagePixel(
      app,
      [rendered.x, rendered.y, rendered.width, rendered.height],
      [40, 40, 220, 140],
      "rendered Box A",
    );
  });
});
