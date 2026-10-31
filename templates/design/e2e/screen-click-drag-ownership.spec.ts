import { expandAllLayers } from "./helpers";
import { childrenOf, expect, expectOnlyChanged, styleOf, test } from "./rails";

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Screen drag ownership</title></head>
<body style="margin:0;width:1200px;height:760px;background:#e5e7eb">
  <div data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:1100px;height:650px;background:#dbeafe">
    <div data-agent-native-node-id="frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame" style="position:absolute;left:40px;top:40px;width:320px;height:240px;background:#93c5fd">
      <div data-agent-native-node-id="inner" data-agent-native-layer-name="Inner frame" data-an-primitive="frame" style="position:absolute;left:30px;top:30px;width:220px;height:150px;background:#60a5fa">
        <div data-agent-native-node-id="deep" data-agent-native-layer-name="Deep child" style="position:absolute;left:25px;top:25px;width:120px;height:70px;background:#1d4ed8"></div>
      </div>
    </div>
    <div data-agent-native-node-id="stack" data-agent-native-layer-name="Stack" style="position:absolute;left:460px;top:40px;width:560px;height:500px;display:flex;flex-direction:column;gap:30px;padding:20px;background:#dcfce7">
      <div data-agent-native-node-id="row-a" data-agent-native-layer-name="Auto layout row" data-an-primitive="frame" style="display:flex;gap:20px;padding:20px;width:480px;height:130px;flex-shrink:0;background:#86efac">
        <div data-agent-native-node-id="item-a" data-agent-native-layer-name="Item A" style="width:130px;height:80px;background:#22c55e"><p data-agent-native-node-id="text" data-agent-native-layer-name="Item text" style="margin:0;padding:10px">Nested text</p></div>
        <div data-agent-native-node-id="item-b" data-agent-native-layer-name="Item B" style="width:130px;height:80px;background:#16a34a"></div>
      </div>
      <div data-agent-native-node-id="row-b" data-agent-native-layer-name="Second row" data-an-primitive="frame" style="width:480px;height:130px;flex-shrink:0;background:#bbf7d0"></div>
    </div>
  </div>
</body></html>`;

// The bridge owns picking; this boundary also proves the host persists the
// original frame owner instead of moving/reordering its newly pickable child.
test("screen direct picking preserves selected frame and flow-row drag ownership after reload", async ({
  app,
  page,
}, testInfo) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await expandAllLayers(page);
  const before = await app.savedNodes(id);

  const deep = await app.designRect("deep");
  const click = await app.pagePoint(
    deep.x + deep.width / 2,
    deep.y + deep.height / 2,
  );
  await page.mouse.click(click.x, click.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Deep child"]);
  await page
    .getByRole("treeitem")
    .filter({ hasText: /^Nested frame$/ })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Nested frame"]);
  await page.mouse.move(click.x, click.y);
  // Keep the pixel-position oracle independent of nearby snap guides.
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.down();
  await page.mouse.move(
    click.x + 71 * click.scale,
    click.y + 53 * click.scale,
    { steps: 18 },
  );
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await app.settled();
  const moved = await app.savedNodes(id);
  expect(styleOf(moved.get("frame"))).toMatchObject({
    left: "111px",
    top: "93px",
    width: "320px",
    height: "240px",
  });
  expect(moved.get("frame")?.parent).toBe("outer");
  expect(childrenOf(moved, "frame")).toStrictEqual(["inner"]);
  expect(childrenOf(moved, "inner")).toStrictEqual(["deep"]);
  expectOnlyChanged(before, moved, ["frame"]);

  await page
    .getByRole("treeitem")
    .filter({ hasText: /^Auto layout row$/ })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Auto layout row"]);
  const text = await app.designRect("text");
  const second = await app.designRect("row-b");
  const start = await app.pagePoint(
    text.x + text.width / 2,
    text.y + text.height / 2,
  );
  const end = await app.pagePoint(
    text.x + text.width / 2,
    second.y + second.height + 30,
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
  await app.settled();
  const reordered = await app.savedNodes(id);
  expect(childrenOf(reordered, "stack")).toStrictEqual(["row-b", "row-a"]);
  expect(childrenOf(reordered, "row-a")).toStrictEqual(["item-a", "item-b"]);
  expect(reordered.get("text")?.parent).toBe("item-a");
  expect(styleOf(reordered.get("row-a"))).toMatchObject({
    display: "flex",
    width: "480px",
    height: "130px",
  });
  expect(styleOf(reordered.get("row-a")).position).not.toBe("absolute");
  expectOnlyChanged(moved, reordered, ["row-a"]);

  await page.reload();
  await app.zoomToFit();
  expect(await app.savedNodes(id)).toStrictEqual(reordered);
  const rowA = await app.designRect("row-a");
  const rowB = await app.designRect("row-b");
  expect(rowA.y).toBe(rowB.y + rowB.height + 30);
  const savedFrame = await app.designRect("frame");
  const savedOuter = await app.designRect("outer");
  expect(savedFrame.x - savedOuter.x).toBe(111);
  expect(savedFrame.y - savedOuter.y).toBe(93);
  await page.screenshot({
    path: testInfo.outputPath("screen-drag-ownership.png"),
  });
});
