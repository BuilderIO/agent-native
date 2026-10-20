import { expect, expectOnlyChanged, test, type App } from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Marquee reachability</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <div data-agent-native-node-id="wrapper" data-agent-native-layer-name="Wrapper"
         style="position:relative;width:100%;min-height:820px;background:#fff">
      <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
           style="position:absolute;left:20px;top:120px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
           style="position:absolute;left:170px;top:120px;width:110px;height:80px;background:#22c55e"></div>
      <div class="unnamed-target" data-agent-native-layer-name="Unnamed"
           style="position:absolute;left:20px;top:320px;width:200px;height:70px;background:#f59e0b"></div>
      <div data-agent-native-node-id="flat" data-agent-native-layer-name="Flat row"
           style="position:absolute;left:20px;top:440px;width:200px;height:0;overflow:visible">
        <span data-agent-native-node-id="flat-bar" data-agent-native-layer-name="Flat bar"
              style="display:block;width:200px;height:24px;background:#a855f7"></span>
      </div>
    </div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  const emptyCanvas = await app.pagePoint(-40, 100);
  await app.page.mouse.click(emptyCanvas.x, emptyCanvas.y);
  await expect.poll(() => app.selectedLayers()).toEqual([]);
  return { id, before: await app.savedNodes(id) };
}

async function sweep(
  app: App,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { deep }: { deep: boolean },
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  if (deep) await app.page.keyboard.down("ControlOrMeta");
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 18 });
  await app.page.mouse.up();
  if (deep) await app.page.keyboard.up("ControlOrMeta");
}

async function sortedSelection(app: App) {
  return (await app.selectedLayers()).sort();
}

test.describe("marquee reachability", () => {
  test("a Cmd-marquee from empty screen space selects exactly the boxes it crosses", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);

    await sweep(app, { x: 40, y: 100 }, { x: 300, y: 220 }, { deep: true });

    await expect.poll(() => sortedSelection(app)).toEqual(["Box A", "Box B"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("a Cmd-marquee selects an element whose rendered node id is missing", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);
    const unnamed = app
      .node("wrapper")
      .locator('[data-agent-native-layer-name="Unnamed"]');
    await unnamed.evaluate((element) =>
      element.removeAttribute("data-agent-native-node-id"),
    );
    await expect(unnamed).not.toHaveAttribute("data-agent-native-node-id");

    await sweep(app, { x: 240, y: 300 }, { x: 100, y: 410 }, { deep: true });

    await expect.poll(() => sortedSelection(app)).toEqual(["Unnamed"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("a marquee across a zero-height row selects the row and not its overflowing child", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);
    expect(await app.designRect("flat")).toEqual({
      x: 20,
      y: 440,
      width: 200,
      height: 0,
    });

    await sweep(app, { x: 240, y: 425 }, { x: 100, y: 450 }, { deep: false });

    await expect.poll(() => sortedSelection(app)).toEqual(["Flat row"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});
