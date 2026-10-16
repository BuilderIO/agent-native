import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

// A text layer never adopts a dropped layer, so a drop over the caption keeps Box A a sibling.
const SHAPES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>DnD</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
         style="position:absolute;left:60px;top:300px;width:120px;height:80px;background:#3b82f6"></div>
    <p data-agent-native-node-id="caption" data-agent-native-layer-name="Caption"
       style="position:absolute;left:60px;top:480px;width:120px;height:80px;margin:0;background:#22c55e;font:16px system-ui">Caption</p>
  </body>
</html>`;

const BOX_A = { x: 60, y: 300, width: 120, height: 80 };

/** Opens the seeded shapes, selects Box A with a plain click and presses on its centre. */
async function grabBoxA(app: App) {
  const id = await app.seed(SHAPES);
  await app.open(id);
  await app.zoomToFit();
  const centre = await app.pagePoint(
    BOX_A.x + BOX_A.width / 2,
    BOX_A.y + BOX_A.height / 2,
  );
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
  const before = await app.savedNodes(id);
  await app.page.mouse.move(centre.x, centre.y);
  await app.page.mouse.down();
  return { id, before, centre };
}

/** Moves the pressed pointer by a delta given in design px. */
async function moveBy(
  app: App,
  from: { x: number; y: number; scale: number },
  dx: number,
  dy: number,
) {
  await app.page.mouse.move(
    from.x + dx * from.scale,
    from.y + dy * from.scale,
    { steps: 16 },
  );
}

test.describe("moving by drag", () => {
  test("a drag moves the element by the drag delta", async ({ app }) => {
    const { id, before, centre } = await grabBoxA(app);

    await moveBy(app, centre, 337, 43);
    await app.page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual({
      ...styleOf(before.get("box-a")),
      left: "397px",
      top: "343px",
    });
    expectOnlyChanged(before, after, ["box-a"]);
    expect(await app.designRect("box-a")).toEqual({
      x: 397,
      y: 343,
      width: 120,
      height: 80,
    });
  });

  test("dropping over a sibling keeps the moved position after reload", async ({
    app,
  }) => {
    const { id, before, centre } = await grabBoxA(app);

    await moveBy(app, centre, 30, 200);
    await app.page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "page")).toEqual(["box-a", "caption"]);
    expectOnlyChanged(before, after, ["box-a"]);
    const dropped = await app.designRect("box-a");
    const savedBeforeReload = await app.savedHtml(id);

    await app.open(id);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(savedBeforeReload);
    expect(await app.designRect("box-a")).toEqual(dropped);
    expect(await app.designRect("caption")).toEqual({
      x: 60,
      y: 480,
      width: 120,
      height: 80,
    });
    expect(
      styleOf(after.get("box-a")),
      "Box A lands where it was dropped",
    ).toEqual({
      ...styleOf(before.get("box-a")),
      left: "90px",
      top: "500px",
    });
  });

  test("Shift+drag locks movement to one axis", async ({ app }) => {
    const { id, before, centre } = await grabBoxA(app);

    await moveBy(app, centre, 20, 3);
    await app.page.keyboard.down("Shift");
    await moveBy(app, centre, 200, 30);
    await app.page.mouse.up();
    await app.page.keyboard.up("Shift");
    await app.settled();

    const after = await app.savedNodes(id);
    const saved = styleOf(after.get("box-a"));
    expect(saved.top, "Shift keeps the vertical position").toBe("300px");
    expect((await app.designRect("box-a")).y).toBe(300);
    expectOnlyChanged(before, after, ["box-a"]);
    expect(saved, "Box A moves by the horizontal drag delta").toEqual({
      ...styleOf(before.get("box-a")),
      left: "260px",
    });
  });

  test("Alt+drag leaves the original and creates a copy", async ({ app }) => {
    const { id, before, centre } = await grabBoxA(app);

    await app.page.keyboard.down("Alt");
    await moveBy(app, centre, 300, 0);
    await app.page.mouse.up();
    await app.page.keyboard.up("Alt");
    await app.settled();

    const after = await app.savedNodes(id);
    const added = [...after.keys()].filter((nodeId) => !before.has(nodeId));
    expect(added, "exactly one copy").toHaveLength(1);
    const [copyId] = added;
    expect(childrenOf(after, "page")).toEqual(["box-a", copyId, "caption"]);
    const {
      "data-agent-native-node-id": _id,
      "data-agent-native-clone-root": _cloneMarker,
      style: _copyStyle,
      ...copyAttrs
    } = after.get(copyId)!.attrs;
    const {
      "data-agent-native-node-id": _originalId,
      style: _style,
      ...attrs
    } = before.get("box-a")!.attrs;
    expect(copyAttrs).toEqual(attrs);
    expect(styleOf(after.get(copyId))).toEqual({
      position: "absolute",
      left: "360px",
      top: "300px",
      width: "120px",
      height: "80px",
      background: "rgb(59, 130, 246)",
    });
    expectOnlyChanged(before, after, [copyId]);
    expect(await app.designRect("box-a")).toEqual(BOX_A);
    expect(await app.designRect(copyId)).toEqual({ ...BOX_A, x: 360 });
    await expect(
      app.page
        .locator(
          'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
        )
        .contentFrame()
        .locator('[data-agent-native-transient-drag-clone="true"]'),
    ).toHaveCount(0);
  });

  test("Escape during a drag cancels the move", async ({ app }) => {
    const { id, before, centre } = await grabBoxA(app);

    await moveBy(app, centre, 200, 100);
    await expect
      .poll(
        async () => {
          const moving = await app.designRect("box-a");
          return moving.x > BOX_A.x + 100 && moving.y > BOX_A.y + 50;
        },
        { message: "precondition: Box A follows the pointer mid-drag" },
      )
      .toBe(true);
    await app.page.keyboard.press("Escape");
    await app.page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual(styleOf(before.get("box-a")));
    expectOnlyChanged(before, after, ["box-a"]);
    expect(await app.designRect("box-a")).toEqual(BOX_A);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
  });
});
