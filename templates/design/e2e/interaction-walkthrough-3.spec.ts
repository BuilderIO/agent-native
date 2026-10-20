import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const NAV_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Navigation</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;width:1440px;height:80px;background:#ffffff;font-family:system-ui,sans-serif">
    <p data-agent-native-node-id="wordmark" data-agent-native-layer-name="Acme" style="position:absolute;left:700px;top:28px;width:80px;height:24px;margin:0;font-size:20px;line-height:24px">Acme</p>
  </body>
</html>`;

const LINKS_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Navigation</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;width:1440px;height:80px;background:#ffffff;font-family:system-ui,sans-serif">
    <p data-agent-native-node-id="link-1" data-agent-native-layer-name="Link 1" style="position:absolute;left:200px;top:28px;width:80px;height:24px;margin:0;line-height:24px">Link</p>
    <p data-agent-native-node-id="link-2" data-agent-native-layer-name="Link 2" style="position:absolute;left:320px;top:28px;width:80px;height:24px;margin:0;line-height:24px">Link</p>
    <p data-agent-native-node-id="link-3" data-agent-native-layer-name="Link 3" style="position:absolute;left:440px;top:28px;width:80px;height:24px;margin:0;line-height:24px">Link</p>
    <p data-agent-native-node-id="link-4" data-agent-native-layer-name="Link 4" style="position:absolute;left:560px;top:28px;width:80px;height:24px;margin:0;line-height:24px">Link</p>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

async function centerOf(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  return app.pagePoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function clickCenter(app: App, nodeId: string) {
  const center = await centerOf(app, nodeId);
  await app.page.mouse.click(center.x, center.y);
}

test.describe("interaction: guided walkthrough - navigation bar", () => {
  test("a wordmark dragged to within 4px of the screen's left edge snaps to x=0", async ({
    app,
  }) => {
    const page = app.page;
    const id = await app.seed(NAV_HTML);
    await app.open(id);
    await app.zoomToFit();
    const grab = await centerOf(app, "wordmark");
    await page.mouse.click(grab.x, grab.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Acme"]);
    const before = await app.savedNodes(id);

    const release = await app.pagePoint(4 + 40, 28 + 12);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 24 });
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("wordmark"))).toEqual({
      ...styleOf(before.get("wordmark")),
      left: "0px",
    });
    expectOnlyChanged(before, after, ["wordmark"]);
    expect(await app.designRect("wordmark")).toEqual({
      x: 0,
      y: 28,
      width: 80,
      height: 24,
    });
  });

  test("Cmd+G groups exactly the three Shift-clicked links, in place, and leaves the fourth outside", async ({
    app,
  }) => {
    const page = app.page;
    const id = await app.seed(LINKS_HTML);
    await app.open(id);
    await app.zoomToFit();
    const before = await app.savedNodes(id);

    await clickCenter(app, "link-1");
    await page.keyboard.down("Shift");
    await clickCenter(app, "link-2");
    await clickCenter(app, "link-3");
    await page.keyboard.up("Shift");
    await expect
      .poll(() => app.selectedLayers())
      .toEqual(["Link 3", "Link 2", "Link 1"]);

    await page.keyboard.press(`${MOD}+g`);
    await app.settled();

    const after = await app.savedNodes(id);
    const group = after.get("link-1")!.parent!;
    expect(after.get(group)?.attrs["data-agent-native-layer-name"]).toBe(
      "Group",
    );
    expect(childrenOf(after, group)).toStrictEqual([
      "link-1",
      "link-2",
      "link-3",
    ]);
    expect(childrenOf(after, "page")).toStrictEqual([group, "link-4"]);
    expectOnlyChanged(before, after, ["link-1", "link-2", "link-3", group]);
    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);
    expect(await app.designRect(group)).toEqual({
      x: 200,
      y: 28,
      width: 320,
      height: 24,
    });
    for (const [link, x] of [
      ["link-1", 200],
      ["link-2", 320],
      ["link-3", 440],
    ] as const) {
      expect(await app.designRect(link), `${link} stays in place`).toEqual({
        x,
        y: 28,
        width: 80,
        height: 24,
      });
    }
  });
});
