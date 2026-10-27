import { FIXTURE } from "./drag-and-drop.shared";
import { appPath, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function selectRow(app: App, name: string) {
  await expandAllLayers(app.page);
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

/** The rect of one of the editor's overlays inside the screen document, in design px. */
async function overlayRect(app: App, kind: "selection" | "highlight") {
  return app.page
    .frameLocator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .locator(`[data-agent-native-edit-overlay="${kind}"]`)
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

async function canvasFrames(app: App, id: string) {
  const design = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${id}`),
    )
  ).json();
  return (
    typeof design.data === "string" ? JSON.parse(design.data) : design.data
  ).canvasFrames;
}

test.describe("selection chrome", () => {
  test("dragging a layer-row selection moves the layer by the drag, not the screen", async ({
    app,
  }) => {
    const id = await openFixture(app);
    await selectRow(app, "Box A");
    const before = await app.savedNodes(id);
    const framesBefore = await canvasFrames(app, id);
    const from = await app.pagePoint(90, 320);
    const to = await app.pagePoint(210, 380);

    await app.page.mouse.move(from.x, from.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 16 });
    await app.page.mouse.up();

    await expect
      .poll(async () => styleOf((await app.savedNodes(id)).get("box-a")).left)
      .not.toBe("30px");
    await app.settled();
    const after = await app.savedNodes(id);
    expectOnlyChanged(before, after, ["box-a"]);
    expect(
      await canvasFrames(app, id),
      "the screen frame did not move",
    ).toEqual(framesBefore);
    const saved = styleOf(after.get("box-a"));
    expect(
      Math.abs(parseFloat(saved.left) - 150),
      `saved left ${saved.left} after a 120px drag`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(saved.top) - 340),
      `saved top ${saved.top} after a 60px drag`,
    ).toBeLessThanOrEqual(2);
  });

  test("selecting a different element moves the chrome onto exactly that element", async ({
    app,
  }) => {
    await openFixture(app);
    await selectRow(app, "Box A");
    await expect
      .poll(() => overlayRect(app, "selection"))
      .toEqual({ x: 30, y: 280, width: 120, height: 80 });

    await selectRow(app, "Box B");
    await expect
      .poll(() => overlayRect(app, "selection"))
      .toEqual({ x: 30, y: 440, width: 120, height: 80 });
  });

  test("hovering an element outlines exactly that element", async ({ app }) => {
    await openFixture(app);
    const overA = await app.pagePoint(90, 320);
    await app.page.mouse.move(overA.x, overA.y);
    await expect
      .poll(() => overlayRect(app, "highlight"))
      .toEqual({ x: 30, y: 280, width: 120, height: 80 });

    const overB = await app.pagePoint(90, 480);
    await app.page.mouse.move(overB.x, overB.y);
    await expect
      .poll(() => overlayRect(app, "highlight"))
      .toEqual({ x: 30, y: 440, width: 120, height: 80 });
  });
});
