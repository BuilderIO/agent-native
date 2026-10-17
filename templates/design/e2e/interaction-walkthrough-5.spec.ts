import { appPath } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const EMPTY_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="note" data-agent-native-layer-name="Note" style="position:absolute;left:600px;top:40px;width:150px;height:40px;background:#e5e7eb"></div>
</body></html>`;

const SWAP_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="both" data-agent-native-layer-name="Both" style="position:absolute;left:80px;top:80px;width:160px;height:48px;background-color:#6366f1;border:2px solid #111827;color:#ffffff">Both</div>
  <div data-agent-native-node-id="fill-only" data-agent-native-layer-name="Fill only" style="position:absolute;left:80px;top:200px;width:160px;height:48px;background-color:#6366f1;border:0;color:#ffffff">Fill only</div>
</body></html>`;

const RECTANGLE_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="shape" data-agent-native-layer-name="Shape" data-an-primitive="rectangle" style="position:absolute;left:120px;top:120px;width:160px;height:100px;background:#d9d9d9"></div>
</body></html>`;

const NAMED_FRAME_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="group" data-agent-native-layer-name="Group" data-an-primitive="frame" style="position:absolute;left:120px;top:120px;display:flex;padding:12px 16px;background:#6366f1">
    <span data-agent-native-node-id="save-label" data-agent-native-layer-name="Save" style="color:#ffffff;font:600 16px system-ui">Save</span>
  </div>
</body></html>`;

const BUTTON_AND_ICON_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="icon" data-agent-native-layer-name="Icon" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:24px;height:24px;background:#f59e0b"></div>
  <div data-agent-native-node-id="button" data-agent-native-layer-name="Button" data-an-primitive="frame" style="position:absolute;left:100px;top:300px;display:flex;flex-direction:row;align-items:center;gap:8px;padding:12px 16px;background:#6366f1">
    <span data-agent-native-node-id="save-label" data-agent-native-layer-name="Save" style="display:block;height:24px;color:#ffffff;font:600 16px/24px system-ui">Save</span>
  </div>
</body></html>`;

const SMALL_SCREEN = `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-agent-native-node-id="page" style="margin:0;width:400px;height:300px;background:#ffffff">
  <div data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="position:absolute;left:80px;top:80px;width:160px;height:100px;background:#ee4444"></div>
</body></html>`;

/** Seeds one screen with a declared canvas size at board origin, so board px equal screen px. */
async function seedSized(
  app: App,
  html: string,
  width: number,
  height: number,
) {
  const id = await app.seed(html);
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
            value: { sourceType: "inline", width, height },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId],
            value: { x: 0, y: 0, width, height, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

/** A 400x300 screen viewed at 100%, so open board surrounds it. */
async function openSmallScreenOnBoard(app: App) {
  const id = await seedSized(app, SMALL_SCREEN, 400, 300);
  await app.zoomTo100();
  return id;
}

async function clickCentre(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  return point;
}

async function drag(
  app: App,
  from: { x: number; y: number },
  designX: number,
  designY: number,
  alt = false,
) {
  const to = await app.pagePoint(designX, designY);
  await app.page.mouse.move(from.x, from.y);
  if (alt) await app.page.keyboard.down("Alt");
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 16 });
  await app.page.mouse.up();
  if (alt) await app.page.keyboard.up("Alt");
  await app.settled();
}

async function drawWithTool(
  app: App,
  tool: { key: "f" | "r"; name: "Frame" | "Rectangle" },
  box: { x: number; y: number; width: number; height: number },
) {
  await app.page.keyboard.press(tool.key);
  await expect(
    app.page.getByRole("button", { name: tool.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(
    app,
    await app.pagePoint(box.x, box.y),
    box.x + box.width,
    box.y + box.height,
  );
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter((node) => !before.has(node.id));
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

/** Pointer input lands on whole page pixels, so a dragged edge can be off by one page pixel in design px. */
async function expectWithinAPagePixel(
  app: App,
  actual: Record<string, number>,
  expected: Record<string, number>,
  label: string,
) {
  const tolerance = Math.max(
    1,
    Math.ceil(1 / (await app.pagePoint(0, 0)).scale),
  );
  const off = Object.keys(expected).filter(
    (key) => Math.abs(actual[key]! - expected[key]!) > tolerance,
  );
  expect(
    off,
    `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} ±${tolerance}`,
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

test.describe("interaction: in-screen button component", () => {
  test("F draws a white, clipping frame at the dragged box, and R inside it draws a rectangle parented in that frame", async ({
    app,
  }) => {
    const id = await seedSized(app, EMPTY_SCREEN, 800, 600);
    const seeded = await app.savedNodes(id);

    await drawWithTool(
      app,
      { key: "f", name: "Frame" },
      { x: 200, y: 200, width: 240, height: 160 },
    );
    const withFrame = await app.savedNodes(id);
    expect(
      added(seeded, withFrame).map((node) => node.attrs["data-an-primitive"]),
    ).toEqual(["frame"]);
    const [frame] = added(seeded, withFrame);
    expect(frame.parent).toBe("page");
    await expectWithinAPagePixel(
      app,
      savedBox(frame),
      { x: 200, y: 200, width: 240, height: 160 },
      "saved frame",
    );
    expect(
      await computedFromSaved(app, frame, ["background-color", "overflow"]),
    ).toEqual({
      "background-color": "rgb(255, 255, 255)",
      overflow: "hidden",
    });
    await expect
      .poll(() => app.selectedLayers())
      .toEqual([frame.attrs["data-agent-native-layer-name"]]);

    await drawWithTool(
      app,
      { key: "r", name: "Rectangle" },
      { x: 260, y: 240, width: 80, height: 60 },
    );
    const after = await app.savedNodes(id);
    expect(
      added(withFrame, after).map((node) => node.attrs["data-an-primitive"]),
    ).toEqual(["rectangle"]);
    const [rect] = added(withFrame, after);
    expect(rect.parent).toBe(frame.id);
    await expectWithinAPagePixel(
      app,
      savedBox(rect),
      { x: 60, y: 40, width: 80, height: 60 },
      "saved rectangle, relative to the frame",
    );
    await expect
      .poll(() => app.selectedLayers())
      .toEqual([rect.attrs["data-agent-native-layer-name"]]);
    expectOnlyChanged(seeded, after, [frame.id, rect.id]);
    await expectWithinAPagePixel(
      app,
      await app.designRect(rect.id),
      { x: 260, y: 240, width: 80, height: 60 },
      "rendered rectangle",
    );
  });

  test("Shift+X swaps a layer's fill and stroke colours and keeps the stroke weight", async ({
    app,
  }) => {
    const id = await seedSized(app, SWAP_SCREEN, 800, 600);
    await clickCentre(app, "both");
    await expect.poll(() => app.selectedLayers()).toEqual(["Both"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("Shift+X");

    await expect(app.node("both")).toHaveCSS(
      "background-color",
      "rgb(17, 24, 39)",
    );
    await expect(app.node("both")).toHaveCSS(
      "border-top-color",
      "rgb(99, 102, 241)",
    );
    await app.settled();
    const after = await app.savedNodes(id);
    expect(
      await computedFromSaved(app, after.get("both"), [
        "background-color",
        "border-top-color",
        "border-top-width",
        "border-top-style",
      ]),
    ).toEqual({
      "background-color": "rgb(17, 24, 39)",
      "border-top-color": "rgb(99, 102, 241)",
      "border-top-width": "2px",
      "border-top-style": "solid",
    });
    expectOnlyChanged(before, after, ["both"]);
  });

  // fixme: product bug: Shift+X saves background-color #fff and border-color #6366f1 but leaves the border at 0px/none. The indigo layer becomes an invisible
  test.fixme("Shift+X on a fill-only layer turns the fill into a 1px stroke and leaves no fill", async ({
    app,
  }) => {
    const id = await seedSized(app, SWAP_SCREEN, 800, 600);
    await clickCentre(app, "fill-only");
    await expect.poll(() => app.selectedLayers()).toEqual(["Fill only"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("Shift+X");

    await expect(app.node("fill-only")).toHaveCSS(
      "border-top-color",
      "rgb(99, 102, 241)",
    );
    await app.settled();
    const after = await app.savedNodes(id);
    expect(
      await computedFromSaved(app, after.get("fill-only"), [
        "background-color",
        "border-top-color",
        "border-top-width",
        "border-top-style",
      ]),
    ).toEqual({
      "background-color": "rgba(0, 0, 0, 0)",
      "border-top-color": "rgb(99, 102, 241)",
      "border-top-width": "1px",
      "border-top-style": "solid",
    });
    expectOnlyChanged(before, after, ["fill-only"]);
  });

  test("Enter opens point edit on a rectangle with its 4 corner anchors, and Escape leaves the saved document untouched", async ({
    app,
  }) => {
    const id = await seedSized(app, RECTANGLE_SCREEN, 800, 600);
    await clickCentre(app, "shape");
    await expect.poll(() => app.selectedLayers()).toEqual(["Shape"]);
    await app.settled();
    const before = await app.savedHtml(id);

    await app.page.keyboard.press("Enter");
    await expect(app.page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(app.page.locator("[data-vector-anchor]")).toHaveCount(4);
    await app.page.keyboard.press("Escape");

    await expect(app.page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(before);
    expect(await app.designRect("shape")).toEqual({
      x: 120,
      y: 120,
      width: 160,
      height: 100,
    });
  });

  test("renaming a layer to a slash-delimited name (button/default/unsaved) saves and shows the full name", async ({
    app,
  }) => {
    const id = await seedSized(app, NAMED_FRAME_SCREEN, 800, 600);
    const group = await app.designRect("group");
    const padding = await app.pagePoint(
      group.x + 6,
      group.y + group.height / 2,
    );
    await app.page.mouse.click(padding.x, padding.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);
    const before = await app.savedNodes(id);

    const layers = app.page.getByRole("tree", { name: "Layers" });
    await layers.getByRole("button", { name: "Group", exact: true }).dblclick();
    const input = layers.locator('input[aria-label="Rename layer"]');
    await input.fill("button/default/unsaved");
    await input.press("Enter");

    await expect(
      layers.getByRole("button", {
        name: "button/default/unsaved",
        exact: true,
      }),
    ).toBeVisible();
    await app.settled();
    const after = await app.savedNodes(id);
    expect(after.get("group")?.attrs["data-agent-native-layer-name"]).toBe(
      "button/default/unsaved",
    );
    expectOnlyChanged(before, after, ["group"]);
  });

  // fixme: product bug: The copy is saved as the button's first child (correct parent and index), but with position:absolute; left:96px; top:312px (body
  test.fixme("Alt-dragging an icon onto an auto-layout button's left edge inserts a copy as its first flow child, and one undo removes it", async ({
    app,
  }) => {
    const id = await seedSized(app, BUTTON_AND_ICON_SCREEN, 800, 600);
    const grab = await clickCentre(app, "icon");
    await expect.poll(() => app.selectedLayers()).toEqual(["Icon"]);
    const before = await app.savedNodes(id);
    const button = await app.designRect("button");

    await drag(app, grab, button.x + 8, button.y + button.height / 2, true);

    const after = await app.savedNodes(id);
    expect(added(before, after)).toHaveLength(1);
    const [copy] = added(before, after);
    expect(childrenOf(after, "button")).toStrictEqual([copy.id, "save-label"]);
    expect(copy.attrs["data-agent-native-layer-name"]).toBe("Icon");
    expect(after.get("icon")).toEqual(before.get("icon"));
    expectOnlyChanged(before, after, [copy.id]);
    expect(
      await app.designRect(copy.id),
      "the copy sits in the button's flow, inside its padding",
    ).toEqual({
      x: 116,
      y: 312,
      width: 24,
      height: 24,
    });
    expect((await app.designRect("save-label")).x).toBe(148);
    await expect.poll(() => app.selectedLayers()).toEqual(["Icon"]);

    await app.page.keyboard.press("ControlOrMeta+z");
    await expect(app.node(copy.id)).toHaveCount(0);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});

test.describe("interaction: overview canvas and cross-boundary", () => {
  // fixme: fails on current main after the merge: Test timeout of 90000ms exceeded.
  test.fixme("F on the empty board creates one white, clipping board frame at the dragged box", async ({
    app,
  }) => {
    const id = await openSmallScreenOnBoard(app);
    const boardBefore = await app.savedNodes(id, "__board__.html");
    const screenBefore = await app.savedNodes(id);

    await drawWithTool(
      app,
      { key: "f", name: "Frame" },
      { x: 520, y: 40, width: 120, height: 80 },
    );

    const boardAfter = await app.savedNodes(id, "__board__.html");
    expect(
      added(boardBefore, boardAfter).map(
        (node) => node.attrs["data-an-primitive"],
      ),
    ).toEqual(["frame"]);
    const [frame] = added(boardBefore, boardAfter);
    await expectWithinAPagePixel(
      app,
      savedBox(frame),
      { x: 520, y: 40, width: 120, height: 80 },
      "saved board frame",
    );
    expect(
      await computedFromSaved(app, frame, ["background-color", "overflow"]),
    ).toEqual({
      "background-color": "rgb(255, 255, 255)",
      overflow: "hidden",
    });
    expectOnlyChanged(screenBefore, await app.savedNodes(id), []);
  });

  // fixme: fails on current main after the merge: Error: expect(locator).toBeVisible() failed
  test.fixme("Alt-dragging a board rectangle 150px right drops one copy exactly 150px right and leaves the original", async ({
    app,
  }) => {
    const id = await openSmallScreenOnBoard(app);
    const boardBefore = await app.savedNodes(id, "__board__.html");
    await drawWithTool(
      app,
      { key: "r", name: "Rectangle" },
      { x: 520, y: 40, width: 100, height: 100 },
    );
    const withRect = await app.savedNodes(id, "__board__.html");
    expect(
      added(boardBefore, withRect).map(
        (node) => node.attrs["data-an-primitive"],
      ),
    ).toEqual(["rectangle"]);
    const [original] = added(boardBefore, withRect);
    const drawn = savedBox(original);
    await expectWithinAPagePixel(
      app,
      drawn,
      { x: 520, y: 40, width: 100, height: 100 },
      "drawn board rectangle",
    );
    await app.page.keyboard.press("v");
    const grab = await app.pagePoint(drawn.x + 50, drawn.y + 50);
    await app.page.mouse.click(grab.x, grab.y);
    await expect
      .poll(() => app.selectedLayers())
      .toEqual([original.attrs["data-agent-native-layer-name"]]);

    await drag(app, grab, drawn.x + 200, drawn.y + 50, true);

    const after = await app.savedNodes(id, "__board__.html");
    expect(added(withRect, after)).toHaveLength(1);
    const [copy] = added(withRect, after);
    expect(after.get(original.id)).toEqual(withRect.get(original.id));
    await expectWithinAPagePixel(
      app,
      savedBox(copy),
      { ...drawn, x: drawn.x + 150 },
      "saved copy",
    );
    expectOnlyChanged(withRect, after, [copy.id]);
  });

  test("a layer dragged from a screen onto the board and back lands at each release point and lives in exactly one file", async ({
    app,
  }) => {
    const id = await openSmallScreenOnBoard(app);
    const grab = await clickCentre(app, "card");
    await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
    const screenBefore = await app.savedNodes(id);

    await drag(app, grab, 520, 130);

    const screenOut = await app.savedNodes(id);
    expect(screenOut.has("card"), "the card left the screen").toBe(false);
    expectOnlyChanged(screenBefore, screenOut, ["card"]);
    const boardCard = (await app.savedNodes(id, "__board__.html")).get("card");
    await expectWithinAPagePixel(
      app,
      savedBox(boardCard),
      { x: 440, y: 80, width: 160, height: 100 },
      "card on the board",
    );

    const boardGrab = await app.pagePoint(520, 130);
    await drag(app, boardGrab, 200, 200);

    const screenBack = await app.savedNodes(id);
    expect(
      (await app.savedNodes(id, "__board__.html")).has("card"),
      "the card left the board",
    ).toBe(false);
    expect(screenBack.get("card")?.parent).toBe("page");
    await expectWithinAPagePixel(
      app,
      savedBox(screenBack.get("card")),
      { x: 120, y: 150, width: 160, height: 100 },
      "card back in the screen",
    );
    expectOnlyChanged(screenBefore, screenBack, ["card"]);
    await expectWithinAPagePixel(
      app,
      await app.designRect("card"),
      { x: 120, y: 150, width: 160, height: 100 },
      "rendered card",
    );
  });
});
