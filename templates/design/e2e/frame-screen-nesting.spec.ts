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

const SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body data-agent-native-node-id="page" style="margin:0;width:400px;height:300px;background:#1d4ed8">
    <div data-agent-native-node-id="badge" data-agent-native-layer-name="Badge" style="position:absolute;left:20px;top:20px;width:40px;height:20px;background:#facc15"></div>
  </body>
</html>`;

const WHITE = [255, 255, 255, 255];
const SCREEN_BLUE = [29, 78, 216, 255];

/** A 400x300 screen at board origin viewed at 100%, so board px equal screen px and open board surrounds it. */
async function openScreenOnBoard(app: App) {
  const id = await app.seed(SCREEN);
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
            value: { sourceType: "inline", width: 400, height: 300 },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId],
            value: { x: 0, y: 0, width: 400, height: 300, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  await app.zoomTo100();
  return { id, screenId };
}

async function dragOnCanvas(
  app: App,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 16 });
  await app.page.mouse.up();
  await app.settled();
}

async function drawBox(
  app: App,
  box: { x: number; y: number; width: number; height: number },
) {
  await dragOnCanvas(app, box, { x: box.x + box.width, y: box.y + box.height });
}

/** New layers only: the editor may also stamp ids on <html> and <body> the first time it saves a file. */
function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter(
    (node) =>
      !before.has(node.id) && node.tag !== "html" && node.tag !== "body",
  );
}

function savedBox(node: SavedNode | undefined) {
  const style = styleOf(node);
  expect(style.position, `${node?.id} position`).toBe("absolute");
  return {
    x: Number.parseFloat(style.left),
    y: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
}

/** At 100% zoom pointer input still lands on whole page pixels, so a dragged edge can round by one px. */
function expectWithinAPixel(
  actual: Record<string, number>,
  expected: Record<string, number>,
  label: string,
) {
  const off = Object.keys(expected).filter(
    (key) => Math.abs(actual[key]! - expected[key]!) > 1,
  );
  expect(
    off,
    `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toEqual([]);
}

/** Resolves a saved inline style the way the canvas renders it. */
async function computedFromSaved(
  app: App,
  node: SavedNode | undefined,
  properties: string[],
) {
  return app.page.evaluate(
    ({ style, properties }) => {
      const probe = document.createElement("div");
      probe.style.cssText = style;
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const values = Object.fromEntries(
        properties.map((name) => [name, computed.getPropertyValue(name)]),
      );
      probe.remove();
      return values;
    },
    { style: node?.attrs.style ?? "", properties },
  );
}

/** The colour actually painted at a board point, whatever layer it comes from. */
async function paintedAt(app: App, boardX: number, boardY: number) {
  const point = await app.pagePoint(boardX, boardY);
  const png = await app.page.screenshot({
    clip: {
      x: Math.round(point.x),
      y: Math.round(point.y),
      width: 1,
      height: 1,
    },
  });
  return app.page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, png.toString("base64"));
}

async function filenames(app: App, id: string) {
  return (await app.savedRecord(id)).files.map((file) => file.filename).sort();
}

async function drawBoardFrame(
  app: App,
  id: string,
  box: { x: number; y: number; width: number; height: number },
) {
  const before = await app.savedNodes(id, "__board__.html");
  await drawBox(app, box);
  const after = await app.savedNodes(id, "__board__.html");
  expect(
    added(before, after).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["frame"]);
  const [frame] = added(before, after);
  expectWithinAPixel(savedBox(frame), box, "drawn board frame");
  return frame;
}

test("after choosing Frame in the frame menu, pressing F again still draws board frames, not screens", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  const files = await filenames(app, id);
  await selectTool(app.page, "Frame");
  await drawBoardFrame(app, id, { x: 440, y: -200, width: 120, height: 100 });

  await app.page.keyboard.press("f");
  await expect(
    app.page.locator('[data-design-bottom-toolbar] button[aria-label="Frame"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await drawBoardFrame(app, id, { x: 440, y: 0, width: 120, height: 80 });

  expect(await filenames(app, id)).toEqual(files);
});

// fixme: fails on current main after the merge: Error: saved design has no __board__.html
test.fixme("Screen mode draws one new top-level screen at the dragged box and no board frame", async ({
  app,
}) => {
  const { id, screenId } = await openScreenOnBoard(app);
  const before = await app.savedRecord(id);
  const boardBefore = await app.savedNodes(id, "__board__.html");
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Screen");

  await drawBox(app, { x: 440, y: -200, width: 160, height: 120 });

  const after = await app.savedRecord(id);
  const newFiles = after.files.filter(
    (file) => !before.files.some((old) => old.id === file.id),
  );
  expect(newFiles.map((file) => file.filename.endsWith(".html"))).toEqual([
    true,
  ]);
  const data = after.data as {
    canvasFrames: Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
  };
  const frames = data.canvasFrames;
  const { x, y, width, height } = frames[newFiles[0]!.id]!;
  expectWithinAPixel(
    { x, y, width, height },
    { x: 440, y: -200, width: 160, height: 120 },
    "new screen frame",
  );
  expect(Object.keys(frames).sort()).toStrictEqual(
    [screenId, newFiles[0]!.id].sort(),
  );
  expect(frames[screenId], "the existing screen stays put").toStrictEqual({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 0,
  });
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(id, "__board__.html"),
    [],
  );
});

// fixme: fails on current main after the merge: Error: expect(received).toEqual(expected) // deep equality
test.fixme("after drawing a board frame in the light theme, the board stays light grey and the screen stays painted", async ({
  app,
}) => {
  await app.page.emulateMedia({ colorScheme: "light" });
  await app.page.addInitScript(() => localStorage.setItem("theme", "light"));
  const { id } = await openScreenOnBoard(app);
  await expect(app.page.locator("html")).toHaveClass(/light/);
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Frame");

  await drawBoardFrame(app, id, { x: 440, y: -200, width: 120, height: 100 });

  await expect(app.page.locator("[data-board-surface-layer]")).toHaveCSS(
    "background-color",
    "rgb(235, 235, 235)",
  );
  expect(await paintedAt(app, 520, 200), "empty board").toEqual([
    235, 235, 235, 255,
  ]);
  expect(await paintedAt(app, 200, 150), "screen body").toEqual(SCREEN_BLUE);
  expect(await paintedAt(app, 500, -150), "the new frame").toEqual(WHITE);
});

test("Frame mode inside a screen adds a frame to that screen at the dragged box, not a new screen", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  const files = await filenames(app, id);
  const before = await app.savedNodes(id);
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Frame");

  await drawBox(app, { x: 100, y: 100, width: 160, height: 120 });

  expect(await filenames(app, id)).toEqual(files);
  const after = await app.savedNodes(id);
  expect(
    added(before, after).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["frame"]);
  const [frame] = added(before, after);
  expect(frame.parent).toBe("page");
  expectWithinAPixel(
    savedBox(frame),
    { x: 100, y: 100, width: 160, height: 120 },
    "frame in the screen",
  );
  expectOnlyChanged(before, after, [frame.id]);
});

// fixme: product bug: Drop into a container with content lands at (0,0): the frame is saved with position:relative and no left/top, and renders at the screen's
test.fixme("a board frame dragged onto a screen moves into it with its centre at the release point, and stays there after reload", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Frame");
  const frame = await drawBoardFrame(app, id, {
    x: 440,
    y: -200,
    width: 80,
    height: 80,
  });
  const screenBefore = await app.savedNodes(id);
  await app.page.keyboard.press("v");

  await dragOnCanvas(app, { x: 480, y: -160 }, { x: 200, y: 150 });

  expect(
    (await app.savedNodes(id, "__board__.html")).has(frame.id),
    "the frame left the board",
  ).toBe(false);
  const screenAfter = await app.savedNodes(id);
  expect(screenAfter.get(frame.id)?.parent).toBe("page");
  const { style: _boardStyle, ...boardAttrs } = frame.attrs;
  const { style: _screenStyle, ...screenAttrs } = screenAfter.get(
    frame.id,
  )!.attrs;
  expect(screenAttrs).toEqual({
    ...boardAttrs,
    "data-agent-native-clone-root": "true",
    "data-agent-native-preserve-styles": "true",
  });
  expectWithinAPixel(
    savedBox(screenAfter.get(frame.id)),
    { x: 160, y: 110, width: 80, height: 80 },
    "frame in the screen",
  );
  expectOnlyChanged(screenBefore, screenAfter, [frame.id]);

  await app.page.reload();
  await expect(app.node(frame.id)).toBeVisible();
  expectWithinAPixel(
    await app.designRect(frame.id),
    { x: 160, y: 110, width: 80, height: 80 },
    "rendered after reload",
  );
});

test("a board frame dropped onto a larger board frame nests in it with its centre at the release point", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Frame");
  const source = await drawBoardFrame(app, id, {
    x: 440,
    y: -200,
    width: 80,
    height: 80,
  });
  await app.page.keyboard.press("f");
  const target = await drawBoardFrame(app, id, {
    x: 440,
    y: 100,
    width: 160,
    height: 160,
  });
  const before = await app.savedNodes(id, "__board__.html");
  await app.page.keyboard.press("v");

  await dragOnCanvas(app, { x: 480, y: -160 }, { x: 520, y: 180 });

  const after = await app.savedNodes(id, "__board__.html");
  expect(after.get(source.id)?.parent).toBe(target.id);
  expectWithinAPixel(
    savedBox(after.get(source.id)),
    { x: 40, y: 40, width: 80, height: 80 },
    "source inside the target",
  );
  // The source was the board's first child, so leaving it moves the target up.
  expect(after.get(target.id)).toEqual({ ...before.get(target.id), index: 0 });
  expectOnlyChanged(before, after, [source.id]);
});

// fixme: product bug: Position and ownership are correct, but the frame is painted behind the locked screen. The pixel at its centre is the screen's blue
test.fixme("a board frame released over a locked screen stays on the board at the release point, painted above the screen", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  const homeRow = app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({
      has: app.page.getByRole("button", { name: "Home", exact: true }),
    });
  await homeRow.hover();
  await homeRow.getByRole("button", { name: "Lock layer" }).click();
  await expect(
    homeRow.getByRole("button", { name: "Unlock layer" }),
  ).toBeVisible();
  await app.page.keyboard.press("f");
  await selectTool(app.page, "Frame");
  const frame = await drawBoardFrame(app, id, {
    x: 440,
    y: -200,
    width: 80,
    height: 80,
  });
  const screenBefore = await app.savedNodes(id);
  await app.page.keyboard.press("v");

  await dragOnCanvas(app, { x: 480, y: -160 }, { x: 200, y: 150 });

  const board = await app.savedNodes(id, "__board__.html");
  expectWithinAPixel(
    savedBox(board.get(frame.id)),
    { x: 160, y: 110, width: 80, height: 80 },
    "frame on the board",
  );
  expectOnlyChanged(screenBefore, await app.savedNodes(id), []);
  expect(
    await paintedAt(app, 200, 150),
    "the frame is painted over the locked screen",
  ).toEqual(WHITE);

  await app.page.reload();
  await app.zoomToFit();
  await app.zoomTo100();
  expect(
    await paintedAt(app, 200, 150),
    "still painted over the screen after reload",
  ).toEqual(WHITE);
});

// fixme: fails on current main after the merge: Error: expect(locator).toBeVisible() failed
test.fixme("R on the board draws a #D9D9D9 rectangle at the dragged box", async ({
  app,
}) => {
  const { id } = await openScreenOnBoard(app);
  const before = await app.savedNodes(id, "__board__.html");
  await app.page.keyboard.press("r");

  await drawBox(app, { x: 440, y: -200, width: 160, height: 120 });

  const after = await app.savedNodes(id, "__board__.html");
  expect(
    added(before, after).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["rectangle"]);
  const [rect] = added(before, after);
  expectWithinAPixel(
    savedBox(rect),
    { x: 440, y: -200, width: 160, height: 120 },
    "board rectangle",
  );
  expect(await computedFromSaved(app, rect, ["background-color"])).toEqual({
    "background-color": "rgb(217, 217, 217)",
  });
  expect(await paintedAt(app, 520, -140)).toEqual([217, 217, 217, 255]);
});
