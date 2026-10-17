import { expect, expectOnlyChanged, styleOf, test } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source"
    style="position:absolute;left:500px;top:300px;width:500px;height:110px;background:rgb(234, 88, 12)"></div>
</body></html>`;

for (const { title, lastMove } of [
  {
    title: "a free layer keeps its release position through save and reload",
    lastMove: { x: 350, y: 205 },
  },
  {
    title:
      "a free layer uses release coordinates when the last pointer move differs",
    lastMove: { x: 347, y: 195 },
  },
]) {
  test(title, async ({ app }) => {
    const id = await app.seed(FIXTURE);
    await app.open(id);
    await app.zoomToFit();
    const grab = await app.pagePoint(750, 355);
    await app.page.mouse.click(grab.x, grab.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Source"]);
    const before = await app.savedNodes(id);
    const move = await app.pagePoint(lastMove.x, lastMove.y);
    const release = await app.pagePoint(350, 205);

    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(grab.x + 10, grab.y + 6, { steps: 5 });
    await app.page.mouse.move(move.x, move.y, { steps: 20 });
    const cdp = await app.page.context().newCDPSession(app.page);
    try {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: release.x,
        y: release.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    } finally {
      await cdp.detach();
    }
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("source")?.parent).toBe(before.get("source")?.parent);
    expect(styleOf(after.get("source"))).toEqual({
      position: "absolute",
      left: "100px",
      top: "150px",
      width: "500px",
      height: "110px",
      background: "rgb(234, 88, 12)",
    });
    expectOnlyChanged(before, after, ["source"]);
    expect(await app.designRect("source")).toEqual({
      x: 100,
      y: 150,
      width: 500,
      height: 110,
    });

    await app.open(id);
    await app.zoomToFit();
    expect(await app.savedNodes(id)).toEqual(after);
    expect(await app.designRect("source")).toEqual({
      x: 100,
      y: 150,
      width: 500,
      height: 110,
    });
  });
}
