import { FIXTURE } from "./drag-and-drop.shared";
import { expandAllLayers } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

function childrenOf(nodes: Map<string, SavedNode>, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

function layerRow(app: App, name: string) {
  return app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

test.describe("reparenting and reordering", () => {
  test("dragging a chip onto the far half of the last chip moves it to the end and nothing else", async ({
    app,
  }) => {
    const id = await openFixture(app);
    const grab = await app.pagePoint(60, 625);
    await app.page.mouse.click(grab.x, grab.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Chip 1"]);
    const before = await app.savedNodes(id);
    const nudge = await app.pagePoint(72, 625);
    const drop = await app.pagePoint(272, 625);

    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(nudge.x, nudge.y, { steps: 5 });
    await app.page.mouse.move(drop.x, drop.y, { steps: 24 });
    await app.page.mouse.up();

    await expect
      .poll(async () => childrenOf(await app.savedNodes(id), "row"))
      .toEqual(["chip-2", "chip-3", "chip-1"]);
    await app.settled();
    const after = await app.savedNodes(id);
    expect(styleOf(after.get("chip-1"))).toEqual(styleOf(before.get("chip-1")));
    expectOnlyChanged(before, after, ["chip-1"]);
    expect({
      chip2: (await app.designRect("chip-2")).x,
      chip3: (await app.designRect("chip-3")).x,
      chip1: (await app.designRect("chip-1")).x,
    }).toEqual({ chip2: 20, chip3: 108, chip1: 196 });
  });

  // fixme: product bug: Box A renders 85.3px wide (and the 80px chips shrink too): the fixed-width items join a 280px flex row without flex-shrink:0, so CSS
  test.fixme("dragging a layer row onto a container row reparents it into that auto layout at its own size", async ({
    app,
  }) => {
    const id = await openFixture(app);
    await expandAllLayers(app.page);
    const before = await app.savedNodes(id);

    await layerRow(app, "Box A").dragTo(layerRow(app, "Row"));

    await expect
      .poll(async () => (await app.savedNodes(id)).get("box-a")?.parent)
      .toBe("row");
    await app.settled();
    const after = await app.savedNodes(id);
    expect(
      childrenOf(after, "row").filter((child) => child !== "box-a"),
      "the chips keep their order",
    ).toEqual(["chip-1", "chip-2", "chip-3"]);
    const saved = styleOf(after.get("box-a"));
    expect(
      saved.position ?? "",
      "an auto-layout child is not absolute",
    ).not.toContain("absolute");
    expect({ width: saved.width, height: saved.height }).toEqual({
      width: "120px",
      height: "80px",
    });
    expectOnlyChanged(before, after, ["box-a"]);
    const rendered = await app.designRect("box-a");
    expect(
      { width: rendered.width, height: rendered.height },
      "Box A keeps its fixed 120x80",
    ).toEqual({
      width: 120,
      height: 80,
    });
    expect(
      (await app.designRect("chip-1")).width,
      "the chips keep their fixed 80px",
    ).toBe(80);
  });
});
