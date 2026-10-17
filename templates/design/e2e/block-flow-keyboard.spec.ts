import { expect, expectOnlyChanged, test, type App } from "./rails";

const BLOCK_FLOW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Block Flow Keyboard</title>
    <style>
      /* Deliberately in a stylesheet: the authored-style parser cannot see
         this, so only the browser's rendered display knows the real layout. */
      .stack { padding: 16px; background: #1e293b; border-radius: 16px; }
      .stack > div { padding: 12px 16px; border-radius: 10px; }
    </style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="bf-root" data-agent-native-layer-name="Root" style="position:relative;min-height:560px;padding:48px">
      <section data-agent-native-node-id="bf-stack" data-agent-native-layer-name="Stack" class="stack">
        <div data-agent-native-node-id="bf-alpha" data-agent-native-layer-name="BlockAlpha" style="background:#38bdf8;color:#082f49">Alpha</div>
        <div data-agent-native-node-id="bf-beta" data-agent-native-layer-name="BlockBeta" style="background:#a78bfa;color:#1f1147">Beta</div>
        <div data-agent-native-node-id="bf-gamma" data-agent-native-layer-name="BlockGamma" style="background:#fbbf24;color:#451a03">Gamma</div>
      </section>
    </main>
  </body>
</html>`;

function stackOrder(
  nodes: Map<string, { parent: string | null; index: number }>,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === "bf-stack")
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

async function selectOnCanvas(app: App, nodeId: string, layerName: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
}

test.describe("block flow keyboard nudge", () => {
  test("arrow keys reorder a block child instead of writing a dead offset", async ({
    app,
    page,
  }) => {
    const id = await app.seed(BLOCK_FLOW_HTML);
    await app.open(id);
    await app.zoomToFit();
    await selectOnCanvas(app, "bf-alpha", "BlockAlpha");
    const before = await app.savedNodes(id);
    expect(stackOrder(before)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);

    await page.keyboard.press("ArrowDown");
    await app.settled();
    const down = await app.savedNodes(id);
    expect(stackOrder(down)).toEqual(["bf-beta", "bf-alpha", "bf-gamma"]);
    expectOnlyChanged(before, down, []);

    await page.keyboard.press("ArrowUp");
    await app.settled();
    const up = await app.savedNodes(id);
    expect(stackOrder(up)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
    expectOnlyChanged(before, up, []);

    await page.keyboard.press("ArrowRight");
    await app.settled();
    const right = await app.savedNodes(id);
    expect(stackOrder(right)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
    expectOnlyChanged(before, right, []);
  });

  test("ArrowDown on the last block child changes nothing, while ArrowUp still moves it", async ({
    app,
    page,
  }) => {
    const id = await app.seed(BLOCK_FLOW_HTML);
    await app.open(id);
    await app.zoomToFit();
    await selectOnCanvas(app, "bf-gamma", "BlockGamma");
    const before = await app.savedNodes(id);

    await page.keyboard.press("ArrowDown");
    await app.settled();
    const clamped = await app.savedNodes(id);
    expect(stackOrder(clamped)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
    expectOnlyChanged(before, clamped, []);

    await page.keyboard.press("ArrowUp");
    await app.settled();
    expect(stackOrder(await app.savedNodes(id))).toEqual([
      "bf-alpha",
      "bf-gamma",
      "bf-beta",
    ]);
  });
});
