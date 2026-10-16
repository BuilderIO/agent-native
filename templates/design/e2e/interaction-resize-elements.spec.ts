import { appPath, expandAllLayers } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  savedNodeMap,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const ALT = "Alt";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const BOXES = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;width:800px;height:600px;background:#ffffff">
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#f97316"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:40px;top:200px;width:120px;height:80px;background:#2563eb"></div>
</body></html>`;

const BOARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;position:relative;background:transparent;overflow:visible">
    <div data-agent-native-node-id="rect" data-agent-native-layer-name="Rect" style="position:absolute;left:600px;top:400px;width:120px;height:90px;background:#f59e0b"></div>
  </body>
</html>`;

type Box = [left: number, top: number, width: number, height: number];
type Frame = { x: number; y: number; width: number; height: number };

async function setUpDesign(
  app: App,
  options: { board?: boolean } = {},
): Promise<string> {
  const id = await app.seed(
    BOXES,
    options.board ? { files: { "__board__.html": BOARD_HTML } } : {},
  );
  const { files } = await app.savedRecord(id);
  const fileId = (name: string) =>
    files.find((file) => file.filename === name)!.id;
  const screenId = fileId("index.html");
  const dataOperations: unknown[] = [
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
  ];
  if (options.board) {
    dataOperations.push({
      op: "set",
      path: ["boardFileId"],
      value: fileId("__board__.html"),
    });
  }
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    { data: { id, dataOperations } },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function clickAt(app: App, x: number, y: number) {
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
}

/** Opens the boxes design with Box A selected by a canvas click. */
async function openWithBoxA(app: App) {
  const id = await setUpDesign(app);
  await clickAt(app, 100, 80);
  await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
  await app.settled();
  return { id, before: await app.savedNodes(id) };
}

/** Presses at a design point, moves to another in steps, and releases with an optional modifier held. */
async function dragDesign(
  app: App,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: string,
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  if (modifier) await app.page.keyboard.down(modifier);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 14 });
  await app.page.mouse.up();
  if (modifier) await app.page.keyboard.up(modifier);
  await app.settled();
}

function boxFromStyle(style: Record<string, string>): Box {
  return [style.left, style.top, style.width, style.height].map((value) =>
    Number.parseFloat(value!),
  ) as Box;
}

function savedBox(node: SavedNode | undefined): Box {
  return boxFromStyle(styleOf(node));
}

async function renderedBox(app: App, nodeId: string): Promise<Box> {
  const rect = await app.designRect(nodeId);
  return [rect.x, rect.y, rect.width, rect.height];
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

async function selectionOutline(app: App): Promise<Box> {
  return app.page
    .locator(LIVE_SCREEN)
    .contentFrame()
    .locator('[data-agent-native-edit-overlay="selection"]')
    .evaluate((overlay) => {
      const r = overlay.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height] as Box;
    });
}

test.describe("element resize", () => {
  test("dragging the E edge handle by 60 widens the box to 180 and changes nothing else", async ({
    app,
  }) => {
    const { id, before } = await openWithBoxA(app);

    await dragDesign(app, { x: 160, y: 80 }, { x: 220, y: 80 });

    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      savedBox(after.get("box-a")),
      [40, 40, 180, 80],
      "saved Box A",
    );
    expect(
      [styleOf(after.get("box-a")).left, styleOf(after.get("box-a")).top],
      "an E-edge drag never moves the left or top edge",
    ).toEqual(["40px", "40px"]);
    expect(styleOf(after.get("box-a")).height).toBe("80px");
    expectOnlyChanged(before, after, ["box-a"]);
    await expectWithinAPagePixel(
      app,
      await renderedBox(app, "box-a"),
      [40, 40, 180, 80],
      "rendered Box A",
    );
  });

  test("shift+drag on a corner handle keeps the element's aspect ratio", async ({
    app,
  }) => {
    const { id, before } = await openWithBoxA(app);

    await dragDesign(app, { x: 160, y: 120 }, { x: 280, y: 130 }, "Shift");

    const after = await app.savedNodes(id);
    const [left, top, width, height] = savedBox(after.get("box-a"));
    expect([left, top], "the opposite corner stays put").toEqual([40, 40]);
    await expectWithinAPagePixel(app, [width], [240], "saved width");
    expect(
      Math.abs(width / height - 1.5),
      `a Shift resize keeps 120x80's 3:2 ratio; saved ${width}x${height}`,
    ).toBeLessThan(0.01);
    expectOnlyChanged(before, after, ["box-a"]);
  });

  // fixme: product bug: Alt edge resize grows by the drag distance split across both sides: saved [20,40,161,80], so the dragged edge sits ~19px behind the
  test.fixme("alt+drag on an edge handle resizes symmetrically from the center", async ({
    app,
  }) => {
    const { id, before } = await openWithBoxA(app);

    await dragDesign(app, { x: 160, y: 80 }, { x: 200, y: 80 }, ALT);

    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      savedBox(after.get("box-a")),
      [0, 40, 200, 80],
      "the dragged edge follows the pointer and the left edge mirrors it",
    );
    expectOnlyChanged(before, after, ["box-a"]);
  });

  test("the selection outline and inspector W/H follow the pointer live during a corner resize, and the release saves that size", async ({
    app,
  }) => {
    const { id, before } = await openWithBoxA(app);
    const width = app.page.getByLabel("W size in pixels");
    const height = app.page.getByLabel("H size in pixels");
    await expect(width).toHaveValue("120px");
    await expect(height).toHaveValue("80px");

    const start = await app.pagePoint(160, 120);
    const held = await app.pagePoint(230, 170);
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    await app.page.mouse.move(held.x, held.y, { steps: 10 });

    await expect
      .poll(async () => {
        const outline = await selectionOutline(app);
        const tolerance = Math.ceil(1 / held.scale);
        return outline.every(
          (value, index) =>
            Math.abs(value - [40, 40, 190, 130][index]!) <= tolerance,
        );
      }, "the outline is drawn at 40,40 190x130 while the pointer is held")
      .toBe(true);
    await expectWithinAPagePixel(
      app,
      [
        Number.parseFloat(await width.inputValue()),
        Number.parseFloat(await height.inputValue()),
      ],
      [190, 130],
      "inspector W/H mid-drag",
    );
    expect(
      savedBox((await app.savedNodes(id)).get("box-a")),
      "nothing is saved until release",
    ).toEqual([40, 40, 120, 80]);

    await app.page.mouse.up();
    await app.settled();
    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      savedBox(after.get("box-a")),
      [40, 40, 190, 130],
      "saved Box A",
    );
    expectOnlyChanged(before, after, ["box-a"]);
  });

  test("one resize gesture is exactly one undo step", async ({ app }) => {
    const { id, before } = await openWithBoxA(app);
    await dragDesign(app, { x: 160, y: 120 }, { x: 240, y: 150 });
    await expectWithinAPagePixel(
      app,
      savedBox((await app.savedNodes(id)).get("box-a")),
      [40, 40, 200, 110],
      "precondition: the resize saved",
    );

    await app.page.keyboard.press(`${MOD}+z`);
    await expect(app.node("box-a")).toHaveCSS("width", "120px");
    await app.settled();

    const undone = await app.savedNodes(id);
    expect(savedBox(undone.get("box-a"))).toEqual([40, 40, 120, 80]);
    expectOnlyChanged(before, undone, []);
    expect(await renderedBox(app, "box-a")).toEqual([40, 40, 120, 80]);
  });

  test("multi-selection resize scales the group bounds from the opposite corner", async ({
    app,
  }) => {
    const id = await setUpDesign(app);
    await clickAt(app, 100, 80);
    await app.page.keyboard.down("Shift");
    await clickAt(app, 100, 240);
    await app.page.keyboard.up("Shift");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box B", "Box A"]);
    await app.settled();
    const before = await app.savedNodes(id);

    await dragDesign(app, { x: 160, y: 280 }, { x: 100, y: 160 });

    const after = await app.savedNodes(id);
    await expectWithinAPagePixel(
      app,
      [...savedBox(after.get("box-a")), ...savedBox(after.get("box-b"))],
      [40, 40, 60, 40, 40, 120, 60, 40],
      "both boxes scale by 0.5 from the group's top-left corner",
    );
    expectOnlyChanged(before, after, ["box-a", "box-b"]);
  });
});

// fixme: product bug: A width-only left-edge resize resets the screen's height: saved frame [-61,0,861,1024] (precondition confirmed 600 before the drag); the
test.fixme("resizing a screen from its left edge moves its left side and keeps its height", async ({
  app,
}) => {
  const id = await setUpDesign(app);
  const page = app.page;
  const screenId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const savedFrame = async () => {
    const { data } = await app.savedRecord(id);
    const frames = (data as { canvasFrames: Record<string, Frame> })
      .canvasFrames;
    const { x, y, width, height } = frames[screenId]!;
    return [x, y, width, height];
  };
  await page.locator("[data-frame-label]").click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Home"]);
  await app.zoomToFit();
  expect(await savedFrame(), "precondition: Home opens 800x600").toEqual([
    0, 0, 800, 600,
  ]);
  const before = await app.savedNodes(id);

  const handle = page.locator('[data-resize-handle="w"]');
  const box = (await handle.boundingBox())!;
  const { scale } = await app.pagePoint(0, 0);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 60 * scale, from.y, { steps: 10 });
  await page.mouse.up();
  await app.settled();

  await expectWithinAPagePixel(
    app,
    await savedFrame(),
    [-60, 0, 860, 600],
    "saved screen frame",
  );
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

test.describe("board object resize through an overlapping Screen", () => {
  test("SE-handle drag reaches and resizes the occluded board rect, one undo restores it and redo re-applies it", async ({
    app,
  }) => {
    const page = app.page;
    const id = await setUpDesign(app, { board: true });
    const boardRect = async () =>
      savedBox(
        savedNodeMap(await app.savedHtml(id, "__board__.html")).get("rect"),
      );
    const renderedRect = async () =>
      boxFromStyle(
        await page
          .locator(
            "[data-board-surface-layer] iframe[data-design-preview-iframe]",
          )
          .contentFrame()
          .locator('[data-agent-native-node-id="rect"]')
          .evaluate((element) => {
            const style = (element as HTMLElement).style;
            return {
              left: style.left,
              top: style.top,
              width: style.width,
              height: style.height,
            };
          }),
      );
    expect(await boardRect()).toEqual([600, 400, 120, 90]);
    const centre = await app.pagePoint(660, 445);
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(
            document.elementFromPoint(x, y)?.closest("[data-screen-card]"),
          ),
        centre,
      ),
      "precondition: the Screen covers the board rect",
    ).toBe(true);

    await expandAllLayers(page);
    await page
      .getByRole("tree", { name: "Layers" })
      .locator('[data-layer-row-button] span[title="Rect"]')
      .click();
    const seHandle = page.locator(
      '[data-board-object-selection-box] [data-resize-handle="se"]',
    );
    const handleBox = (await seHandle.boundingBox())!;
    const from = {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    };
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.getAttribute("data-resize-handle"),
        from,
      ),
      "the handle sits on top of the Screen that covers the rect",
    ).toBe("se");
    const { scale } = await app.pagePoint(0, 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30 * scale, from.y + 20 * scale, {
      steps: 10,
    });
    await page.mouse.up();
    await app.settled();

    const resized = await boardRect();
    await expectWithinAPagePixel(
      app,
      resized,
      [600, 400, 150, 110],
      "saved board rect",
    );

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(boardRect).toEqual([600, 400, 120, 90]);
    await expect.poll(renderedRect).toEqual([600, 400, 120, 90]);

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(boardRect).toEqual(resized);
    await expect.poll(renderedRect).toEqual(resized);
  });
});
