import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const SHAPES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>DnD</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
         style="position:absolute;left:60px;top:300px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" data-an-primitive="rectangle"
         style="position:absolute;left:60px;top:480px;width:120px;height:80px;background:#22c55e"></div>
  </body>
</html>`;

const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

function activeTag(app: App) {
  return app.page.evaluate(() => document.activeElement?.tagName);
}

for (const focus of ["host", "iframe"] as const) {
  test(`Escape after releasing a move keeps the committed position with ${focus} focus`, async ({
    app,
    page,
  }) => {
    const id = await app.seed(SHAPES);
    await app.open(id);
    await app.zoomToFit();
    const grab = await app.pagePoint(120, 340);
    const drop = await app.pagePoint(240, 400);
    await page.mouse.click(grab.x, grab.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 16 });
    await expect
      .poll(async () => (await app.designRect("box-a")).x, {
        message: "precondition: Box A follows the pointer",
      })
      .toBeGreaterThan(150);
    const held = await app.designRect("box-a");
    await page.mouse.up();
    // A canvas press always focuses the host, so the iframe peer only sees Escape if focus moves there.
    if (focus === "iframe") await page.locator(LIVE_SCREEN).focus();
    expect(
      (await activeTag(app)) === "IFRAME",
      `precondition: keyboard focus is in the ${focus}`,
    ).toBe(focus === "iframe");
    await page.keyboard.press("Escape");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual({
      ...styleOf(before.get("box-a")),
      left: `${held.x}px`,
      top: `${held.y}px`,
    });
    expectOnlyChanged(before, after, ["box-a"]);
    expect(await app.designRect("box-a")).toEqual(held);

    await app.open(id);
    expect(await app.designRect("box-a")).toEqual(held);
    expectOnlyChanged(after, await app.savedNodes(id), []);
  });
}
