import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
} from "./rails";

const ROW_AND_CONTAINERS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px">
    <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha" style="width:120px;height:44px">Alpha</button>
    <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta" style="width:120px;height:44px">Beta</button>
  </div>
  <section data-agent-native-node-id="empty" data-agent-native-layer-name="Empty" style="margin-top:40px;width:400px;height:200px;background:#eeeeee"></section>
  <section data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="margin-top:40px;width:400px;height:200px;padding:16px;background:#dde3ea">
    <h2 data-agent-native-node-id="card-title" data-agent-native-layer-name="Card title" style="margin:0;font-size:20px">Card title</h2>
  </section>
</body></html>`;

async function selectAndGrab(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const grab = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(grab.x, grab.y);
  return { rect, grab };
}

async function dragTo(
  app: App,
  from: { x: number; y: number },
  designX: number,
  designY: number,
) {
  const to = await app.pagePoint(designX, designY);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 12 });
  await app.page.mouse.up();
  await app.settled();
}

test("dragging a button over its sibling's far half reorders the row and changes nothing else", async ({
  app,
}) => {
  const id = await app.seed(ROW_AND_CONTAINERS);
  await app.open(id);
  await app.zoomToFit();
  const { grab } = await selectAndGrab(app, "alpha");
  expect(await app.selectedLayers()).toEqual(["Alpha"]);
  const before = await app.savedNodes(id);
  const beta = await app.designRect("beta");

  await dragTo(app, grab, beta.x + beta.width * 0.75, beta.y + beta.height / 2);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "row")).toEqual(["beta", "alpha"]);
  expect(styleOf(after.get("alpha"))).toEqual(styleOf(before.get("alpha")));
  expectOnlyChanged(before, after, ["alpha"]);
  expect((await app.designRect("alpha")).x).toBeGreaterThan(
    (await app.designRect("beta")).x,
  );
});

// fixme: product bug: The element leaves the row and is saved on the page as position:absolute (left:266px; top:40px). Expected per auto-layout semantics
test.fixme("dropping a button in the empty end of its auto-layout row keeps it in the row as the last child", async ({
  app,
}) => {
  const id = await app.seed(ROW_AND_CONTAINERS);
  await app.open(id);
  await app.zoomToFit();
  const { grab } = await selectAndGrab(app, "alpha");
  const before = await app.savedNodes(id);
  const beta = await app.designRect("beta");

  await dragTo(app, grab, beta.x + beta.width + 30, beta.y + beta.height / 2);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "row")).toEqual(["beta", "alpha"]);
  expect(styleOf(after.get("alpha"))).toEqual(styleOf(before.get("alpha")));
  expectOnlyChanged(before, after, ["alpha"]);
});

test("dropping a button into an empty container makes the container a vertical auto layout holding only that button", async ({
  app,
}) => {
  const id = await app.seed(ROW_AND_CONTAINERS);
  await app.open(id);
  await app.zoomToFit();
  const { grab } = await selectAndGrab(app, "alpha");
  const before = await app.savedNodes(id);
  const empty = await app.designRect("empty");

  await dragTo(
    app,
    grab,
    empty.x + empty.width / 2,
    empty.y + empty.height / 2,
  );

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "empty")).toEqual(["alpha"]);
  expect(childrenOf(after, "row")).toEqual(["beta"]);
  expect(styleOf(after.get("empty"))).toEqual({
    ...styleOf(before.get("empty")),
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
  });
  expect(styleOf(after.get("alpha"))).toEqual(styleOf(before.get("alpha")));
  expectOnlyChanged(before, after, ["alpha", "empty"]);
  const rendered = await app.designRect("alpha");
  expect({ x: rendered.x, y: rendered.y }).toEqual({ x: empty.x, y: empty.y });
});

// fixme: product bug: Saved parent is the page body (an absolute sibling floating above the card), not the card; Layers shows Alpha at top level. Same family
test.fixme("dropping a button into a container that already has content keeps the button where it was dropped", async ({
  app,
}) => {
  const id = await app.seed(ROW_AND_CONTAINERS);
  await app.open(id);
  await app.zoomToFit();
  const { rect, grab } = await selectAndGrab(app, "alpha");
  const before = await app.savedNodes(id);
  const card = await app.designRect("card");
  const drop = { x: card.x + 220, y: card.y + 120 };

  await dragTo(app, grab, drop.x, drop.y);

  const after = await app.savedNodes(id);
  expect(after.get("alpha")?.parent).toBe("card");
  const rendered = await app.designRect("alpha");
  const expected = { x: drop.x - rect.width / 2, y: drop.y - rect.height / 2 };
  expect(
    Math.abs(rendered.x - expected.x),
    `rendered x ${rendered.x}, dropped at ${expected.x}`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(rendered.y - expected.y),
    `rendered y ${rendered.y}, dropped at ${expected.y}`,
  ).toBeLessThanOrEqual(2);
  expectOnlyChanged(before, after, ["alpha", "card"]);
});
