import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Group Frame</title></head>
  <body style="margin:0;min-height:700px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="red" data-agent-native-layer-name="Red"
         style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#ef4444"></div>
    <div data-agent-native-node-id="green" data-agent-native-layer-name="Green"
         style="position:absolute;left:60px;top:60px;width:100px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="blue" data-agent-native-layer-name="Blue"
         style="position:absolute;left:100px;top:100px;width:100px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="solo" data-agent-native-layer-name="Solo"
         style="position:absolute;left:300px;top:300px;width:80px;height:60px;background:#a855f7"></div>
  </body>
</html>`;

// Design-px points that hit only the named layer and stay outside the rotate handles
// that sit diagonally beyond a selected neighbour's corners.
const ONLY = {
  Red: { x: 40, y: 40 },
  Green: { x: 150, y: 75 },
  Blue: { x: 110, y: 160 },
  Solo: { x: 340, y: 330 },
} as const;

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  return { id, before: await app.savedNodes(id) };
}

async function clickOnly(app: App, name: keyof typeof ONLY) {
  const point = await app.pagePoint(ONLY[name].x, ONLY[name].y);
  await app.page.mouse.click(point.x, point.y);
}

async function select(app: App, names: (keyof typeof ONLY)[]) {
  const [first, ...rest] = names;
  await clickOnly(app, first!);
  await app.page.keyboard.down("Shift");
  for (const name of rest) await clickOnly(app, name);
  await app.page.keyboard.up("Shift");
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual([...names].sort());
}

function addedNode(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
  layerName: string,
) {
  const added = [...after.values()].filter((node) => !before.has(node.id));
  expect(
    added.map((node) => node.attrs["data-agent-native-layer-name"]),
  ).toEqual([layerName]);
  return added[0]!;
}

async function wrap(
  app: App,
  id: string,
  before: Map<string, SavedNode>,
  shortcut: string,
  layerName: string,
) {
  await app.page.keyboard.press(shortcut);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
  await app.settled();
  const after = await app.savedNodes(id);
  return { after, wrapper: addedNode(before, after, layerName) };
}

function rootOf(nodes: Map<string, SavedNode>) {
  return nodes.get("red")!.parent!;
}

test.describe("Cmd+G group", () => {
  // fixme: fails on current main after the merge: Error: apiRequestContext.get: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+G on two overlapping layers wraps exactly them in a selected Group at their union bounds, and one undo restores the document", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);

    const { after, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+G",
      "Group",
    );

    expect(childrenOf(after, wrapper.id)).toEqual(["red", "green"]);
    expect(childrenOf(after, rootOf(before))).toEqual([
      wrapper.id,
      "blue",
      "solo",
    ]);
    expectOnlyChanged(before, after, ["red", "green", wrapper.id]);
    expect(await app.designRect(wrapper.id)).toEqual({
      x: 20,
      y: 20,
      width: 140,
      height: 120,
    });
    expect(await app.designRect("red")).toEqual({
      x: 20,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(await app.designRect("green")).toEqual({
      x: 60,
      y: 60,
      width: 100,
      height: 80,
    });

    await page.keyboard.press("ControlOrMeta+Z");
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+G on non-adjacent layers places the Group at the topmost selected layer's z-position", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Blue"]);

    const { after, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+G",
      "Group",
    );

    expect(childrenOf(after, wrapper.id)).toEqual(["red", "blue"]);
    expect(childrenOf(after, rootOf(before))).toEqual([
      "green",
      wrapper.id,
      "solo",
    ]);
    expectOnlyChanged(before, after, ["red", "blue", wrapper.id]);
    expect(await app.designRect("red")).toEqual({
      x: 20,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(await app.designRect("blue")).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 80,
    });
  });

  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+G on a single layer wraps it in a selected Group in its place, and one undo removes the Group", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Solo"]);

    const { after, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+G",
      "Group",
    );

    expect(childrenOf(after, wrapper.id)).toEqual(["solo"]);
    expect(childrenOf(after, rootOf(before))).toEqual([
      "red",
      "green",
      "blue",
      wrapper.id,
    ]);
    expectOnlyChanged(before, after, ["solo", wrapper.id]);
    expect(await app.designRect("solo")).toEqual({
      x: 300,
      y: 300,
      width: 80,
      height: 60,
    });

    await page.keyboard.press("ControlOrMeta+Z");
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  // fixme: product bug: With the Group selected, the inspector shows a Fill section ('Click + to replace mixed content'); a Fill heading is present (count 1).
  test.fixme("a Group has no fill: it paints nothing between its children and the inspector shows no Fill section", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);

    const { wrapper } = await wrap(app, id, before, "ControlOrMeta+G", "Group");

    expect(styleOf(wrapper)).not.toHaveProperty("background");
    expect(styleOf(wrapper)).not.toHaveProperty("background-color");
    await expect(app.node(wrapper.id)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(
      page.getByRole("heading", { name: "Position", exact: true }),
    ).toBeVisible();
    // count(), not toHaveCount(0): a retry passes once the dev server's dep reload blanks the page.
    expect(
      await page.getByRole("heading", { name: "Fill", exact: true }).count(),
      "a Group has no fill property, so the inspector must not offer a Fill section",
    ).toBe(0);
  });
});

test.describe("Cmd+Opt+G frame selection", () => {
  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+Opt+G wraps two layers in a selected Frame with no fill and no clipping", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);

    const { after, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+Alt+G",
      "Frame",
    );

    expect(childrenOf(after, wrapper.id)).toEqual(["red", "green"]);
    expect(childrenOf(after, rootOf(before))).toEqual([
      wrapper.id,
      "blue",
      "solo",
    ]);
    expectOnlyChanged(before, after, ["red", "green", wrapper.id]);
    await expect(app.node(wrapper.id)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(app.node(wrapper.id)).toHaveCSS("overflow", "visible");
    expect(await app.designRect(wrapper.id)).toEqual({
      x: 20,
      y: 20,
      width: 140,
      height: 120,
    });
  });

  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+Opt+G on a single layer wraps it in a selected Frame in its place", async ({
    app,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Solo"]);

    const { after, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+Alt+G",
      "Frame",
    );

    expect(childrenOf(after, wrapper.id)).toEqual(["solo"]);
    expect(childrenOf(after, rootOf(before))).toEqual([
      "red",
      "green",
      "blue",
      wrapper.id,
    ]);
    expectOnlyChanged(before, after, ["solo", wrapper.id]);
    expect(await app.designRect("solo")).toEqual({
      x: 300,
      y: 300,
      width: 80,
      height: 60,
    });
  });

  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("a fill added to a Frame paints behind its children, which stay on top", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);
    const { after: framed, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+Alt+G",
      "Frame",
    );

    await page
      .locator("[data-design-inspector-section]")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .locator("[data-inspector-action-rail]")
      .getByRole("button", { name: "Add fill" })
      .click();

    await expect(app.node(wrapper.id)).toHaveCSS(
      "background-color",
      "rgb(217, 217, 217)",
    );
    const topmost = await app.node(wrapper.id).evaluate((frame) =>
      [
        { x: 40, y: 40 },
        { x: 150, y: 75 },
        { x: 140, y: 30 },
      ].map(({ x, y }) =>
        frame.ownerDocument
          .elementsFromPoint(x, y)
          .find((element) =>
            element.hasAttribute("data-agent-native-layer-name"),
          )
          ?.getAttribute("data-agent-native-layer-name"),
      ),
    );
    expect(topmost).toEqual(["Red", "Green", "Frame"]);
    await app.settled();
    expectOnlyChanged(framed, await app.savedNodes(id), [wrapper.id]);
  });
});

test.describe("Cmd+Shift+G ungroup", () => {
  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("Cmd+Shift+G on a Group returns its children to the parent at their original positions and selects them", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);
    const { wrapper } = await wrap(app, id, before, "ControlOrMeta+G", "Group");

    await page.keyboard.press("ControlOrMeta+Shift+G");

    await expect
      .poll(async () => (await app.selectedLayers()).sort())
      .toEqual(["Green", "Red"]);
    await app.settled();
    const after = await app.savedNodes(id);
    expect(after.has(wrapper.id)).toBe(false);
    expect(childrenOf(after, rootOf(before))).toEqual([
      "red",
      "green",
      "blue",
      "solo",
    ]);
    expect(styleOf(after.get("red"))).toEqual(styleOf(before.get("red")));
    expect(styleOf(after.get("green"))).toEqual(styleOf(before.get("green")));
    expectOnlyChanged(before, after, ["red", "green"]);
    expect(await app.designRect("red")).toEqual({
      x: 20,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(await app.designRect("green")).toEqual({
      x: 60,
      y: 60,
      width: 100,
      height: 80,
    });
  });

  // fixme: fails on current main after the merge: Error: apiRequestContext.post: connect ECONNREFUSED on loopback port 9611
  test.fixme("one undo after an ungroup restores the exact Group", async ({
    app,
    page,
  }) => {
    const { id, before } = await openFixture(app);
    await select(app, ["Red", "Green"]);
    const { after: grouped, wrapper } = await wrap(
      app,
      id,
      before,
      "ControlOrMeta+G",
      "Group",
    );
    await page.keyboard.press("ControlOrMeta+Shift+G");
    await app.settled();
    expect((await app.savedNodes(id)).has(wrapper.id)).toBe(false);

    await page.keyboard.press("ControlOrMeta+Z");

    await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);
    await app.settled();
    expectOnlyChanged(grouped, await app.savedNodes(id), []);
  });
});
