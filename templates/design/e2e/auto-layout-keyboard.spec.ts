import { expect, expectOnlyChanged, test, type App } from "./rails";

const AUTO_LAYOUT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Auto Layout Keyboard</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="al-root" data-agent-native-layer-name="Root" style="position:relative;min-height:560px;padding:48px">
      <section data-agent-native-node-id="al-row" data-agent-native-layer-name="Card Row" style="display:flex;flex-direction:row;gap:16px;padding:16px;background:#1e293b;border-radius:16px">
        <div data-agent-native-node-id="al-alpha" data-agent-native-layer-name="Alpha" style="padding:12px 16px;border-radius:10px;background:#38bdf8;color:#082f49">Alpha</div>
        <div data-agent-native-node-id="al-beta" data-agent-native-layer-name="Beta" style="color:#a78bfa;font-weight:600">Beta</div>
        <div data-agent-native-node-id="al-gamma" data-agent-native-layer-name="Gamma" style="padding:12px 16px;border-radius:10px;background:#fbbf24;color:#451a03">Gamma</div>
      </section>
      <div data-agent-native-node-id="al-free" data-agent-native-layer-name="Free Frame" style="position:relative;margin-top:32px;width:360px;height:200px;border:1px dashed #475569;border-radius:12px"></div>
    </main>
  </body>
</html>`;

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

function childrenOf(
  nodes: Map<string, { parent: string | null; index: number }>,
  parent: string,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

function subtree(
  nodes: Map<string, { parent: string | null }>,
  id: string,
): string[] {
  return [
    id,
    ...[...nodes.entries()]
      .filter(([, node]) => node.parent === id)
      .flatMap(([child]) => subtree(nodes, child)),
  ];
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

async function openWithClipboard(app: App) {
  const id = await app.seed(AUTO_LAYOUT_HTML);
  await app.page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

test.describe("auto layout keyboard interactions", () => {
  test("arrow keys reorder an auto layout child instead of offsetting it", async ({
    app,
    page,
  }) => {
    const id = await app.seed(AUTO_LAYOUT_HTML);
    await app.open(id);
    await app.zoomToFit();
    await selectOnCanvas(app, "al-alpha", "Alpha");
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "al-row")).toEqual([
      "al-alpha",
      "al-beta",
      "al-gamma",
    ]);

    await page.keyboard.press("ArrowRight");
    await app.settled();
    const right = await app.savedNodes(id);
    expect(childrenOf(right, "al-row")).toEqual([
      "al-beta",
      "al-alpha",
      "al-gamma",
    ]);
    expectOnlyChanged(before, right, []);

    await page.keyboard.press("ArrowLeft");
    await app.settled();
    const left = await app.savedNodes(id);
    expect(childrenOf(left, "al-row")).toEqual([
      "al-alpha",
      "al-beta",
      "al-gamma",
    ]);
    expectOnlyChanged(before, left, []);

    await page.keyboard.press("ArrowUp");
    await app.settled();
    const up = await app.savedNodes(id);
    expect(childrenOf(up, "al-row")).toEqual([
      "al-alpha",
      "al-beta",
      "al-gamma",
    ]);
    expectOnlyChanged(before, up, []);
  });

  // fixme: product bug: The pasted copy renders 360x42: as a block child it stretches to Free Frame's full width instead of keeping the original's size.
  test.fixme("pasting into a selected frame puts one copy of Alpha inside it at Alpha's size", async ({
    app,
    page,
  }) => {
    const id = await openWithClipboard(app);
    const alphaSize = await app.designRect("al-alpha");
    await selectOnCanvas(app, "al-alpha", "Alpha");
    await page.keyboard.press(`${PRIMARY}+c`);
    await selectOnCanvas(app, "al-free", "Free Frame");
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "al-free")).toEqual([]);

    await page.keyboard.press(`${PRIMARY}+v`);
    await app.settled();

    const after = await app.savedNodes(id);
    const pasted = childrenOf(after, "al-free");
    expect(pasted).toHaveLength(1);
    expect(after.get(pasted[0]!)?.attrs["data-agent-native-layer-name"]).toBe(
      "Alpha",
    );
    expectOnlyChanged(before, after, subtree(after, pasted[0]!));
    const copy = await app.designRect(pasted[0]!);
    expect(
      { width: copy.width, height: copy.height },
      "the pasted copy keeps the original's size",
    ).toEqual({ width: alphaSize.width, height: alphaSize.height });
  });

  test("paste lands right after a selected text object, not inside it", async ({
    app,
    page,
  }) => {
    const id = await openWithClipboard(app);
    await selectOnCanvas(app, "al-alpha", "Alpha");
    await page.keyboard.press(`${PRIMARY}+c`);
    await selectOnCanvas(app, "al-beta", "Beta");
    const before = await app.savedNodes(id);

    await page.keyboard.press(`${PRIMARY}+v`);
    await app.settled();

    const after = await app.savedNodes(id);
    const row = childrenOf(after, "al-row");
    const copy = row.find((nodeId) => !before.has(nodeId))!;
    expect(row).toEqual(["al-alpha", "al-beta", copy, "al-gamma"]);
    expect(after.get(copy)?.attrs["data-agent-native-layer-name"]).toBe(
      "Alpha",
    );
    expectOnlyChanged(before, after, subtree(after, copy));
  });
});
