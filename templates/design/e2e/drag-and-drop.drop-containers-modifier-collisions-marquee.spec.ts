import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const dropFixture = (primitive: string) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Drop</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="mover" data-agent-native-layer-name="Mover"
         style="position:absolute;left:20px;top:300px;width:100px;height:60px;background:#a855f7"></div>
    <div data-agent-native-node-id="target" data-agent-native-layer-name="Target" data-an-primitive="${primitive}"
         style="position:absolute;left:170px;top:300px;width:120px;height:120px;background:#ec4899"></div>
  </body>
</html>`;

const TWO_BOXES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Boxes</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
         style="position:absolute;left:60px;top:300px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" data-an-primitive="rectangle"
         style="position:absolute;left:400px;top:300px;width:120px;height:80px;background:#22c55e"></div>
  </body>
</html>`;

const STACKED_BOXES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Boxes</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
         style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" data-an-primitive="rectangle"
         style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="box-c" data-agent-native-layer-name="Box C" data-an-primitive="rectangle"
         style="position:absolute;left:400px;top:440px;width:120px;height:80px;background:#f59e0b"></div>
  </body>
</html>`;

async function openSeeded(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

/** Presses at a design point, drags to another and returns the dragged node's box just before release. */
async function dragAndHold(
  app: App,
  nodeId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const resting = await app.designRect(nodeId);
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 20 });
  await expect
    .poll(() => app.designRect(nodeId), {
      message: `precondition: ${nodeId} follows the pointer`,
    })
    .not.toEqual(resting);
  return app.designRect(nodeId);
}

test.describe("drop containers", () => {
  for (const [primitive, title] of [
    ["frame", "a frame adopts an element dragged into it"],
    [
      "rectangle",
      "a rectangle adopts as a free-placement container, not a layout parent",
    ],
  ] as const) {
    test(title, async ({ app }) => {
      const id = await openSeeded(app, dropFixture(primitive));
      const before = await app.savedNodes(id);

      const held = await dragAndHold(
        app,
        "mover",
        { x: 70, y: 330 },
        { x: 230, y: 360 },
      );
      await app.page.mouse.up();
      await app.settled();

      const after = await app.savedNodes(id);
      expect(childrenOf(after, "target")).toEqual(["mover"]);
      expect(styleOf(after.get("mover"))).toEqual({
        position: "absolute",
        left: `${held.x - 170}px`,
        top: `${held.y - 300}px`,
        width: "100px",
        height: "60px",
        background: "rgb(168, 85, 247)",
      });
      expectOnlyChanged(before, after, ["mover"]);
      expect(await app.designRect("mover")).toEqual(held);
      expect(
        held.x >= 170 &&
          held.x + 100 <= 290 &&
          held.y >= 300 &&
          held.y + 60 <= 420,
        `the mover is held inside the target: ${JSON.stringify(held)}`,
      ).toBe(true);
    });
  }
});

test.describe("modifier collisions", () => {
  test("the primary modifier does not hijack a drag", async ({ app }) => {
    const id = await openSeeded(app, TWO_BOXES);
    const before = await app.savedNodes(id);

    const plain = await dragAndHold(
      app,
      "box-a",
      { x: 120, y: 340 },
      { x: 120, y: 240 },
    );
    await app.page.mouse.up();
    await app.settled();
    expect(plain.y, "precondition: a plain drag moves Box A up").toBeLessThan(
      220,
    );

    await app.page.keyboard.down(PRIMARY);
    const modified = await dragAndHold(
      app,
      "box-b",
      { x: 460, y: 340 },
      { x: 460, y: 240 },
    );
    await app.page.mouse.up();
    await app.page.keyboard.up(PRIMARY);
    await app.settled();

    expect(
      modified.y,
      "the modified drag travels as far as the plain one",
    ).toBe(plain.y);
    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual({
      ...styleOf(before.get("box-a")),
      top: `${plain.y}px`,
    });
    expect(styleOf(after.get("box-b"))).toEqual({
      ...styleOf(before.get("box-b")),
      top: `${plain.y}px`,
    });
    expectOnlyChanged(before, after, ["box-a", "box-b"]);
    expect(await app.designRect("box-b")).toEqual(modified);
  });
});

test.describe("marquee", () => {
  // fixme: product bug: With two layers selected, the selection size badge reads '120 × 80' (Box B alone) instead of the 120 × 240 union. showSizeBadge(el)
  test.fixme("dragging from empty canvas marquee-selects the elements it covers", async ({
    app,
  }) => {
    const id = await openSeeded(app, STACKED_BOXES);
    const before = await app.savedNodes(id);
    const from = await app.pagePoint(180, 240);
    const to = await app.pagePoint(15, 545);

    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 20 });
    await app.page.mouse.up();

    await expect.poll(() => app.selectedLayers()).toEqual(["Box B", "Box A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
    await expect(
      app.page
        .frameLocator(LIVE_SCREEN)
        .locator('[data-agent-native-edit-overlay="size-badge"]'),
      "the size badge measures the whole selection",
    ).toHaveText("120 × 240");
  });
});
